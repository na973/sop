import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import type { CellValue, CellData, WorkbookData } from '@/lib/formula-engine/types';
import { getAnalysisSheetName, getNextMainRowOrEnd, getMainRows } from '@/lib/bidding/excel-sheets';

/** 安全取数：CellValue | undefined → number */
function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (v instanceof Error) return 0;
  return typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);
}

/** 步骤6：材料调价配平 — 三级配平第三级（最复杂）
 *  核心：修改工料机单价 → 公式回算清单单价 → 汇总校验总价
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { table7FileBase64, fileBase64, balancedItems, tolerance = 10 } = body as {
      table7FileBase64?: string;
      fileBase64?: string;
      balancedItems?: Array<{
        row: number; category: string; code: string; name: string;
        quantity: number; targetUnitPrice: number; targetTotalPrice: number;
      }>;
      tolerance?: number;
    };

    if (!balancedItems?.length) {
      return NextResponse.json({
        success: false,
        error: '请提供：balancedItems(步骤5的配平结果)',
      }, { status: 400 });
    }

    // 1. 读取表7
    let fileBuffer: Buffer;
    const base64 = fileBase64 || table7FileBase64;
    if (base64) {
      fileBuffer = Buffer.from(base64, 'base64');
    } else {
      return NextResponse.json({ success: false, error: '请提供表7文件base64' }, { status: 400 });
    }

    // 2. 第三级：材料调价配平
    const result = await materialLevelPricing(fileBuffer, balancedItems, tolerance);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** 三级配平核心算法 — 按清单差额分摊到其关联的可调材料 */
async function materialLevelPricing(
  arrayBuffer: ArrayBuffer | Buffer,
  balancedItems: Array<{
    row: number; category: string; code: string; name: string;
    quantity: number; targetUnitPrice: number; targetTotalPrice: number;
  }>,
  tolerance: number,
) {
  // 1. 读取原始Excel数据
  const ab = Buffer.isBuffer(arrayBuffer) ? arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength) as ArrayBuffer : arrayBuffer;
  const originalWb = await readExcelToWorkbook(ab);

  // 2. 提取工料机汇总表结构
  const resourceSheet = originalWb.get('工料机汇总表');
  if (!resourceSheet) {
    return { success: false, error: '未找到工料机汇总表' };
  }

  // 3. 构建工料机资源列表（可调价的材料项）
  const adjustableResources = extractAdjustableResources(resourceSheet);
  const adjustableCount = adjustableResources.filter(r => r.isAdjustable).length;
  if (adjustableCount === 0) {
    return { success: false, error: '没有可调价的材料资源' };
  }

  // 4. 建立清单→工料机映射关系
  const itemResourceMap = buildItemResourceMapping(originalWb, balancedItems);

  // 5. 目标总价
  const targetTotal = balancedItems.reduce((s, i) => s + i.targetTotalPrice, 0);

  // 6. 首次计算基准总价
  const baseWb = cloneWorkbook(originalWb);
  const { workbook: baseCalcWb } = calculateWorkbook(baseWb);
  const baseTotal = calcCurrentTotal(baseCalcWb);

  const resourceByCode = new Map(adjustableResources.map((res) => [res.code, res]));
  const priceDeltaByCode = new Map<string, number>();
  const itemAdjustmentLog: Array<{ item: string; currentTotal: number; targetTotal: number; diff: number; adjustedResourceCount: number }> = [];

  for (const item of balancedItems) {
    const sheet = baseCalcWb.get(getAnalysisSheetName(item.category));
    const currentTotal = toNum(sheet?.get(`${item.row},7`)?.value);
    const diff = item.targetTotalPrice - currentTotal;
    const mappingKey = `${item.category}-${item.row}`;
    const resources = (itemResourceMap.get(mappingKey) || [])
      .map((resource) => ({ ...resource, master: resourceByCode.get(resource.resourceCode) }))
      .filter((resource) => resource.master?.isAdjustable && resource.master.originalPrice > 0 && resource.consumption > 0);

    if (Math.abs(diff) <= 0.01 || resources.length === 0) {
      itemAdjustmentLog.push({
        item: `${item.category} R${item.row}`,
        currentTotal: round2(currentTotal),
        targetTotal: round2(item.targetTotalPrice),
        diff: round2(diff),
        adjustedResourceCount: resources.length,
      });
      continue;
    }

    const materialBase = resources.reduce((sum, resource) => sum + resource.consumption * resource.master!.originalPrice, 0);
    if (materialBase <= 0) continue;

    for (const resource of resources) {
      const weight = (resource.consumption * resource.master!.originalPrice) / materialBase;
      const priceDelta = (diff * weight) / resource.consumption;
      priceDeltaByCode.set(resource.resourceCode, (priceDeltaByCode.get(resource.resourceCode) || 0) + priceDelta);
    }

    itemAdjustmentLog.push({
      item: `${item.category} R${item.row}`,
      currentTotal: round2(currentTotal),
      targetTotal: round2(item.targetTotalPrice),
      diff: round2(diff),
      adjustedResourceCount: resources.length,
    });
  }

  const finalWb = cloneWorkbook(originalWb);
  const finalResSheet = finalWb.get('工料机汇总表');
  if (!finalResSheet) return { success: false, error: '未找到工料机汇总表' };

  // ---- Phase 1: 单次调价（新算法） ----
  for (const res of adjustableResources) {
    const delta = priceDeltaByCode.get(res.code) || 0;
    if (delta === 0 || res.originalPrice <= 0) continue;

    const priceKey = `${res.row},6`;
    const cell = finalResSheet.get(priceKey);
    if (!cell) continue;

    const adjustedPrice = Math.max(0.01, round2(res.originalPrice + delta));
    cell.value = adjustedPrice;
    res.adjustedPrice = adjustedPrice;
  }

  // ---- Phase 2: 二分法微调统一缩放因子k ----
  const currentWb = cloneWorkbook(originalWb);
  const currentResSheet = currentWb.get('工料机汇总表')!;

  let kLow = 0.5, kHigh = 2.0;
  let bestK = 1.0;
  let bestDiff = Infinity;
  let bestWb = currentWb;
  let iterations = 0;
  const maxIter = 30;

  for (let i = 0; i < maxIter; i++) {
    iterations++;
    const k = (kLow + kHigh) / 2;
    const testWb = cloneWorkbook(originalWb);
    const testResSheet = testWb.get('工料机汇总表')!;

    for (const res of adjustableResources) {
      if (!res.isAdjustable || res.originalPrice <= 0) continue;
      const delta = priceDeltaByCode.get(res.code) || 0;
      const basePrice = Math.max(0.01, round2(res.originalPrice + delta));
      const scaledPrice = Math.max(0.01, round2(basePrice * k));
      const cell = testResSheet.get(`${res.row},6`);
      if (cell) cell.value = scaledPrice;
    }

    const { workbook: testResult } = calculateWorkbook(testWb);
    const testTotal = calcCurrentTotal(testResult);
    const testDiff = testTotal - targetTotal;

    if (Math.abs(testDiff) < Math.abs(bestDiff)) {
      bestDiff = testDiff;
      bestK = k;
      bestWb = testWb;
    }

    if (Math.abs(testDiff) <= tolerance) break;

    if (testDiff < 0) {
      kLow = k;
    } else {
      kHigh = k;
    }
  }

  // 更新adjustedPrice
  for (const res of adjustableResources) {
    if (!res.isAdjustable || res.originalPrice <= 0) continue;
    const delta = priceDeltaByCode.get(res.code) || 0;
    const basePrice = Math.max(0.01, round2(res.originalPrice + delta));
    res.adjustedPrice = Math.max(0.01, round2(basePrice * bestK));
  }

  const finalTotal = calcCurrentTotal(bestWb);
  const finalDiff = finalTotal - targetTotal;

  // 10. 提取调价前后对比
  const priceChanges = extractPriceChanges(originalWb, bestWb, adjustableResources);

  // 11. 校验结果
  const converged = Math.abs(finalDiff) <= tolerance;
  const validation = {
    targetTotal: round2(targetTotal),
    actualTotal: round2(finalTotal),
    diff: round2(finalDiff),
    pass: converged,
    iterations,
    converged,
    bestScaleFactor: round2(bestK),
    formulaErrors: 0,
  };

  return {
    level3: {
      adjustableResourceCount: adjustableCount,
      priceChanges,
      iterationLog: [{
        iteration: 1,
        totalDiff: round2(finalDiff),
        adjustedCount: priceChanges.length,
      }],
      itemAdjustmentLog: itemAdjustmentLog.slice(0, 100),
      baseTotal: round2(baseTotal),
      method: 'item-resource-allocation + binary-search-scale',
    },
    validation,
    finalSummary: extractSummary(bestWb),
  };
}

/** 提取可调价的工料机资源 */
function extractAdjustableResources(
  resourceSheet: Map<string, { value: CellValue; isFormula: boolean; formula?: string }>,
): Array<{
  row: number; code: string; name: string; unit: string;
  originalPrice: number; adjustedPrice: number; isAdjustable: boolean;
}> {
  const resources: Array<{
    row: number; code: string; name: string; unit: string;
    originalPrice: number; adjustedPrice: number; isAdjustable: boolean;
  }> = [];

  for (const [key, cell] of resourceSheet) {
    const [r, c] = key.split(',').map(Number);
    // 工料机汇总表结构: A=序号, B=编码, C=名称, D=单位, E=数量, F=含税市场价
    if (c === 2 && r > 1 && cell.value !== null && cell.value !== undefined) {
      const code = String(cell.value).trim();
      const name = String(resourceSheet.get(`${r},3`)?.value ?? '').trim();
      const unit = String(resourceSheet.get(`${r},4`)?.value ?? '').trim();
      const price = toNum(resourceSheet.get(`${r},6`)?.value); // F列=含税市场价

      // 只调材料单价（编码以C开头或数字开头的），人工和机械一般不调
      const isAdjustable = isMaterialCode(code);

      if (code && code !== 'null') {
        resources.push({ row: r, code, name, unit, originalPrice: price, adjustedPrice: price, isAdjustable });
      }
    }
  }

  return resources;
}

/** 构建清单→工料机映射 */
function buildItemResourceMapping(
  wb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  balancedItems: Array<{ row: number; category: string }>,
): Map<string, Array<{ resourceCode: string; consumption: number }>> {
  const mapping = new Map<string, Array<{ resourceCode: string; consumption: number }>>();

  for (const item of balancedItems) {
    const sheetName = getAnalysisSheetName(item.category);
    const sheet = wb.get(sheetName);
    if (!sheet) continue;

    const key = `${item.category}-${item.row}`;
    const resources: Array<{ resourceCode: string; consumption: number }> = [];

    const mainRows = getMainRows(sheet);
    const nextMainRow = getNextMainRowOrEnd(sheet, item.row, mainRows);

    // 从主条目行向下扫描，直到下一个主清单行或表格末尾
    for (let r = item.row + 1; r < nextMainRow; r++) {
      const hCode = String(sheet.get(`${r},8`)?.value ?? ''); // H列=编码
      if (!hCode || hCode === 'null' || hCode === '组价内容' || hCode === '编码') continue;
      if (hCode === 'undefined') continue;

      // 检查是否到了下一个主条目
      const aVal = sheet.get(`${r},1`)?.value;
      if (typeof aVal === 'number' && aVal > 0) break;

      const consumption = toNum(sheet.get(`${r},10`)?.value); // J列=消耗量
      resources.push({ resourceCode: hCode, consumption });
    }

    mapping.set(key, resources);
  }

  return mapping;
}

/** 调整工料机单价 */
/** 计算当前总价 */
function calcCurrentTotal(calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>): number {
  const summarySheet = calcWb.get('汇总表');
  if (!summarySheet) return 0;

  // C19 = 合计
  const totalCell = summarySheet.get('19,3');
  return toNum(totalCell?.value);
}

/** 提取调价前后对比 */
function extractPriceChanges(
  originalWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  finalWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  resources: Array<{ row: number; code: string; name: string; isAdjustable: boolean }>,
): Array<{ row: number; code: string; name: string; originalPrice: number; adjustedPrice: number; diff: number }> {
  const origSheet = originalWb.get('工料机汇总表');
  const finalSheet = finalWb.get('工料机汇总表');
  if (!origSheet || !finalSheet) return [];

  return resources
    .filter((r) => r.isAdjustable)
    .map((res) => {
      const origPrice = toNum(origSheet.get(`${res.row},6`)?.value); // F列=含税市场价
      const finalPrice = toNum(finalSheet.get(`${res.row},6`)?.value);
      return {
        code: res.code,
        row: res.row,
        name: res.name,
        originalPrice: round2(origPrice),
        adjustedPrice: round2(finalPrice),
        diff: round2(finalPrice - origPrice),
      };
    })
    .filter((c) => c.diff !== 0);
}

/** 提取汇总表最终结果 */
function extractSummary(calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>) {
  const sheet = calcWb.get('汇总表');
  if (!sheet) return null;

  const rows: Array<{ key: string; content: string; amount: number }> = [];
  for (const [key, cell] of sheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === 2 && r > 1) {
      const cVal = toNum(sheet.get(`${r},3`)?.value);
      rows.push({ key: String(sheet.get(`${r},1`)?.value ?? ''), content: String(cell.value ?? ''), amount: cVal });
    }
  }
  return rows;
}

/** 深拷贝工作簿 */
function cloneWorkbook(wb: WorkbookData): WorkbookData {
  const clone: WorkbookData = new Map();
  for (const [sheetName, sheet] of wb) {
    const sheetClone: Map<string, CellData> = new Map();
    for (const [key, cell] of sheet) {
      sheetClone.set(key, { ...cell });
    }
    clone.set(sheetName, sheetClone);
  }
  return clone;
}

function isMaterialCode(code: string): boolean {
  if (!code) return false;
  const trimmed = code.trim();
  // 编码规则：01/02/03开头=材料（可调），00开头=人工（不可调），99开头=机械（不可调）
  return /^(01|02|03)/.test(trimmed);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
