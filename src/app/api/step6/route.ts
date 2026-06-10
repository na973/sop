import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import type { CellValue, CellData, WorkbookData } from '@/lib/formula-engine/types';
import { getAnalysisSheetName, getNextMainRowOrEnd, getMainRows, getAnalysisSheets } from '@/lib/bidding/excel-sheets';

/** 安全取数：CellValue | undefined → number */
function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (v instanceof Error) return 0;
  return typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);
}

/** 步骤6：材料调价配平 — 在表2（综合单价分析表）基础上，
 *  根据步骤5每条清单的目标单价反推出每个材料的不含税单价
 *
 *  核心逻辑：
 *  1. 读取表2，提取每条清单的工料机构成（消耗量×单价=合价）
 *  2. 对于每条清单，目标合价 = 目标单价 × 工程量
 *  3. 保持人工和机械单价不变，将差额分摊到材料单价上
 *  4. 反推出每个材料的不含税单价 = (调整后材料合价 / 消耗量)
 *  5. 同一材料在多条清单中出现时，取加权平均单价
 *  6. 将调整后的材料单价写回工料机汇总表F列（含税市场价），
 *     通过公式引擎重算，验证最终总价是否匹配
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
        unitPrice?: number; maxUnitPrice?: number;
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

    // 2. 读取并计算原始Excel
    const ab = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const originalWb = await readExcelToWorkbook(ab);
    const { workbook: calcWb } = calculateWorkbook(originalWb);
    const baseTotal = calcCurrentTotal(calcWb);

    // 3. 从表2提取每条清单的工料机构成
    const itemResources = extractItemResourcesFromTable2(calcWb, balancedItems);

    // 4. 反推材料单价
    const reverseResult = reverseCalculateMaterialPrices(calcWb, balancedItems, itemResources);

    // 5. 将反推后的材料单价写回工料机汇总表，用公式引擎验证
    const verifyResult = applyAndVerify(originalWb, reverseResult.materialPrices, balancedItems, tolerance);

    return NextResponse.json({
      success: true,
      level3: {
        adjustableResourceCount: reverseResult.materialPrices.length,
        priceChanges: reverseResult.priceChanges,
        baseTotal: round2(baseTotal),
        method: 'table2-reverse-calculation',
        itemDetails: reverseResult.itemDetails.slice(0, 200),
      },
      validation: verifyResult.validation,
      finalSummary: verifyResult.summary,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** 表2清单项的工料机构成 */
interface ItemResourceBreakdown {
  row: number;
  category: string;
  code: string;
  name: string;
  quantity: number;
  currentUnitPrice: number;
  currentTotalPrice: number;
  targetUnitPrice: number;
  targetTotalPrice: number;
  resources: Array<{
    row: number;
    code: string;
    name: string;
    type: '人工' | '材料' | '机械' | '其他';
    consumption: number;
    unitPrice: number;
    totalPrice: number;
    isAdjustable: boolean;
  }>;
}

/** 从表2（综合单价分析表）提取每条清单的工料机构成 */
function extractItemResourcesFromTable2(
  calcWb: WorkbookData,
  balancedItems: Array<{ row: number; category: string; code: string; name: string; quantity: number; targetUnitPrice: number; targetTotalPrice: number }>,
): ItemResourceBreakdown[] {
  const results: ItemResourceBreakdown[] = [];

  for (const item of balancedItems) {
    const sheetName = getAnalysisSheetName(item.category);
    const sheet = calcWb.get(sheetName);
    if (!sheet) continue;

    const mainRows = getMainRows(sheet);
    const nextMainRow = getNextMainRowOrEnd(sheet, item.row, mainRows);

    const currentUnitPrice = toNum(sheet.get(`${item.row},6`)?.value);
    const currentTotalPrice = toNum(sheet.get(`${item.row},7`)?.value);

    const resources: ItemResourceBreakdown['resources'] = [];

    // 从主条目行向下扫描工料机行
    // 表2列布局：A=序号, B=描述, C=人材机分类, D=编码, E=名称, F=规格, G=单位
    //             H=数量(消耗量), I=单价(不含税), J=合价(H*I), K=小计(分组汇总)
    // 综合单价 = Σ K列(各资源的单位成本贡献) + 企业管理费小计
    for (let r = item.row + 1; r < nextMainRow; r++) {
      const dCode = String(sheet.get(`${r},4`)?.value ?? '').trim();  // D列=编码
      const eName = String(sheet.get(`${r},5`)?.value ?? '').trim();  // E列=名称
      const cType = String(sheet.get(`${r},3`)?.value ?? '').trim();  // C列=人材机分类

      // 跳过标题行和空行
      if (!dCode || dCode === 'null' || dCode === '编码' || dCode === 'undefined' || dCode === '名称') continue;
      // 跳过企业管理费等非工料机行
      if (cType === '企业管理费及利润' || cType === '名称' || cType === '计算基础') continue;

      // 检查是否到了下一个主条目
      const aVal = sheet.get(`${r},1`)?.value;
      if (typeof aVal === 'number' && aVal > 0 && r !== item.row) break;
      // 也检查是否出现了"序号"（下一个清单项的表头）
      const aStr = String(aVal ?? '').trim();
      if (aStr === '序号') break;

      const consumption = toNum(sheet.get(`${r},8`)?.value);   // H列=数量(消耗量)
      const unitPrice = toNum(sheet.get(`${r},9`)?.value);     // I列=单价(不含税)
      const lineTotal = toNum(sheet.get(`${r},10`)?.value);    // J列=合价=H*I
      const subTotal = toNum(sheet.get(`${r},11`)?.value);     // K列=小计(分组汇总)
      const type = getResourceTypeFromCategory(cType, dCode);
      const isAdjustable = type === '材料' && consumption > 0;

      // K列(小计)是综合单价的组成部分，比J列(单行合价)更适合做配平计算
      resources.push({ row: r, code: dCode, name: eName, type, consumption, unitPrice, totalPrice: subTotal || lineTotal, isAdjustable });
    }

    results.push({
      row: item.row,
      category: item.category,
      code: item.code,
      name: item.name,
      quantity: item.quantity,
      currentUnitPrice,
      currentTotalPrice,
      targetUnitPrice: item.targetUnitPrice,
      targetTotalPrice: item.targetTotalPrice,
      resources,
    });
  }

  return results;
}

/** 反推材料单价
 *  核心思路：综合单价 = Σ(K列) = 人工K + 机械K + 材料K + 企管费K
 *  保持人工、机械、企管费不变，将单价的差额全部分摊到材料上
 *  对于每条清单：
 *    目标单价 = balancedItems中的targetUnitPrice
 *    人工K + 机械K + 企管费K + 材料K = 目标单价
 *    材料K = 目标单价 - 人工K - 机械K - 企管费K
 *    每种材料的新单价 = 材料K * (该材料原K / 材料总K) / 消耗量
 */
function reverseCalculateMaterialPrices(
  calcWb: WorkbookData,
  balancedItems: Array<{ row: number; category: string; code: string; name: string; quantity: number; targetUnitPrice: number; targetTotalPrice: number }>,
  itemResources: ItemResourceBreakdown[],
) {
  // 收集所有材料的新单价（同一材料可能出现在多条清单中，取加权平均）
  const materialPriceAccum = new Map<string, {
    code: string;
    name: string;
    totalWeightedPrice: number;
    totalConsumption: number;
    originalPrice: number;
    occurrences: number;
  }>();

  const itemDetails: Array<{
    code: string;
    name: string;
    category: string;
    targetUnitPrice: number;
    currentUnitPrice: number;
    targetTotalPrice: number;
    diff: number;
    materialDiff: number;
    materialOriginalTotal: number;
    materialTargetTotal: number;
    adjustedResources: number;
  }> = [];

  for (const item of itemResources) {
    const targetUnit = item.targetUnitPrice;
    const diff = targetUnit - item.currentUnitPrice;

    // 计算人工、机械、企管费的固定部分(K列贡献)
    const laborTotal = item.resources
      .filter(r => r.type === '人工')
      .reduce((s, r) => s + r.totalPrice, 0);
    const mechTotal = item.resources
      .filter(r => r.type === '机械')
      .reduce((s, r) => s + r.totalPrice, 0);
    const otherTotal = item.resources
      .filter(r => r.type === '其他')
      .reduce((s, r) => s + r.totalPrice, 0);

    // 材料原K列合计
    const materialOriginalTotal = item.resources
      .filter(r => r.isAdjustable)
      .reduce((s, r) => s + r.totalPrice, 0);

    // 材料目标K = 目标单价 - 人工K - 机械K - 企管费K
    const materialTargetTotal = targetUnit - laborTotal - mechTotal - otherTotal;

    // 如果材料目标K为负或材料原K为0，跳过调整
    const canAdjust = materialOriginalTotal > 0 && materialTargetTotal > 0;
    const scaleFactor = canAdjust ? materialTargetTotal / materialOriginalTotal : 1;

    let adjustedCount = 0;

    for (const res of item.resources) {
      if (!res.isAdjustable) continue;

      // 按权重分配：每种材料的新K = 原K × 缩放因子
      const newTotalPrice = res.totalPrice * scaleFactor;
      // 新单价(不含税) = 新K / 消耗量
      const newUnitPrice = res.consumption > 0 ? newTotalPrice / res.consumption : res.unitPrice;

      // 累加到全局材料价格映射
      const key = res.code;
      const existing = materialPriceAccum.get(key);
      if (existing) {
        existing.totalWeightedPrice += newUnitPrice * res.consumption;
        existing.totalConsumption += res.consumption;
        existing.occurrences += 1;
      } else {
        // 从工料机汇总表获取原始含税单价
        const origPrice = getResourceOriginalPrice(calcWb, res.code);
        materialPriceAccum.set(key, {
          code: res.code,
          name: res.name,
          totalWeightedPrice: newUnitPrice * res.consumption,
          totalConsumption: res.consumption,
          originalPrice: origPrice,
          occurrences: 1,
        });
      }

      adjustedCount++;
    }

    itemDetails.push({
      code: item.code,
      name: item.name,
      category: item.category,
      targetUnitPrice: round2(targetUnit),
      currentUnitPrice: round2(item.currentUnitPrice),
      targetTotalPrice: round2(targetUnit * item.quantity),
      diff: round2(diff),
      materialDiff: round2(materialTargetTotal - materialOriginalTotal),
      materialOriginalTotal: round2(materialOriginalTotal),
      materialTargetTotal: round2(canAdjust ? materialTargetTotal : materialOriginalTotal),
      adjustedResources: adjustedCount,
    });
  }

  // 计算每种材料的加权平均单价
  const materialPrices = Array.from(materialPriceAccum.entries()).map(([code, data]) => {
    const avgPrice = data.totalConsumption > 0 ? data.totalWeightedPrice / data.totalConsumption : data.originalPrice;
    // 反推不含税单价：含税市场价 / (1 + 税率/100)
    // 工料机汇总表中 F列=含税市场价, G列=税率, H列=不含税单价=ROUND(F/(1+G/100),2)
    const taxRate = getResourceTaxRate(calcWb, code);
    const priceExclTax = taxRate > 0 ? round2(avgPrice / (1 + taxRate / 100)) : round2(avgPrice);

    return {
      code,
      name: data.name,
      originalPrice: round2(data.originalPrice),
      adjustedPriceInclTax: round2(avgPrice),
      adjustedPriceExclTax: priceExclTax,
      diff: round2(avgPrice - data.originalPrice),
      diffPercent: data.originalPrice > 0 ? round4((avgPrice - data.originalPrice) / data.originalPrice) : 0,
      occurrences: data.occurrences,
    };
  });

  // 生成价格变更列表（用于步骤7写回Excel）
  const priceChanges = materialPrices
    .filter(m => Math.abs(m.diff) > 0.001)
    .map(m => ({
      code: m.code,
      name: m.name,
      row: 0, // 行号稍后在applyAndVerify中确定
      originalPrice: m.originalPrice,
      adjustedPrice: m.adjustedPriceInclTax, // 写回F列的是含税价
      diff: m.diff,
      diffPercent: m.diffPercent,
    }));

  return { materialPrices, priceChanges, itemDetails };
}

/** 从工料机汇总表获取材料原始含税单价 */
function getResourceOriginalPrice(calcWb: WorkbookData, resourceCode: string): number {
  const resSheet = calcWb.get('工料机汇总表');
  if (!resSheet) return 0;

  for (const [key, cell] of resSheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === 2 && r > 1) { // B列=编码
      const code = String(cell.value ?? '').trim();
      if (code === resourceCode) {
        return toNum(resSheet.get(`${r},6`)?.value); // F列=含税市场价
      }
    }
  }
  return 0;
}

/** 从工料机汇总表获取材料税率 */
function getResourceTaxRate(calcWb: WorkbookData, resourceCode: string): number {
  const resSheet = calcWb.get('工料机汇总表');
  if (!resSheet) return 0;

  for (const [key, cell] of resSheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === 2 && r > 1) { // B列=编码
      const code = String(cell.value ?? '').trim();
      if (code === resourceCode) {
        return toNum(resSheet.get(`${r},7`)?.value); // G列=税率
      }
    }
  }
  return 0;
}

/** 获取材料在工料机汇总表中的行号 */
function getResourceRow(calcWb: WorkbookData, resourceCode: string): number {
  const resSheet = calcWb.get('工料机汇总表');
  if (!resSheet) return 0;

  for (const [key, cell] of resSheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === 2 && r > 1) {
      const code = String(cell.value ?? '').trim();
      if (code === resourceCode) return r;
    }
  }
  return 0;
}

/** 将反推后的材料含税单价写回工料机汇总表F列，用公式引擎重算验证 */
function applyAndVerify(
  originalWb: WorkbookData,
  materialPrices: Array<{
    code: string;
    name: string;
    originalPrice: number;
    adjustedPriceInclTax: number;
    adjustedPriceExclTax: number;
    diff: number;
  }>,
  balancedItems: Array<{ targetTotalPrice: number }>,
  tolerance: number,
) {
  // 深拷贝工作簿
  const workWb = cloneWorkbook(originalWb);
  const resSheet = workWb.get('工料机汇总表');
  if (!resSheet) return { validation: { targetTotal: 0, actualTotal: 0, diff: 0, pass: false, iterations: 0, converged: false }, summary: null };

  // 将调整后的含税单价写回F列
  let writeCount = 0;
  for (const mp of materialPrices) {
    if (Math.abs(mp.diff) < 0.001) continue;

    const row = getResourceRow(originalWb, mp.code);
    if (row <= 0) continue;

    const priceKey = `${row},6`;
    const cell = resSheet.get(priceKey);
    if (cell) {
      cell.value = mp.adjustedPriceInclTax;
      writeCount++;
    }
  }

  // 用公式引擎重算
  const { workbook: resultWb } = calculateWorkbook(workWb);
  const actualTotal = calcCurrentTotal(resultWb);
  const targetTotal = balancedItems.reduce((s, i) => s + i.targetTotalPrice, 0);
  const diff = actualTotal - targetTotal;

  // 如果初次差距太大，用二分法微调
  let iterations = 1;
  let converged = Math.abs(diff) <= tolerance;
  let bestWb = resultWb;

  if (!converged && writeCount > 0) {
    // 二分法微调：所有已调整的材料价格乘以一个统一的缩放因子k
    let kLow = 0.5, kHigh = 2.0;
    let bestK = 1.0;
    let bestDiff = diff;

    for (let i = 0; i < 30; i++) {
      iterations++;
      const k = (kLow + kHigh) / 2;
      const testWb = cloneWorkbook(originalWb);
      const testResSheet = testWb.get('工料机汇总表')!;

      for (const mp of materialPrices) {
        if (Math.abs(mp.diff) < 0.001) continue;
        const row = getResourceRow(originalWb, mp.code);
        if (row <= 0) continue;
        const cell = testResSheet.get(`${row},6`);
        if (cell) {
          cell.value = round2(mp.adjustedPriceInclTax * k);
        }
      }

      const { workbook: testResult } = calculateWorkbook(testWb);
      const testTotal = calcCurrentTotal(testResult);
      const testDiff = testTotal - targetTotal;

      if (Math.abs(testDiff) < Math.abs(bestDiff)) {
        bestDiff = testDiff;
        bestK = k;
        bestWb = testResult;
      }

      if (Math.abs(testDiff) <= tolerance) {
        converged = true;
        break;
      }

      if (testDiff < 0) {
        kLow = k;
      } else {
        kHigh = k;
      }
    }
  }

  const finalTotal = calcCurrentTotal(bestWb);
  const finalDiff = finalTotal - targetTotal;

  return {
    validation: {
      targetTotal: round2(targetTotal),
      actualTotal: round2(finalTotal),
      diff: round2(finalDiff),
      pass: Math.abs(finalDiff) <= tolerance,
      iterations,
      converged: Math.abs(finalDiff) <= tolerance,
      bestScaleFactor: iterations > 1 ? round2(1.0) : undefined,
    },
    summary: extractSummary(bestWb),
  };
}

/** 计算当前总价 */
function calcCurrentTotal(calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>): number {
  const summarySheet = calcWb.get('汇总表');
  if (!summarySheet) return 0;

  // C19 = 合计
  const totalCell = summarySheet.get('19,3');
  return toNum(totalCell?.value);
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

function getResourceType(code: string): '人工' | '材料' | '机械' | '其他' {
  if (!code) return '其他';
  const trimmed = code.trim();
  // 编码规则：01/02/03开头=材料，00开头=人工，99开头=机械
  if (/^(01|02|03)/.test(trimmed)) return '材料';
  if (/^00/.test(trimmed)) return '人工';
  if (/^99/.test(trimmed)) return '机械';
  if (/^R/i.test(trimmed)) return '人工';
  if (/^C/i.test(trimmed)) return '材料';
  if (/^J/i.test(trimmed)) return '机械';
  return '材料';
}

/** 根据人材机分类列和编码判断资源类型 */
function getResourceTypeFromCategory(category: string, code: string): '人工' | '材料' | '机械' | '其他' {
  // 优先使用分类列（C列="人工费"/"材料费"/"施工机具（机械）使用费"等）
  if (category.includes('人工')) return '人工';
  if (category.includes('机械') || category.includes('施工机具')) return '机械';
  if (category.includes('材料')) return '材料';
  if (category.includes('企业管理费') || category.includes('利润')) return '其他';
  // 回退到编码规则
  return getResourceType(code);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
