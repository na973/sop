import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import { getAnalysisSheets, getMainRows } from '@/lib/bidding/excel-sheets';
import type { CellValue } from '@/lib/formula-engine/types';

/** 步骤5：清单调价配平 — 总价配平 + 清单配平（三级配平前两级）
 *
 * 重要说明：总价=清单合价+安全文明施工费+暂列金额等费用
 * 步骤5的目标总价计算逻辑：
 *   目标总价 = 限价合计 × (1 - 总下浮率)
 *   该目标总价包含分部分项清单合价+安全文明施工费+暂列金额等
 *   清单配平的第二级是在分部分项清单层面调整，使清单合价之和等于目标总价中分部分项清单的份额
 *   如果限价合计中已包含安全文明施工费等，则清单合价之和应等于目标总价
 *   平均下浮率 = 1 - 目标单价/限价单价，反映每条清单相对限价的下浮幅度
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { compareItems, strategyItems, table7FileBase64, maxPriceTotal, targetDiscountRate } = body as {
      compareItems?: Array<{
        row: number;
        category: string;
        code: string;
        name: string;
        quantity: number;
        ourUnitPrice: number;
        ourTotalPrice: number;
        maxUnitPrice: number;
        maxTotalPrice: number;
      }>;
      strategyItems?: Array<{
        row: number;
        category: string;
        strategyLevel: string;
      }>;
      table7FileBase64?: string;
      maxPriceTotal?: number;
      targetDiscountRate?: number;
    };

    if (maxPriceTotal === undefined || targetDiscountRate === undefined) {
      return NextResponse.json({
        success: false,
        error: '请提供：maxPriceTotal(最高投标限价合计), targetDiscountRate(总下浮率)',
      }, { status: 400 });
    }
    const usableCompareItems = compareItems?.length
      ? compareItems
      : table7FileBase64
        ? await buildCompareItemsFromPricingExcel(table7FileBase64, maxPriceTotal)
        : [];

    if (!usableCompareItems.length) {
      return NextResponse.json({ success: false, error: '请先完成步骤3限价对比，或上传清单组价表进行简化配平' }, { status: 400 });
    }

    // 2. 第一级：总价配平
    const targetTotal = maxPriceTotal * (1 - targetDiscountRate);
    const priceAdjustResult = totalLevelPricing(targetTotal, maxPriceTotal);

    // 3. 使用步骤3已经匹配好的真实限价清单
    const allItems = usableCompareItems.map((item) => ({
      row: item.row,
      category: item.category,
      code: item.code,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.ourUnitPrice,
      totalPrice: item.ourTotalPrice,
      maxUnitPrice: item.maxUnitPrice,
    }));

    // 从strategyItems构建strategyRules
    const strategyRules = (strategyItems ?? []).map(si => ({
      row: si.row,
      strategy: si.strategyLevel,
      category: si.category,
    }));

    // 4. 第二级：清单配平 — 按策略分档调整
    const balancedItems = listLevelPricing(allItems, targetTotal, strategyRules, targetDiscountRate);

    // 计算平均下浮率和权重
    const totalTarget = balancedItems.reduce((s, i) => s + i.targetTotalPrice, 0);
    for (const item of balancedItems) {
      item.averageDiscountRate = item.maxUnitPrice > 0
        ? round4(1 - item.targetUnitPrice / item.maxUnitPrice)
        : 0;
      item.weightRatio = totalTarget > 0
        ? round4(item.targetTotalPrice / totalTarget)
        : 0;
    }

    // 5. 校验约束
    const validation = validateConstraints(balancedItems, maxPriceTotal, targetTotal);

    return NextResponse.json({
      success: true,
      level1: priceAdjustResult,
      level2: {
        totalItems: balancedItems.length,
        targetTotal,
        actualTotal: balancedItems.reduce((s, i) => s + i.targetTotalPrice, 0),
        items: balancedItems,
      },
      validation,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** 第一级：总价配平 */
function totalLevelPricing(targetTotal: number, maxPriceTotal: number) {
  return {
    maxPriceTotal,
    targetTotal,
    totalDiscount: maxPriceTotal - targetTotal,
    discountRate: (maxPriceTotal - targetTotal) / maxPriceTotal,
    pass: true,
  };
}

/** 第二级：清单配平
 * 策略分5档系数（参考表6的设计）：
 *  强报高(策略7): 0.78~0.80
 *  中报高(策略6): 0.74~0.76
 *  正常 (策略4/5): 0.62~0.66
 *  中报低(策略2): 0.50~0.54
 *  强报低(策略1): 0.46~0.50
 */
function listLevelPricing(
  items: Array<{
    row: number; category: string; code: string; name: string;
    quantity: number; unitPrice: number; totalPrice: number; maxUnitPrice: number;
  }>,
  targetTotal: number,
  strategyRules: Array<{ row: number; strategy: string; category: string }>,
  averageDiscountRate: number,
): Array<{
  row: number; category: string; code: string; name: string;
  quantity: number; unitPrice: number; totalPrice: number;
  maxUnitPrice: number; strategy: string; priceRatio: number;
  targetUnitPrice: number; targetTotalPrice: number;
  averageDiscountRate: number; weightRatio: number;
}> {
  const strategyRatioMap = getStrategyRatioMap(averageDiscountRate);

  // 为每条清单分配策略
  const itemsWithStrategy = items.map((item) => {
    const rule = strategyRules.find((r) => r.row === item.row && r.category === item.category);
    const strategy = rule?.strategy ?? '平均';
    const [ratioMin, ratioMax] = strategyRatioMap[strategy] ?? [0.62, 0.66];
    const ratio = (ratioMin + ratioMax) / 2; // 取中间值
    return { ...item, strategy, priceRatio: ratio, averageDiscountRate: 0, weightRatio: 0 };
  });

  // 计算初始目标价
  const withTarget = itemsWithStrategy.map((item) => {
    const targetUnitPrice = round2(item.maxUnitPrice * item.priceRatio);
    const targetTotalPrice = round2(item.quantity * targetUnitPrice);
    return { ...item, targetUnitPrice, targetTotalPrice };
  });

  // 统一平移：使所有清单目标价之和 = 目标总价
  const currentTotal = withTarget.reduce((s, i) => s + i.targetTotalPrice, 0);
  const scaleFactor = targetTotal / currentTotal;

  const balanced = withTarget.map((item) => {
    const adjustedTargetPrice = round2(item.targetTotalPrice * scaleFactor);
    const adjustedUnitPrice = item.quantity !== 0 ? round2(adjustedTargetPrice / item.quantity) : 0;
    const finalTargetPrice = round2(item.quantity * adjustedUnitPrice);
    return { ...item, targetUnitPrice: adjustedUnitPrice, targetTotalPrice: finalTargetPrice, priceRatio: round4(adjustedUnitPrice / item.maxUnitPrice) };
  });

  return balanced;
}

/** 校验约束条件 */
function validateConstraints(
  items: Array<{ targetUnitPrice: number; maxUnitPrice: number; targetTotalPrice: number; strategy: string }>,
  maxPriceTotal: number,
  targetTotal: number,
) {
  const actualTotal = items.reduce((s, i) => s + i.targetTotalPrice, 0);

  // 清单系数约束：0.455 ≤ 清单系数 ≤ 0.845
  const coefficientViolations = items.filter((i) => {
    const ratio = i.targetUnitPrice / i.maxUnitPrice;
    return ratio < 0.455 || ratio > 0.845;
  });

  // 总价差额
  const totalDiff = Math.abs(actualTotal - targetTotal);

  return {
    totalDiff: round2(totalDiff),
    totalDiffRate: round4(totalDiff / targetTotal),
    totalPass: totalDiff < 1, // 差额<1元
    coefficientRange: { min: 0.455, max: 0.845 },
    coefficientViolationCount: coefficientViolations.length,
    coefficientPass: coefficientViolations.length === 0,
    overallPass: totalDiff < 1 && coefficientViolations.length === 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function getStrategyRatioMap(averageDiscountRate: number): Record<string, [number, number]> {
  const avg = Math.min(Math.max(averageDiscountRate, 0.01), 0.95);
  const low = Math.max(avg * 0.3, 0);
  const high = Math.min(avg * 1.7, 0.95);
  const midHigh = (low + avg) / 2;
  const midLow = (avg + high) / 2;
  const toRatio = (range: [number, number]): [number, number] => [round4(1 - range[1]), round4(1 - range[0])];

  return {
    '极高': toRatio([0, low]),
    '高': toRatio([low, midHigh]),
    '平均偏高': toRatio([midHigh, avg]),
    '平均': toRatio([Math.max(avg - 0.03, 0), Math.min(avg + 0.03, 0.95)]),
    '平均偏低': toRatio([avg, midLow]),
    '低': toRatio([midLow, high]),
    '极低': toRatio([high, 0.95]),
  };
}

async function buildCompareItemsFromPricingExcel(fileBase64: string, maxPriceTotal: number) {
  const buffer = Buffer.from(fileBase64, 'base64');
  const workbook = await readExcelToWorkbook(new Uint8Array(buffer).buffer);
  const { workbook: calcWb } = calculateWorkbook(workbook);
  const bidItems: Array<{
    row: number;
    category: string;
    code: string;
    name: string;
    quantity: number;
    ourUnitPrice: number;
    ourTotalPrice: number;
    maxUnitPrice: number;
    maxTotalPrice: number;
  }> = [];

  for (const cat of getAnalysisSheets(calcWb)) {
    const sheet = cat.data;
    for (const row of getMainRows(sheet)) {
      const code = String(sheet.get(`${row},2`)?.value ?? '').replace(/\s+/g, '').trim();
      const name = String(sheet.get(`${row},3`)?.value ?? '').trim();
      const quantity = toNum(sheet.get(`${row},5`)?.value);
      const ourUnitPrice = toNum(sheet.get(`${row},6`)?.value);
      const ourTotalPrice = toNum(sheet.get(`${row},7`)?.value);
      if (!code || !name) continue;
      bidItems.push({
        row,
        category: cat.category,
        code,
        name,
        quantity,
        ourUnitPrice,
        ourTotalPrice,
        maxUnitPrice: ourUnitPrice,
        maxTotalPrice: ourTotalPrice,
      });
    }
  }

  const ourTotal = bidItems.reduce((sum, item) => sum + item.ourTotalPrice, 0);
  const ratio = ourTotal > 0 ? maxPriceTotal / ourTotal : 1;
  return bidItems.map((item) => ({
    ...item,
    maxUnitPrice: item.ourUnitPrice * ratio,
    maxTotalPrice: item.ourTotalPrice * ratio,
  }));
}

function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  if (v instanceof Error) return 0;
  return 0;
}
