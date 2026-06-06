import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import type { CellValue, CellData, WorkbookData } from '@/lib/formula-engine/types';

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
    const { table7FileBase64, balancedItems, maxIterations = 100, tolerance = 10, filePath } = body as {
      table7FileBase64?: string;
      balancedItems?: Array<{
        row: number; category: string; code: string; name: string;
        quantity: number; targetUnitPrice: number; targetTotalPrice: number;
      }>;
      maxIterations?: number;
      tolerance?: number; // 可接受的总价差额(元)，默认10元
      filePath?: string;
    };

    if (!balancedItems?.length) {
      return NextResponse.json({
        success: false,
        error: '请提供：balancedItems(步骤5的配平结果)',
      }, { status: 400 });
    }

    // 1. 读取表7（支持base64或filePath）
    let fileBuffer: Buffer;
    if (filePath) {
      const fs = await import('fs');
      fileBuffer = fs.readFileSync(filePath);
    } else if (table7FileBase64) {
      fileBuffer = Buffer.from(table7FileBase64, 'base64');
    } else {
      return NextResponse.json({ success: false, error: '请提供表7文件（filePath或base64）' }, { status: 400 });
    }

    // 2. 第三级：材料调价配平
    const result = await materialLevelPricing(fileBuffer, balancedItems, maxIterations, tolerance);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** 三级配平核心算法 — 使用二分法寻找统一缩放系数 */
async function materialLevelPricing(
  arrayBuffer: ArrayBuffer | Buffer,
  balancedItems: Array<{
    row: number; category: string; code: string; name: string;
    quantity: number; targetUnitPrice: number; targetTotalPrice: number;
  }>,
  maxIterations: number,
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

  // 4. 建立清单→工料机映射关系（用于分析，当前算法未直接使用）
  const itemResourceMap = buildItemResourceMapping(originalWb, balancedItems);

  // 5. 目标总价
  const targetTotal = balancedItems.reduce((s, i) => s + i.targetTotalPrice, 0);

  // 6. 首次计算基准总价
  const baseWb = cloneWorkbook(originalWb);
  const { workbook: baseCalcWb } = calculateWorkbook(baseWb);
  const baseTotal = calcCurrentTotal(baseCalcWb);

  // 辅助函数：给定缩放系数k，计算总价
  function calcWithScale(k: number): { total: number; wb: WorkbookData } {
    const wb = cloneWorkbook(originalWb);
    const resSheet = wb.get('工料机汇总表');
    if (!resSheet) return { total: 0, wb };

    // 对所有可调材料应用缩放系数
    for (const res of adjustableResources) {
      if (!res.isAdjustable) continue;
      const priceKey = `${res.row},6`; // F列=含税市场价
      const cell = resSheet.get(priceKey);
      if (cell && res.originalPrice > 0) {
        cell.value = round2(res.originalPrice * k);
      }
    }

    const { workbook: calcWb } = calculateWorkbook(wb);
    return { total: calcCurrentTotal(calcWb), wb };
  }

  // 7. 二分法搜索缩放系数
  // 初始范围：k_low 使总价 < targetTotal, k_high 使总价 > targetTotal
  let kLow = 0.1;   // 价格降到10%
  let kHigh = 3.0;   // 价格涨到300%
  let bestK = 1.0;
  let bestWb: WorkbookData = baseWb;
  let converged = false;
  let iteration = 0;
  const iterationLog: Array<{ iteration: number; totalDiff: number; adjustedCount: number; k: number }> = [];

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    const kMid = (kLow + kHigh) / 2;
    const { total, wb } = calcWithScale(kMid);
    const diff = total - targetTotal;

    iterationLog.push({ iteration, totalDiff: round2(diff), adjustedCount: adjustableCount, k: round4(kMid) });

    if (Math.abs(diff) <= tolerance) {
      bestK = kMid;
      bestWb = wb;
      converged = true;
      break;
    }

    if (diff > 0) {
      // 总价过高 → 需要降价 → 缩小k
      kHigh = kMid;
    } else {
      // 总价过低 → 需要涨价 → 增大k
      kLow = kMid;
    }

    bestK = kMid;
    bestWb = wb;

    // 精度不再提升时提前退出（k的范围已足够小）
    if (kHigh - kLow < 1e-6) {
      break;
    }
  }

  // 8. 最终计算（使用bestK再次确认）
  const { total: finalTotal, wb: finalWbResult } = calcWithScale(bestK);
  const finalDiff = finalTotal - targetTotal;

  // 9. 更新adjustableResources的adjustedPrice
  for (const res of adjustableResources) {
    if (res.isAdjustable && res.originalPrice > 0) {
      res.adjustedPrice = round2(res.originalPrice * bestK);
    }
  }

  // 10. 提取调价前后对比
  const priceChanges = extractPriceChanges(originalWb, finalWbResult, adjustableResources);

  // 11. 校验结果
  const validation = {
    targetTotal: round2(targetTotal),
    actualTotal: round2(finalTotal),
    diff: round2(finalDiff),
    pass: Math.abs(finalDiff) <= tolerance,
    iterations: iteration,
    converged,
    bestScaleFactor: round4(bestK),
    formulaErrors: 0,
  };

  return {
    level3: {
      adjustableResourceCount: adjustableCount,
      priceChanges,
      iterationLog: iterationLog.slice(-20),
      baseTotal: round2(baseTotal),
      scaleFactor: round4(bestK),
    },
    validation,
    finalSummary: extractSummary(finalWbResult),
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

  const sheetMap: Record<string, string> = {
    '道路工程': '综合单价分析表【道路工程】',
    '桥梁工程': '综合单价分析表【桥梁工程】',
    '排水工程': '综合单价分析表【排水工程】',
  };

  for (const item of balancedItems) {
    const sheetName = sheetMap[item.category];
    if (!sheetName) continue;

    const sheet = wb.get(sheetName);
    if (!sheet) continue;

    const key = `${item.category}-${item.row}`;
    const resources: Array<{ resourceCode: string; consumption: number }> = [];

    // 从主条目行向下扫描，找工料机行
    for (let r = item.row + 1; r < item.row + 20; r++) {
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
): Array<{ code: string; name: string; originalPrice: number; adjustedPrice: number; diff: number }> {
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
