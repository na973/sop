import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import { getAnalysisSheets, getMainRows } from '@/lib/bidding/excel-sheets';
import type { CellValue } from '@/lib/formula-engine/types';

/** 步骤5：清单调价配平 — 总价配平 + 清单配平（三级配平前两级） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      compareItems,
      table7FileBase64,
      maxPriceTotal,
      targetDiscountRate,
      predictedAverageDiscountRate,
      strategyRules,
      limitSummary,
      safetyCivilizedRatePercent,
      professionalEstimateTaxIncluded,
      professionalEstimateTaxRate,
    } = body as {
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
        isScreeningItem?: boolean;
      }>;
      table7FileBase64?: string;
      maxPriceTotal?: number;
      targetDiscountRate?: number;
      predictedAverageDiscountRate?: number;
      strategyRules?: Array<{ row: number; strategy: string; category: string; coefficientRange?: [number, number]; isScreeningItem?: boolean }>;
      limitSummary?: Record<string, number>;
      safetyCivilizedRatePercent?: number;
      professionalEstimateTaxIncluded?: boolean | null;
      professionalEstimateTaxRate?: number;
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

    // 2. 第一级：完整投标总价目标。它只用于完整造价校验，不能直接作为清单配平目标。
    const targetBidTotal = maxPriceTotal * (1 - targetDiscountRate);

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
      isScreeningItem: Boolean((item as { isScreeningItem?: boolean }).isScreeningItem),
    }));

    // 4. 第二级：清单配平。目标金额来自本项目总下浮率，目标下浮率范围来自预测平均清单等效下浮率。
    const listLimitTotal = allItems.reduce((sum, item) => sum + item.maxUnitPrice * item.quantity, 0);
    const pricingContext = derivePricingContext({
      maxPriceTotal,
      targetBidTotal,
      targetDiscountRate,
      predictedAverageDiscountRate: predictedAverageDiscountRate ?? targetDiscountRate,
      listLimitTotal,
      limitSummary,
      safetyCivilizedRatePercent,
      professionalEstimateTaxIncluded,
      professionalEstimateTaxRate,
    });
    const balancedItems = listLevelPricing(
      allItems,
      pricingContext.targetAdjustableAmount,
      strategyRules ?? [],
      pricingContext.predictedEquivalentListDiscountRate,
    );

    // 5. 两级校验：清单配平校验 + 完整工程造价校验。
    const validation = validateConstraints(balancedItems, pricingContext);

    return NextResponse.json({
      success: true,
      level1: pricingContext.level1,
      level2: {
        totalItems: balancedItems.length,
        targetTotal: pricingContext.targetAdjustableAmount,
        actualTotal: balancedItems.reduce((s, i) => s + i.targetTotalPrice, 0),
        items: balancedItems,
      },
      pricingContext,
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

type PricingContext = {
  level1: ReturnType<typeof totalLevelPricing>;
  targetBidTotal: number;
  targetAdjustableAmount: number;
  targetPartFee: number;
  equivalentListDiscountRate: number;
  predictedAverageDiscountRate: number;
  predictedEquivalentListDiscountRate: number;
  listLimitTotal: number;
  coefficientConstraintRange: { min: number; max: number };
  fixedAmounts: {
    measureFee: number;
    otherProjectFee: number;
    fee: number;
    tax: number;
    provisionalSum: number;
    professionalEstimate: number;
    daywork: number;
    generalContractServiceFee: number;
  };
  amountRules: {
    measureRate: number;
    safetyCivilizedRate: number | null;
    otherMeasureFeeFixed: number;
    feeRate: number;
    taxRate: number;
    otherProjectFeeFixed: number;
  };
  targetAmounts: {
    partFee: number;
    measureFee: number;
    otherProjectFee: number;
    fee: number;
    tax: number;
    projectTotal: number;
  };
  professionalEstimate: {
    amount: number;
    taxIncluded: boolean | null;
    taxRate: number;
    participatesInTax: boolean | null;
    participatesInDiscount: boolean;
    participatesInListBalance: boolean;
    reviewRequired: boolean;
  };
  warnings: string[];
};

function derivePricingContext(input: {
  maxPriceTotal: number;
  targetBidTotal: number;
  targetDiscountRate: number;
  predictedAverageDiscountRate: number;
  listLimitTotal: number;
  limitSummary?: Record<string, number>;
  safetyCivilizedRatePercent?: number;
  professionalEstimateTaxIncluded?: boolean | null;
  professionalEstimateTaxRate?: number;
}): PricingContext {
  const {
    maxPriceTotal,
    targetBidTotal,
    targetDiscountRate,
    predictedAverageDiscountRate,
    listLimitTotal,
    limitSummary,
    safetyCivilizedRatePercent,
    professionalEstimateTaxIncluded = null,
    professionalEstimateTaxRate = 0.09,
  } = input;
  const warnings: string[] = [];
  const summary = limitSummary ?? {};
  const partFee = pickAmount(summary, ['建设项目分部分项工程项目费', '分部分项工程费', '单项工程']) || listLimitTotal;
  const measureFee = pickAmount(summary, ['措施项目费']);
  const safetyCivilizedFee = pickAmount(summary, ['其中：安全文明施工费', '安全文明施工费']);
  const otherMeasureFee = pickAmount(summary, ['其他措施项目费']) || Math.max(measureFee - safetyCivilizedFee, 0);
  const otherProjectFee = pickAmount(summary, ['其他项目费']);
  const fee = pickAmount(summary, ['规费']);
  const tax = pickAmount(summary, ['增值税', '税金']);
  const provisionalSum = pickAmount(summary, ['暂列金额']);
  const professionalEstimate = pickAmount(summary, ['专业工程暂估价（含税）', '专业工程暂估价']);
  const daywork = pickAmount(summary, ['计日工']);
  const generalContractServiceFee = pickAmount(summary, ['总承包服务费']);

  if (professionalEstimate > 0 && professionalEstimateTaxIncluded === null) {
    warnings.push('专业工程暂估价是否含税无法自动确认，已标记为人工复核；默认不参与清单配平、不参与下浮。');
  }

  const hasSummary = Object.keys(summary).length > 0;
  const amountRules = deriveAmountRules({
    partFee,
    measureFee,
    safetyCivilizedFee,
    otherMeasureFee,
    otherProjectFee,
    fee,
    tax,
    professionalEstimate,
    professionalEstimateTaxIncluded,
    safetyCivilizedRatePercent,
    fallbackTaxRate: professionalEstimateTaxRate,
  });

  if (hasSummary) {
    // 措施费、规费、税金通常会随分部分项工程费联动，不能把它们当固定金额直接扣减。
    // 这里用汇总表中的原始比例反算：给定完整目标投标总价，倒推出目标分部分项工程费。
    const naivePartFee = partFee * (1 - targetDiscountRate);
    const impliedTotal = calculateProjectAmounts(naivePartFee, amountRules, professionalEstimate, professionalEstimateTaxIncluded).projectTotal;
    if (Number.isFinite(impliedTotal) && Math.abs(impliedTotal - targetBidTotal) > 1000) {
      warnings.push('总价下浮率已按汇总关系反算为清单等效下浮率；措施费、规费、税金随分部分项金额联动计算。');
    }
  } else {
    warnings.push('未识别到完整汇总表，清单目标暂按分部分项限价随总下浮率同比下浮计算。');
  }

  const targetPartFee = hasSummary
    ? solveTargetPartFee(targetBidTotal, partFee, amountRules, professionalEstimate, professionalEstimateTaxIncluded)
    : partFee * (1 - targetDiscountRate);
  const targetAmounts = calculateProjectAmounts(targetPartFee, amountRules, professionalEstimate, professionalEstimateTaxIncluded);
  const targetAdjustableAmount = targetPartFee;
  const equivalentListDiscountRate = listLimitTotal > 0
    ? Math.min(Math.max(1 - targetAdjustableAmount / listLimitTotal, 0.01), 0.95)
    : targetDiscountRate;
  const predictedTargetBidTotal = maxPriceTotal * (1 - predictedAverageDiscountRate);
  const predictedPartFee = hasSummary
    ? solveTargetPartFee(predictedTargetBidTotal, partFee, amountRules, professionalEstimate, professionalEstimateTaxIncluded)
    : partFee * (1 - predictedAverageDiscountRate);
  const predictedEquivalentListDiscountRate = listLimitTotal > 0
    ? Math.min(Math.max(1 - predictedPartFee / listLimitTotal, 0), 0.95)
    : Math.min(Math.max(predictedAverageDiscountRate, 0), 0.95);
  const coefficientConstraintRange = getCoefficientConstraintRange(predictedEquivalentListDiscountRate);
  return {
    level1: totalLevelPricing(targetBidTotal, maxPriceTotal),
    targetBidTotal,
    targetAdjustableAmount,
    targetPartFee,
    equivalentListDiscountRate,
    predictedAverageDiscountRate,
    predictedEquivalentListDiscountRate,
    listLimitTotal,
    coefficientConstraintRange,
    fixedAmounts: {
      measureFee,
      otherProjectFee,
      fee,
      tax,
      provisionalSum,
      professionalEstimate,
      daywork,
      generalContractServiceFee,
    },
    amountRules,
    targetAmounts,
    professionalEstimate: {
      amount: professionalEstimate,
      taxIncluded: professionalEstimateTaxIncluded,
      taxRate: professionalEstimateTaxRate,
      participatesInTax: professionalEstimate > 0 ? professionalEstimateTaxIncluded === false : null,
      participatesInDiscount: false,
      participatesInListBalance: false,
      reviewRequired: professionalEstimate > 0 && professionalEstimateTaxIncluded === null,
    },
    warnings,
  };
}

function getCoefficientConstraintRange(equivalentDiscountRate: number) {
  const baseDiscount = Math.min(Math.max(equivalentDiscountRate, 0), 0.95);
  const minDiscount = Math.min(Math.max(baseDiscount * 0.7, 0), 0.95);
  const maxDiscount = Math.min(Math.max(baseDiscount * 1.3, 0), 0.95);

  return {
    min: round4(1 - maxDiscount),
    max: round4(1 - minDiscount),
  };
}

function deriveAmountRules(input: {
  partFee: number;
  measureFee: number;
  safetyCivilizedFee: number;
  otherMeasureFee: number;
  otherProjectFee: number;
  fee: number;
  tax: number;
  professionalEstimate: number;
  professionalEstimateTaxIncluded: boolean | null;
  safetyCivilizedRatePercent?: number;
  fallbackTaxRate: number;
}) {
  const {
    partFee,
    measureFee,
    safetyCivilizedFee,
    otherMeasureFee,
    otherProjectFee,
    fee,
    tax,
    professionalEstimate,
    professionalEstimateTaxIncluded,
    safetyCivilizedRatePercent,
    fallbackTaxRate,
  } = input;
  const measureRate = partFee > 0 ? measureFee / partFee : 0;
  const safetyCivilizedRate = Number.isFinite(safetyCivilizedRatePercent) && (safetyCivilizedRatePercent ?? 0) > 0
    ? (safetyCivilizedRatePercent ?? 0) / 100
    : partFee > 0 && safetyCivilizedFee > 0
      ? safetyCivilizedFee / partFee
      : null;
  const feeBase = partFee + measureFee;
  const feeRate = feeBase > 0 ? fee / feeBase : 0;
  const taxBase = getTaxBase({
    partFee,
    measureFee,
    otherProjectFee,
    fee,
    professionalEstimate,
    professionalEstimateTaxIncluded,
  });
  const taxRate = tax > 0 && taxBase > 0 ? tax / taxBase : fallbackTaxRate;

  return {
    measureRate: Number.isFinite(measureRate) ? measureRate : 0,
    safetyCivilizedRate: safetyCivilizedRate !== null && Number.isFinite(safetyCivilizedRate) ? safetyCivilizedRate : null,
    otherMeasureFeeFixed: otherMeasureFee,
    feeRate: Number.isFinite(feeRate) ? feeRate : 0,
    taxRate: Number.isFinite(taxRate) ? taxRate : fallbackTaxRate,
    otherProjectFeeFixed: otherProjectFee,
  };
}

function solveTargetPartFee(
  targetBidTotal: number,
  originalPartFee: number,
  rules: PricingContext['amountRules'],
  professionalEstimate: number,
  professionalEstimateTaxIncluded: boolean | null,
): number {
  let low = 0;
  let high = Math.max(originalPartFee, targetBidTotal);

  for (let i = 0; i < 80; i += 1) {
    const total = calculateProjectAmounts(high, rules, professionalEstimate, professionalEstimateTaxIncluded).projectTotal;
    if (total >= targetBidTotal) break;
    high *= 2;
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const total = calculateProjectAmounts(mid, rules, professionalEstimate, professionalEstimateTaxIncluded).projectTotal;
    if (total > targetBidTotal) high = mid;
    else low = mid;
  }

  return round2((low + high) / 2);
}

function calculateProjectAmounts(
  partFee: number,
  rules: PricingContext['amountRules'],
  professionalEstimate: number,
  professionalEstimateTaxIncluded: boolean | null,
) {
  const measureFee = rules.safetyCivilizedRate !== null
    ? round2(partFee * rules.safetyCivilizedRate + rules.otherMeasureFeeFixed)
    : round2(partFee * rules.measureRate);
  const otherProjectFee = rules.otherProjectFeeFixed;
  const fee = round2((partFee + measureFee) * rules.feeRate);
  const taxBase = getTaxBase({
    partFee,
    measureFee,
    otherProjectFee,
    fee,
    professionalEstimate,
    professionalEstimateTaxIncluded,
  });
  const tax = round2(Math.max(taxBase, 0) * rules.taxRate);
  const projectTotal = round2(partFee + measureFee + otherProjectFee + fee + tax);

  return {
    partFee: round2(partFee),
    measureFee,
    otherProjectFee: round2(otherProjectFee),
    fee,
    tax,
    projectTotal,
  };
}

function getTaxBase(input: {
  partFee: number;
  measureFee: number;
  otherProjectFee: number;
  fee: number;
  professionalEstimate: number;
  professionalEstimateTaxIncluded: boolean | null;
}) {
  const {
    partFee,
    measureFee,
    otherProjectFee,
    fee,
    professionalEstimate,
    professionalEstimateTaxIncluded,
  } = input;
  const taxIncludedProfessionalEstimate = professionalEstimateTaxIncluded === false ? 0 : professionalEstimate;
  return partFee + measureFee + otherProjectFee + fee - taxIncludedProfessionalEstimate;
}

function pickAmount(summary: Record<string, number>, names: string[]): number {
  for (const [key, value] of Object.entries(summary)) {
    if (names.some((name) => key.includes(name)) && Number.isFinite(value)) return value;
  }
  return 0;
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
    quantity: number; unitPrice: number; totalPrice: number; maxUnitPrice: number; isScreeningItem?: boolean;
  }>,
  targetTotal: number,
  strategyRules: Array<{ row: number; strategy: string; category: string; coefficientRange?: [number, number]; isScreeningItem?: boolean }>,
  averageDiscountRate: number,
): Array<{
  row: number; category: string; code: string; name: string;
  quantity: number; unitPrice: number; totalPrice: number;
  maxUnitPrice: number; isScreeningItem?: boolean; strategy: string; targetPriceRatio: number; targetPriceRatioRange: [number, number]; priceRatio: number;
  targetUnitPrice: number; targetTotalPrice: number;
}> {
  const strategyRatioMap = getStrategyRatioMap(averageDiscountRate);

  // 为每条清单分配策略
  const itemsWithStrategy = items.map((item) => {
    const rule = strategyRules.find((r) => r.row === item.row && r.category === item.category);
    const strategy = rule?.strategy ?? '平均';
    // 步骤5的目标下浮率范围必须按“预测平均清单等效下浮率”重新计算等级区间，
    // 不能复用步骤4保存的 coefficientRange，也不能把本项目总下浮率误当作范围基数。
    const [ratioMin, ratioMax] = strategyRatioMap[strategy] ?? strategyRatioMap['平均'];
    const ratio = (ratioMin + ratioMax) / 2; // 取中间值
    return { ...item, isScreeningItem: Boolean(rule?.isScreeningItem ?? item.isScreeningItem), strategy, targetPriceRatio: ratio, targetPriceRatioRange: [ratioMin, ratioMax] as [number, number], priceRatio: ratio };
  });

  // 计算初始目标价
  const withTarget = itemsWithStrategy.map((item) => {
    const targetUnitPrice = round2(item.maxUnitPrice * item.priceRatio);
    const targetTotalPrice = round2(item.quantity * targetUnitPrice);
    return { ...item, targetUnitPrice, targetTotalPrice };
  });

  // 按各清单自身策略区间的可调空间分摊差额，避免所有清单统一乘同一个缩放因子。
  const balanced = distributeListTotalByItemCapacity(withTarget, targetTotal);

  return balanced;
}

function distributeListTotalByItemCapacity<T extends {
  quantity: number;
  maxUnitPrice: number;
  strategy: string;
  targetUnitPrice: number;
  targetTotalPrice: number;
  targetPriceRatioRange: [number, number];
}>(items: T[], targetTotal: number): T[] {
  let result = items.map((item) => ({ ...item }));
  let remaining = round2(targetTotal - result.reduce((sum, item) => sum + item.targetTotalPrice, 0));

  // First keep every item inside its target range. Extreme high/low levels remain hard bounds.
  for (let pass = 0; pass < 20 && Math.abs(remaining) > 0.01; pass += 1) {
    const direction = remaining > 0 ? 1 : -1;
    const capacities = result.map((item) => {
      const [ratioMin, ratioMax] = item.targetPriceRatioRange;
      const boundUnitPrice = item.maxUnitPrice * (direction > 0 ? ratioMax : ratioMin);
      const boundTotal = item.quantity * boundUnitPrice;
      const capacity = direction > 0
        ? Math.max(0, boundTotal - item.targetTotalPrice)
        : Math.max(0, item.targetTotalPrice - boundTotal);
      return capacity;
    });
    const totalCapacity = capacities.reduce((sum, value) => sum + value, 0);
    if (totalCapacity <= 0) break;

    result = result.map((item, index) => {
      const move = Math.min(Math.abs(remaining) * (capacities[index] / totalCapacity), capacities[index]) * direction;
      const targetTotalPrice = round2(item.targetTotalPrice + move);
      const targetUnitPrice = item.quantity !== 0 ? round2(targetTotalPrice / item.quantity) : 0;
      return {
        ...item,
        targetUnitPrice,
        targetTotalPrice: round2(item.quantity * targetUnitPrice),
        priceRatio: item.maxUnitPrice > 0 ? round4(targetUnitPrice / item.maxUnitPrice) : 0,
      };
    });

    remaining = round2(targetTotal - result.reduce((sum, item) => sum + item.targetTotalPrice, 0));
  }

  // Target total is the top priority. If range capacity is not enough, only non-extreme levels
  // are allowed to move outside their suggested range; extreme high/low prices stay protected.
  remaining = round2(targetTotal - result.reduce((sum, item) => sum + item.targetTotalPrice, 0));
  if (Math.abs(remaining) > 0.01) {
    result = distributeRemainingToFlexibleItems(result, remaining);
  }

  return result;
}

function distributeRemainingToFlexibleItems<T extends {
  quantity: number;
  maxUnitPrice: number;
  strategy: string;
  targetUnitPrice: number;
  targetTotalPrice: number;
}>(items: T[], remaining: number): T[] {
  let result = items.map((item) => ({ ...item }));
  const direction = remaining > 0 ? 1 : -1;
  const flexibleIndexes = result
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !isStrictRangeStrategy(item.strategy))
    .map(({ index }) => index);

  if (flexibleIndexes.length === 0) return result;

  const targetTotal = result.reduce((sum, item) => sum + item.targetTotalPrice, 0) + remaining;
  const weights = flexibleIndexes.map((index) => {
    const item = result[index];
    return Math.max(Math.abs(item.maxUnitPrice * item.quantity), Math.abs(item.targetTotalPrice), 0.0001);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  result = result.map((item, index) => {
    const flexiblePosition = flexibleIndexes.indexOf(index);
    if (flexiblePosition < 0) return item;

    const rawMove = remaining * (weights[flexiblePosition] / totalWeight);
    const minTotal = direction < 0 ? Math.max(item.quantity * 0.01, 0) : Number.NEGATIVE_INFINITY;
    const nextTotal = direction < 0
      ? Math.max(item.targetTotalPrice + rawMove, minTotal)
      : item.targetTotalPrice + rawMove;
    const targetTotalPrice = round2(nextTotal);
    const targetUnitPrice = item.quantity !== 0 ? round2(targetTotalPrice / item.quantity) : 0;
    return {
      ...item,
      targetUnitPrice,
      targetTotalPrice: round2(item.quantity * targetUnitPrice),
      priceRatio: item.maxUnitPrice > 0 ? round4(targetUnitPrice / item.maxUnitPrice) : 0,
    };
  });

  const residual = round2(targetTotal - result.reduce((sum, item) => sum + item.targetTotalPrice, 0));
  if (Math.abs(residual) > 0.01) {
    const index = flexibleIndexes[0];
    const item = result[index];
    const targetTotalPrice = round2(Math.max(item.targetTotalPrice + residual, item.quantity * 0.01));
    const targetUnitPrice = item.quantity !== 0 ? round2(targetTotalPrice / item.quantity) : 0;
    result[index] = {
      ...item,
      targetUnitPrice,
      targetTotalPrice: round2(item.quantity * targetUnitPrice),
      priceRatio: item.maxUnitPrice > 0 ? round4(targetUnitPrice / item.maxUnitPrice) : 0,
    };
  }

  return result;
}

function isStrictRangeStrategy(strategy: string): boolean {
  return strategy === '极高' || strategy === '极低';
}

/** 校验约束条件 */
function validateConstraints(
  items: Array<{ targetUnitPrice: number; maxUnitPrice: number; targetTotalPrice: number; strategy: string }>,
  pricingContext: PricingContext,
) {
  const actualTotal = items.reduce((s, i) => s + i.targetTotalPrice, 0);

  // 清单系数约束：根据人工预测的所有投标单位平均下浮率反算清单等效下浮率，再上下浮动30%。
  const coefficientRange = pricingContext.coefficientConstraintRange;
  const coefficientViolations = items.filter((i) => {
    const ratio = i.targetUnitPrice / i.maxUnitPrice;
    return ratio < coefficientRange.min || ratio > coefficientRange.max;
  });

  // 一级：清单配平差额。只校验分部分项/可调清单金额，不校验完整工程造价。
  const listDiff = Math.abs(actualTotal - pricingContext.targetAdjustableAmount);

  // 二级：完整工程造价校验。固定费用不被分摊进清单，只在完整造价层校验。
  const fixed = pricingContext.fixedAmounts;
  const actualAmounts = calculateProjectAmounts(
    actualTotal,
    pricingContext.amountRules,
    fixed.professionalEstimate,
    pricingContext.professionalEstimate.taxIncluded,
  );
  const projectTotal = actualAmounts.projectTotal;
  const projectDiff = Math.abs(projectTotal - pricingContext.targetBidTotal);

  return {
    listBalance: {
      targetTotal: round2(pricingContext.targetAdjustableAmount),
      actualTotal: round2(actualTotal),
      diff: round2(listDiff),
      pass: listDiff < 1,
    },
    projectTotal: {
      targetTotal: round2(pricingContext.targetBidTotal),
      actualTotal: round2(projectTotal),
      diff: round2(projectDiff),
      pass: projectDiff < 1,
    },
    totalDiff: round2(listDiff),
    totalDiffRate: round4(listDiff / pricingContext.targetAdjustableAmount),
    totalPass: listDiff < 1,
    coefficientRange,
    predictedAverageDiscountRate: pricingContext.predictedAverageDiscountRate,
    predictedEquivalentListDiscountRate: pricingContext.predictedEquivalentListDiscountRate,
    coefficientViolationCount: coefficientViolations.length,
    coefficientPass: coefficientViolations.length === 0,
    professionalEstimateReviewRequired: pricingContext.professionalEstimate.reviewRequired,
    warnings: pricingContext.warnings,
    overallPass: listDiff < 1
      && projectDiff < 1
      && coefficientViolations.length === 0
      && !pricingContext.professionalEstimate.reviewRequired,
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
    // “平均”为旧数据兼容档，按“平均偏高 + 平均偏低”的合集处理。
    '平均': toRatio([midHigh, midLow]),
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
