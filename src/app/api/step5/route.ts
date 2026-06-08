import { NextRequest, NextResponse } from 'next/server';

/** 步骤5：清单调价配平 — 总价配平 + 清单配平（三级配平前两级） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { compareItems, maxPriceTotal, targetDiscountRate, strategyRules } = body as {
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
      maxPriceTotal?: number;
      targetDiscountRate?: number;
      strategyRules?: Array<{ row: number; strategy: string; category: string }>;
    };

    if (maxPriceTotal === undefined || targetDiscountRate === undefined) {
      return NextResponse.json({
        success: false,
        error: '请提供：maxPriceTotal(最高投标限价合计), targetDiscountRate(总下浮率)',
      }, { status: 400 });
    }
    if (!compareItems?.length) {
      return NextResponse.json({ success: false, error: '请先完成步骤3限价对比，提供compareItems' }, { status: 400 });
    }

    // 2. 第一级：总价配平
    const targetTotal = maxPriceTotal * (1 - targetDiscountRate);
    const priceAdjustResult = totalLevelPricing(targetTotal, maxPriceTotal);

    // 3. 使用步骤3已经匹配好的真实限价清单
    const allItems = compareItems.map((item) => ({
      row: item.row,
      category: item.category,
      code: item.code,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.ourUnitPrice,
      totalPrice: item.ourTotalPrice,
      maxUnitPrice: item.maxUnitPrice,
    }));

    // 4. 第二级：清单配平 — 按策略分档调整
    const balancedItems = listLevelPricing(allItems, targetTotal, strategyRules ?? []);

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
): Array<{
  row: number; category: string; code: string; name: string;
  quantity: number; unitPrice: number; totalPrice: number;
  maxUnitPrice: number; strategy: string; priceRatio: number;
  targetUnitPrice: number; targetTotalPrice: number;
}> {
  // 策略→系数范围映射
  const strategyRatioMap: Record<string, [number, number]> = {
    '极高': [0.78, 0.80],
    '高': [0.74, 0.76],
    '平均偏高': [0.68, 0.72],
    '平均': [0.62, 0.66],
    '平均偏低': [0.56, 0.60],
    '低': [0.50, 0.54],
    '极低': [0.46, 0.50],
  };

  // 为每条清单分配策略
  const itemsWithStrategy = items.map((item) => {
    const rule = strategyRules.find((r) => r.row === item.row && r.category === item.category);
    const strategy = rule?.strategy ?? '平均';
    const [ratioMin, ratioMax] = strategyRatioMap[strategy] ?? [0.62, 0.66];
    const ratio = (ratioMin + ratioMax) / 2; // 取中间值
    return { ...item, strategy, priceRatio: ratio };
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
