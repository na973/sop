import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import type { CellValue, CellData, WorkbookData } from '@/lib/formula-engine/types';
import { buildFormulaWorkbook } from '@/lib/bidding/formula-workbook-export';
import { getAnalysisSheetName, getNextMainRowOrEnd, getMainRows } from '@/lib/bidding/excel-sheets';

/** 安全取数：CellValue | undefined → number */
function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (v instanceof Error) return 0;
  return typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);
}

type BalancedInputItem = {
  row: number;
  category: string;
  code: string;
  name: string;
  quantity: number;
  strategy?: string;
  isScreeningItem?: boolean;
  maxUnitPrice?: number;
  targetUnitPrice: number;
  targetTotalPrice: number;
  targetPriceRatioRange?: [number, number];
  targetDiscountRange?: [number, number];
};

type ResolvedBalancedItem = BalancedInputItem & {
  sourceRow: number;
  mappingStatus: 'matched-same-row' | 'matched' | 'sheet-not-found' | 'not-found' | 'ambiguous';
  mappingReason: string;
  minAllowedUnitPrice: number;
  maxAllowedUnitPrice: number;
};

type ResourceInfo = {
  row: number;
  priceCol: number;
  code: string;
  name: string;
  unit: string;
  originalPrice: number;
  adjustedPrice: number;
  isAdjustable: boolean;
  fixed?: boolean;
  reviewRequired: boolean;
  reviewReason?: string;
};

type LockedPriceChange = {
  row?: number;
  priceCol?: number;
  code: string;
  adjustedPrice: number;
  fixed?: boolean;
};

type FixedPriceOverride = {
  adjustedPrice: number;
  fixed: boolean;
};

type ResourceContribution = {
  resourceCode: string;
  itemKey: string;
  itemName: string;
  desiredDelta: number;
  weight: number;
  priorityWeight: number;
  direction: -1 | 0 | 1;
};

type ResourceAggregation = {
  priceDeltaByCode: Map<string, number>;
  warnings: Array<{
    code: string;
    name: string;
    reason: string;
    desiredDelta?: number;
    appliedDelta?: number;
    contributionCount?: number;
  }>;
  sharedResources: Array<{ code: string; name: string; itemCount: number }>;
  conflictResources: Array<{ code: string; name: string; positive: number; negative: number; appliedDelta: number }>;
};

type PlanMetrics = {
  projectTotal: number;
  projectDiff: number;
  projectAbsDiff: number;
  listTotal: number;
  listDiff: number;
  itemTotalAbsDiff: number;
  rangeCompliantCount: number;
  rangeViolationCount: number;
  rangeViolationAmount: number;
};

const RESOURCE_DELTA_LIMIT = 0.6;

/** 步骤6：工料机调价配平 — 三级配平第三级（最复杂）
 *  核心：修改工料机单价 → 公式回算清单单价 → 汇总校验总价
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { table7FileBase64, fileBase64, balancedItems, targetProjectTotal, tolerance = 200, lockedPriceChanges = [] } = body as {
      table7FileBase64?: string;
      fileBase64?: string;
      balancedItems?: BalancedInputItem[];
      targetProjectTotal?: number;
      tolerance?: number;
      lockedPriceChanges?: LockedPriceChange[];
    };

    if (!balancedItems?.length) {
      return NextResponse.json({
        success: false,
        error: '请提供：balancedItems(步骤5的配平结果)',
      }, { status: 400 });
    }
    if (!Number.isFinite(targetProjectTotal) || (targetProjectTotal ?? 0) <= 0) {
      return NextResponse.json({
        success: false,
        error: '请提供：targetProjectTotal(步骤5的目标投标总价)，步骤6必须按完整工程造价校验',
      }, { status: 400 });
    }

    // 1. 读取表7
    let fileBuffer: Buffer;
    const base64 = fileBase64 || table7FileBase64;
    if (base64) {
      fileBuffer = Buffer.from(base64, 'base64');
    } else {
      return NextResponse.json({ success: false, error: '请提供步骤2上传的清单组价表base64' }, { status: 400 });
    }

    // 2. 第三级：工料机调价配平
    const result = await materialLevelPricing(fileBuffer, balancedItems, targetProjectTotal!, tolerance, lockedPriceChanges);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** 三级配平核心算法 — 按清单差额分摊到其关联的可调工料机 */
async function materialLevelPricing(
  arrayBuffer: ArrayBuffer | Buffer,
  balancedItems: BalancedInputItem[],
  targetProjectTotal: number,
  tolerance: number,
  lockedPriceChanges: LockedPriceChange[],
) {
  // 1. 读取步骤2上传的清单组价表，并先补齐/规范公式，后续所有结果都通过公式引擎重算。
  const ab = Buffer.isBuffer(arrayBuffer) ? arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength) as ArrayBuffer : arrayBuffer;
  const formulaWorkbook = await buildFormulaWorkbook(ab);
  const formulaBuffer = formulaWorkbook.buffer.buffer.slice(
    formulaWorkbook.buffer.byteOffset,
    formulaWorkbook.buffer.byteOffset + formulaWorkbook.buffer.byteLength,
  ) as ArrayBuffer;
  const originalWb = await readExcelToWorkbook(formulaBuffer);
  const resolvedBalancedItems = resolveBalancedItemsAgainstWorkbook(originalWb, balancedItems);

  // 2. 提取工料机汇总表结构
  const resourceSheet = originalWb.get('工料机汇总表');
  if (!resourceSheet) {
    return { success: false, error: '未找到工料机汇总表' };
  }

  // 3. 构建工料机资源列表（人工、材料、机械均可调价）
  const adjustableResources = extractAdjustableResources(resourceSheet);
  const fixedOverrides = buildFixedOverrideMap(lockedPriceChanges);
  applyFixedPriceOverrides(adjustableResources, fixedOverrides);
  const adjustableCount = adjustableResources.filter(r => r.isAdjustable).length;
  if (adjustableCount === 0) {
    return { success: false, error: '没有可调价的工料机资源' };
  }

  // 4. 建立清单→工料机映射关系
  const itemResourceMap = buildItemResourceMapping(originalWb, resolvedBalancedItems);

  // 5. 目标清单合价。步骤6只负责让分部分项清单价格贴近步骤5目标，
  // 完整工程造价由公式引擎重算后单独展示，不能和清单合价混为一个目标。
  const targetListTotal = resolvedBalancedItems.reduce((s, i) => s + i.targetTotalPrice, 0);

  // 6. 首次计算基准总价
  const baseWb = cloneWorkbook(originalWb);
  const { workbook: baseCalcWb } = calculateWorkbook(baseWb);
  const baseListTotal = calcBalancedItemsTotal(baseCalcWb, resolvedBalancedItems);
  const baseProjectTotal = calcProjectTotal(baseCalcWb);

  const resourceByCode = new Map(adjustableResources.map((res) => [normalizeCode(res.code), res]));
  const contributionsByCode = new Map<string, ResourceContribution[]>();
  const itemAdjustmentLog: Array<{
    item: string;
    currentUnitPrice: number;
    targetUnitPrice: number;
    unitDiff: number;
    currentTotal: number;
    targetTotal: number;
    diff: number;
    adjustedResourceCount: number;
    adjustableCoverageRate: number;
    manualReviewRequired: boolean;
    reviewReason?: string;
    isScreeningItem?: boolean;
    priorityWeight?: number;
  }> = [];

  const itemPlans = resolvedBalancedItems
    .map((item) => {
      const sheet = baseCalcWb.get(getAnalysisSheetName(item.category));
      const currentUnitPrice = toNum(sheet?.get(`${item.row},6`)?.value);
      const currentTotal = toNum(sheet?.get(`${item.row},7`)?.value);
      const diff = item.targetTotalPrice - currentTotal;
      const unitDiff = item.targetUnitPrice - currentUnitPrice;
      const rangeViolation = getRangeViolation(currentUnitPrice, item);
      const priorityWeight = getItemAdjustmentPriority({
        item,
        diff,
        unitDiff,
        rangeViolationAmount: rangeViolation.amount,
      });
      return {
        item,
        currentUnitPrice,
        currentTotal,
        diff,
        unitDiff,
        priorityWeight,
      };
    })
    .sort((a, b) => b.priorityWeight - a.priorityWeight);

  for (const plan of itemPlans) {
    const { item, currentUnitPrice, currentTotal, diff, unitDiff, priorityWeight } = plan;
    const mappingKey = `${item.category}-${item.row}`;
    const resources = (itemResourceMap.get(mappingKey) || [])
      .map((resource) => ({ ...resource, master: resourceByCode.get(resource.resourceCode) }))
      .filter((resource) => resource.master?.isAdjustable && !resource.master.fixed && resource.master.originalPrice > 0 && resource.consumption > 0);
    const allResources = itemResourceMap.get(mappingKey) || [];

    if (Math.abs(unitDiff) <= 0.01 || resources.length === 0) {
      const coverage = calcAdjustableCoverage(currentUnitPrice, resources);
      itemAdjustmentLog.push({
        item: `${item.category} R${item.row}`,
        currentUnitPrice: round2(currentUnitPrice),
        targetUnitPrice: round2(item.targetUnitPrice),
        unitDiff: round2(unitDiff),
        currentTotal: round2(currentTotal),
        targetTotal: round2(item.targetTotalPrice),
        diff: round2(diff),
        adjustedResourceCount: resources.length,
        adjustableCoverageRate: round4(coverage),
        manualReviewRequired: resources.length === 0 && allResources.length > 0,
        reviewReason: resources.length === 0 ? '没有可自动调价的人工/材料/机械资源，需人工复核' : undefined,
        isScreeningItem: Boolean(item.isScreeningItem),
        priorityWeight: round4(priorityWeight),
      });
      continue;
    }

    const adjustableBase = resources.reduce((sum, resource) => sum + resource.consumption * resource.master!.originalPrice, 0);
    if (adjustableBase <= 0) continue;
    const coverage = calcAdjustableCoverage(currentUnitPrice, resources);

    for (const resource of resources) {
      const weight = (resource.consumption * resource.master!.originalPrice) / adjustableBase;
      const priceDelta = (unitDiff * weight) / resource.consumption;
      const contributions = contributionsByCode.get(resource.resourceCode) || [];
      contributions.push({
        resourceCode: resource.resourceCode,
        itemKey: `${item.category}-${item.row}`,
        itemName: item.name,
        desiredDelta: priceDelta,
        weight: Math.max(resource.consumption * resource.master!.originalPrice, 0.0001),
        priorityWeight,
        direction: priceDelta > 0 ? 1 : priceDelta < 0 ? -1 : 0,
      });
      contributionsByCode.set(resource.resourceCode, contributions);
    }

    itemAdjustmentLog.push({
      item: `${item.category} R${item.row}`,
      currentUnitPrice: round2(currentUnitPrice),
      targetUnitPrice: round2(item.targetUnitPrice),
      unitDiff: round2(unitDiff),
      currentTotal: round2(currentTotal),
      targetTotal: round2(item.targetTotalPrice),
      diff: round2(diff),
      adjustedResourceCount: resources.length,
      adjustableCoverageRate: round4(coverage),
      manualReviewRequired: coverage < 0.15,
      reviewReason: coverage < 0.15 ? '可调资源覆盖率偏低，自动调价可能难以贴近目标单价' : undefined,
      isScreeningItem: Boolean(item.isScreeningItem),
      priorityWeight: round4(priorityWeight),
    });
  }
  const resourceAggregation = aggregateResourceDeltas(contributionsByCode, resourceByCode);
  const cumulativePriceDeltaByCode = new Map(resourceAggregation.priceDeltaByCode);
  const iterationLog: Array<{
    iteration: number;
    totalDiff: number;
    projectDiff: number;
    listDiff: number;
    adjustedCount: number;
  }> = [];

  let bestWb = cloneWorkbook(originalWb);
  let bestCalcWb = calculateWorkbook(bestWb).workbook;
  let bestMetrics = getPlanMetrics(bestCalcWb, resolvedBalancedItems, targetProjectTotal);

  // ---- Phase 1 + residual rounds: first target each item, then correct remaining item/list residuals ----
  const maxIterations = 50;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const trialWb = cloneWorkbook(originalWb);
    const trialResSheet = trialWb.get('工料机汇总表');
    if (!trialResSheet) return { success: false, error: '未找到工料机汇总表' };
    applyScaledResourcePrices(trialResSheet, adjustableResources, cumulativePriceDeltaByCode, 1);

    const { workbook: trialCalcWb } = calculateWorkbook(trialWb);
    const metrics = getPlanMetrics(trialCalcWb, resolvedBalancedItems, targetProjectTotal);
    iterationLog.push({
      iteration,
      totalDiff: round2(metrics.projectDiff),
      projectDiff: round2(metrics.projectDiff),
      listDiff: round2(metrics.listDiff),
      adjustedCount: cumulativePriceDeltaByCode.size,
    });

    if (isBetterPlan(metrics, bestMetrics, tolerance)) {
      bestWb = trialWb;
      bestCalcWb = trialCalcWb;
      bestMetrics = metrics;
    }
    if (isProjectWithinTargetWindow(metrics, tolerance)) break;

    const residualDeltas = buildProjectTotalCorrectionDeltas(
      metrics,
      trialCalcWb,
      resolvedBalancedItems,
      itemResourceMap,
      resourceByCode,
    );
    if (residualDeltas.size === 0) break;
    mergeDeltaMaps(cumulativePriceDeltaByCode, residualDeltas, 0.9);
  }
  const selectedReason = buildNoGlobalScaleReason(bestMetrics, tolerance);
  const iterations = iterationLog.length;

  // 更新adjustedPrice
  for (const res of adjustableResources) {
    if (!res.isAdjustable || res.originalPrice <= 0) continue;
    if (res.fixed) continue;
    const delta = cumulativePriceDeltaByCode.get(normalizeCode(res.code)) || 0;
    const limitedDelta = clamp(delta, -res.originalPrice * RESOURCE_DELTA_LIMIT, res.originalPrice * RESOURCE_DELTA_LIMIT);
    const basePrice = Math.max(0.01, round2(res.originalPrice + limitedDelta));
    res.adjustedPrice = basePrice;
  }

  const finalListTotal = calcBalancedItemsTotal(bestCalcWb, resolvedBalancedItems);
  const finalProjectTotal = calcProjectTotal(bestCalcWb);
  const finalListDiff = finalListTotal - targetListTotal;
  const finalProjectDiff = finalProjectTotal - targetProjectTotal;
  const finalDiff = finalProjectDiff;
  const finalMetrics = bestMetrics;

  // 10. 提取调价前后对比
  const priceChanges = extractPriceChanges(originalWb, bestWb, adjustableResources);
  const adjustedItems = extractAdjustedItems(bestCalcWb, resolvedBalancedItems);
  const itemDiagnostics = buildItemDiagnostics(bestCalcWb, resolvedBalancedItems, itemResourceMap, resourceByCode);

  // 11. 校验结果
  const converged = finalDiff <= 0 && Math.abs(finalDiff) <= tolerance;
  const validation = {
    targetTotal: round2(targetListTotal),
    actualTotal: round2(finalListTotal),
    diff: round2(finalListDiff),
    pass: converged,
    iterations,
    converged,
    bestScaleFactor: 1,
    targetType: '完整投标总价',
    targetProjectTotal: round2(targetProjectTotal),
    projectTotal: round2(finalProjectTotal),
    projectDiff: round2(finalProjectDiff),
    tolerance: round2(tolerance),
    toleranceRule: `调整后完整总价不高于目标总价，且低于目标总价不超过${round2(tolerance)}元`,
    baseProjectTotal: round2(baseProjectTotal),
    formulaErrors: 0,
    itemTotalAbsDiff: round2(finalMetrics.itemTotalAbsDiff),
    rangeCompliantCount: finalMetrics.rangeCompliantCount,
    rangeViolationCount: finalMetrics.rangeViolationCount,
    rangeViolationAmount: round2(finalMetrics.rangeViolationAmount),
    selectedReason,
  };

  return {
    level3: {
      adjustableResourceCount: adjustableCount,
      priceChanges,
      adjustedItems,
      manualReviewResources: adjustableResources
        .filter((resource) => resource.reviewRequired)
        .map((resource) => ({
          row: resource.row,
          code: resource.code,
          name: resource.name,
          reason: resource.reviewReason,
        })),
      iterationLog,
      itemAdjustmentLog: itemAdjustmentLog.slice(0, 100),
      itemDiagnostics,
      resourceWarnings: resourceAggregation.warnings,
      sharedResources: resourceAggregation.sharedResources,
      conflictResources: resourceAggregation.conflictResources,
      rowMappingLog: resolvedBalancedItems
        .filter((item) => item.sourceRow !== item.row || !['matched', 'matched-same-row'].includes(item.mappingStatus))
        .map((item) => ({
          category: item.category,
          code: item.code,
          name: item.name,
          step5Row: item.sourceRow,
          step2Row: item.row,
          status: item.mappingStatus,
          reason: item.mappingReason,
        }))
        .slice(0, 100),
      baseTotal: round2(baseListTotal),
      baseProjectTotal: round2(baseProjectTotal),
      formulaWorkbookStats: formulaWorkbook.stats,
      method: 'step2-formula-workbook + item-resource-allocation + formula-engine-recalc',
    },
    validation,
    finalSummary: extractSummary(bestCalcWb),
  };
}

function extractAdjustedItems(
  calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  balancedItems: ResolvedBalancedItem[],
) {
  return balancedItems.map((item) => {
    const sheet = calcWb.get(getAnalysisSheetName(item.category));
    const adjustedUnitPrice = toNum(sheet?.get(`${item.row},6`)?.value);
    const adjustedTotalPrice = toNum(sheet?.get(`${item.row},7`)?.value);
    const maxUnitPrice = item.maxUnitPrice || 0;
    const maxTotalPrice = round2(maxUnitPrice * item.quantity);
    const rangeViolation = getRangeViolation(adjustedUnitPrice, item);

    return {
      row: item.row,
      category: item.category,
      code: item.code,
      name: item.name,
      isScreeningItem: Boolean(item.isScreeningItem),
      quantity: item.quantity,
      maxUnitPrice: round2(maxUnitPrice),
      maxTotalPrice,
      targetUnitPrice: round2(item.targetUnitPrice),
      targetTotalPrice: round2(item.targetTotalPrice),
      adjustedUnitPrice: round2(adjustedUnitPrice),
      adjustedTotalPrice: round2(adjustedTotalPrice),
      discountRate: maxUnitPrice > 0 ? round4(1 - adjustedUnitPrice / maxUnitPrice) : 0,
      minAllowedUnitPrice: round2(item.minAllowedUnitPrice),
      maxAllowedUnitPrice: round2(item.maxAllowedUnitPrice),
      targetDiscountRateRange: maxUnitPrice > 0
        ? [round4(1 - item.maxAllowedUnitPrice / maxUnitPrice), round4(1 - item.minAllowedUnitPrice / maxUnitPrice)]
        : [0, 0],
      rangeCompliant: rangeViolation.amount <= 0.01,
      rangeViolation,
      unitPriceDiff: round2(adjustedUnitPrice - item.targetUnitPrice),
      totalPriceDiff: round2(adjustedTotalPrice - item.targetTotalPrice),
    };
  });
}

function applyScaledResourcePrices(
  resourceSheet: Map<string, { value: CellValue; isFormula: boolean; formula?: string }>,
  resources: Array<{ row: number; priceCol?: number; code: string; originalPrice: number; adjustedPrice?: number; isAdjustable: boolean; fixed?: boolean }>,
  priceDeltaByCode: Map<string, number>,
  scale: number,
) {
  for (const res of resources) {
    if (!res.isAdjustable || res.originalPrice <= 0) continue;
    const delta = res.fixed ? 0 : priceDeltaByCode.get(normalizeCode(res.code)) || 0;
    const limitedDelta = clamp(delta, -res.originalPrice * RESOURCE_DELTA_LIMIT, res.originalPrice * RESOURCE_DELTA_LIMIT);
    const basePrice = res.fixed
      ? Math.max(0.01, round2(res.adjustedPrice ?? res.originalPrice))
      : Math.max(0.01, round2(res.originalPrice + limitedDelta));
    const scaledPrice = Math.max(0.01, round2(basePrice * scale));
    const cell = resourceSheet.get(`${res.row},${res.priceCol ?? 6}`);
    if (cell) cell.value = scaledPrice;
  }
}

function getPlanMetrics(
  calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  balancedItems: ResolvedBalancedItem[],
  targetProjectTotal: number,
): PlanMetrics {
  let itemTotalAbsDiff = 0;
  let rangeCompliantCount = 0;
  let rangeViolationCount = 0;
  let rangeViolationAmount = 0;
  let listTotal = 0;

  for (const item of balancedItems) {
    const sheet = calcWb.get(getAnalysisSheetName(item.category));
    const actualTotal = toNum(sheet?.get(`${item.row},7`)?.value);
    const actualUnitPrice = toNum(sheet?.get(`${item.row},6`)?.value);
    listTotal += actualTotal;
    itemTotalAbsDiff += Math.abs(actualTotal - item.targetTotalPrice);
    const violation = getRangeViolation(actualUnitPrice, item);
    if (violation.amount <= 0.01) rangeCompliantCount++;
    else {
      rangeViolationCount++;
      rangeViolationAmount += violation.amount * Math.max(item.quantity, 1);
    }
  }

  const projectTotal = calcProjectTotal(calcWb);
  const projectDiff = projectTotal - targetProjectTotal;
  const targetListTotal = balancedItems.reduce((sum, item) => sum + item.targetTotalPrice, 0);

  return {
    projectTotal,
    projectDiff,
    projectAbsDiff: Math.abs(projectDiff),
    listTotal,
    listDiff: listTotal - targetListTotal,
    itemTotalAbsDiff,
    rangeCompliantCount,
    rangeViolationCount,
    rangeViolationAmount,
  };
}

function isBetterPlan(candidate: PlanMetrics, current: PlanMetrics, tolerance: number): boolean {
  const candidateInTolerance = isProjectWithinTargetWindow(candidate, tolerance);
  const currentInTolerance = isProjectWithinTargetWindow(current, tolerance);

  if (candidateInTolerance !== currentInTolerance) return candidateInTolerance;
  if (!candidateInTolerance && !currentInTolerance) {
    const candidateDistance = getTargetWindowDistance(candidate, tolerance);
    const currentDistance = getTargetWindowDistance(current, tolerance);
    if (Math.abs(candidateDistance - currentDistance) > 0.01) return candidateDistance < currentDistance;
    if ((candidate.projectDiff <= 0) !== (current.projectDiff <= 0)) return candidate.projectDiff <= 0;
    return candidate.projectAbsDiff < current.projectAbsDiff;
  }
  if (candidate.rangeCompliantCount !== current.rangeCompliantCount) return candidate.rangeCompliantCount > current.rangeCompliantCount;
  if (Math.abs(candidate.rangeViolationAmount - current.rangeViolationAmount) > 0.01) {
    return candidate.rangeViolationAmount < current.rangeViolationAmount;
  }
  if (Math.abs(candidate.itemTotalAbsDiff - current.itemTotalAbsDiff) > 0.01) {
    return candidate.itemTotalAbsDiff < current.itemTotalAbsDiff;
  }
  return candidate.projectAbsDiff < current.projectAbsDiff;
}

function isProjectWithinTargetWindow(metrics: Pick<PlanMetrics, 'projectDiff'>, tolerance: number): boolean {
  return metrics.projectDiff <= 0 && Math.abs(metrics.projectDiff) <= Math.abs(tolerance);
}

function getTargetWindowDistance(metrics: Pick<PlanMetrics, 'projectDiff'>, tolerance: number): number {
  const allowedUnder = Math.abs(tolerance);
  if (isProjectWithinTargetWindow(metrics, allowedUnder)) return 0;
  if (metrics.projectDiff > 0) return metrics.projectDiff;
  return Math.abs(metrics.projectDiff) - allowedUnder;
}

function buildResidualResourceDeltas(
  calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  items: ResolvedBalancedItem[],
  itemResourceMap: Map<string, Array<{ resourceCode: string; consumption: number }>>,
  resourceByCode: Map<string, ResourceInfo>,
): Map<string, number> {
  const contributionsByCode = new Map<string, ResourceContribution[]>();

  const residualPlans = items
    .map((item) => {
      const sheet = calcWb.get(getAnalysisSheetName(item.category));
      const currentUnitPrice = toNum(sheet?.get(`${item.row},6`)?.value);
      const currentTotal = toNum(sheet?.get(`${item.row},7`)?.value);
      const unitDiff = item.targetUnitPrice - currentUnitPrice;
      const diff = item.targetTotalPrice - currentTotal;
      const rangeViolation = getRangeViolation(currentUnitPrice, item);
      const priorityWeight = getItemAdjustmentPriority({
        item,
        diff,
        unitDiff,
        rangeViolationAmount: rangeViolation.amount,
      });
      return { item, unitDiff, priorityWeight };
    })
    .filter((plan) => Math.abs(plan.unitDiff) > 0.01)
    .sort((a, b) => b.priorityWeight - a.priorityWeight);

  for (const { item, unitDiff, priorityWeight } of residualPlans) {
    const resources = (itemResourceMap.get(`${item.category}-${item.row}`) || [])
      .map((resource) => ({ ...resource, master: resourceByCode.get(normalizeCode(resource.resourceCode)) }))
      .filter((resource) => resource.master?.isAdjustable && !resource.master.fixed && resource.master.originalPrice > 0 && resource.consumption > 0);
    const adjustableBase = resources.reduce((sum, resource) => sum + resource.consumption * resource.master!.originalPrice, 0);
    if (adjustableBase <= 0) continue;

    for (const resource of resources) {
      const weight = (resource.consumption * resource.master!.originalPrice) / adjustableBase;
      const priceDelta = (unitDiff * weight) / resource.consumption;
      const code = normalizeCode(resource.resourceCode);
      const contributions = contributionsByCode.get(code) || [];
      contributions.push({
        resourceCode: code,
        itemKey: `${item.category}-${item.row}`,
        itemName: item.name,
        desiredDelta: priceDelta,
        weight: Math.max(resource.consumption * resource.master!.originalPrice, 0.0001),
        priorityWeight,
        direction: priceDelta > 0 ? 1 : priceDelta < 0 ? -1 : 0,
      });
      contributionsByCode.set(code, contributions);
    }
  }

  return aggregateResourceDeltas(contributionsByCode, resourceByCode).priceDeltaByCode;
}

function buildProjectTotalCorrectionDeltas(
  metrics: PlanMetrics,
  calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  items: ResolvedBalancedItem[],
  itemResourceMap: Map<string, Array<{ resourceCode: string; consumption: number }>>,
  resourceByCode: Map<string, ResourceInfo>,
): Map<string, number> {
  const projectGap = -metrics.projectDiff;
  const targetListTotal = items.reduce((sum, item) => sum + item.targetTotalPrice, 0);
  const taxLinkedFactor = metrics.listTotal > 0 && metrics.projectTotal > 0
    ? Math.max(0.5, Math.min(1.5, metrics.projectTotal / metrics.listTotal))
    : 1.09;
  const listCorrection = projectGap / taxLinkedFactor;
  const correctionPlans = items
    .map((item) => {
      const sheet = calcWb.get(getAnalysisSheetName(item.category));
      const currentUnitPrice = toNum(sheet?.get(`${item.row},6`)?.value);
      const currentTotal = toNum(sheet?.get(`${item.row},7`)?.value);
      const itemShare = targetListTotal > 0 ? item.targetTotalPrice / targetListTotal : 1 / Math.max(items.length, 1);
      const totalDiff = item.targetTotalPrice - currentTotal;
      const rangeViolation = getRangeViolation(currentUnitPrice, item);
      const priorityWeight = getItemAdjustmentPriority({
        item,
        diff: totalDiff,
        unitDiff: item.targetUnitPrice - currentUnitPrice,
        rangeViolationAmount: rangeViolation.amount,
      });
      const correctionTotal = listCorrection * itemShare;
      const unitDiff = item.quantity !== 0 ? correctionTotal / item.quantity : 0;
      return { item, unitDiff, priorityWeight };
    })
    .filter((plan) => Math.abs(plan.unitDiff) > 0.0001)
    .sort((a, b) => b.priorityWeight - a.priorityWeight);

  const projectDeltas = buildResourceDeltasFromUnitDiffs(correctionPlans, itemResourceMap, resourceByCode);
  if (projectDeltas.size > 0) return projectDeltas;

  return buildResidualResourceDeltas(calcWb, items, itemResourceMap, resourceByCode);
}

function buildResourceDeltasFromUnitDiffs(
  plans: Array<{ item: ResolvedBalancedItem; unitDiff: number; priorityWeight: number }>,
  itemResourceMap: Map<string, Array<{ resourceCode: string; consumption: number }>>,
  resourceByCode: Map<string, ResourceInfo>,
): Map<string, number> {
  const contributionsByCode = new Map<string, ResourceContribution[]>();

  for (const { item, unitDiff, priorityWeight } of plans) {
    const resources = (itemResourceMap.get(`${item.category}-${item.row}`) || [])
      .map((resource) => ({ ...resource, master: resourceByCode.get(normalizeCode(resource.resourceCode)) }))
      .filter((resource) => resource.master?.isAdjustable && !resource.master.fixed && resource.master.originalPrice > 0 && resource.consumption > 0);
    const adjustableBase = resources.reduce((sum, resource) => sum + resource.consumption * resource.master!.originalPrice, 0);
    if (adjustableBase <= 0) continue;

    for (const resource of resources) {
      const weight = (resource.consumption * resource.master!.originalPrice) / adjustableBase;
      const priceDelta = (unitDiff * weight) / resource.consumption;
      const code = normalizeCode(resource.resourceCode);
      const contributions = contributionsByCode.get(code) || [];
      contributions.push({
        resourceCode: code,
        itemKey: `${item.category}-${item.row}`,
        itemName: item.name,
        desiredDelta: priceDelta,
        weight: Math.max(resource.consumption * resource.master!.originalPrice, 0.0001),
        priorityWeight,
        direction: priceDelta > 0 ? 1 : priceDelta < 0 ? -1 : 0,
      });
      contributionsByCode.set(code, contributions);
    }
  }

  return aggregateResourceDeltas(contributionsByCode, resourceByCode).priceDeltaByCode;
}

function mergeDeltaMaps(target: Map<string, number>, source: Map<string, number>, damping: number) {
  for (const [code, delta] of source) {
    target.set(code, (target.get(code) || 0) + delta * damping);
  }
}

function getItemAdjustmentPriority(input: {
  item: Pick<ResolvedBalancedItem, 'isScreeningItem' | 'quantity' | 'targetTotalPrice'>;
  diff: number;
  unitDiff: number;
  rangeViolationAmount: number;
}): number {
  const absTotalDiff = Math.abs(input.diff);
  const absUnitDiff = Math.abs(input.unitDiff) * Math.max(Math.abs(input.item.quantity), 1);
  const rangePenalty = input.rangeViolationAmount * Math.max(Math.abs(input.item.quantity), 1);
  const base = Math.max(absTotalDiff, absUnitDiff, rangePenalty, Math.abs(input.item.targetTotalPrice) * 0.0001, 0.0001);
  return base * (input.item.isScreeningItem ? 5 : 1);
}

function buildSelectionReason(metrics: PlanMetrics, tolerance: number): string {
  if (!isProjectWithinTargetWindow(metrics, tolerance)) {
    return `完整总价未进入目标窗口（不高于目标，且低于目标不超过${round2(tolerance)}元），选择距离目标窗口最近方案：差额${round2(metrics.projectDiff)}元`;
  }
  return `完整总价已进入目标窗口（比目标低${round2(Math.abs(metrics.projectDiff))}元），优先选择范围合规${metrics.rangeCompliantCount}项、范围违规${metrics.rangeViolationCount}项、清单总偏差${round2(metrics.itemTotalAbsDiff)}元的方案`;
}

function buildNoGlobalScaleReason(metrics: PlanMetrics, tolerance: number): string {
  const totalText = isProjectWithinTargetWindow(metrics, tolerance)
    ? `完整总价已进入目标窗口（不高于目标，且低于目标不超过${round2(tolerance)}元）`
    : `完整总价差额${round2(metrics.projectDiff)}元，未进入目标窗口（不高于目标，且低于目标不超过${round2(tolerance)}元）`;
  return `${totalText}；当前按每条清单的步骤4建议等级和工料机构成分别调价，并启用清单剩余差额迭代补偿；未启用所有资源统一乘系数的二次缩放；范围合规${metrics.rangeCompliantCount}项，范围违规${metrics.rangeViolationCount}项，清单总偏差${round2(metrics.itemTotalAbsDiff)}元`;
}

function aggregateResourceDeltas(
  contributionsByCode: Map<string, ResourceContribution[]>,
  resourceByCode: Map<string, ResourceInfo>,
): ResourceAggregation {
  const priceDeltaByCode = new Map<string, number>();
  const warnings: ResourceAggregation['warnings'] = [];
  const sharedResources: ResourceAggregation['sharedResources'] = [];
  const conflictResources: ResourceAggregation['conflictResources'] = [];

  for (const [code, contributions] of contributionsByCode) {
    const resource = resourceByCode.get(code);
    if (!resource || contributions.length === 0) continue;

    const totalWeight = contributions.reduce((sum, item) => sum + item.weight * item.priorityWeight, 0);
    const weightedDelta = totalWeight > 0
      ? contributions.reduce((sum, item) => sum + item.desiredDelta * item.weight * item.priorityWeight, 0) / totalWeight
      : 0;
    const positive = contributions.filter((item) => item.direction > 0).length;
    const negative = contributions.filter((item) => item.direction < 0).length;
    const uniqueItems = new Set(contributions.map((item) => item.itemKey));
    const limit = resource.originalPrice * RESOURCE_DELTA_LIMIT;
    const appliedDelta = clamp(weightedDelta, -limit, limit);

    if (uniqueItems.size > 1) {
      sharedResources.push({ code, name: resource.name, itemCount: uniqueItems.size });
    }
    if (positive > 0 && negative > 0) {
      conflictResources.push({ code, name: resource.name, positive, negative, appliedDelta: round2(appliedDelta) });
      warnings.push({
        code,
        name: resource.name,
        reason: '同一工料机在多条清单中的调价方向冲突，已按贡献金额加权平均并限制自动调价幅度',
        desiredDelta: round2(weightedDelta),
        appliedDelta: round2(appliedDelta),
        contributionCount: contributions.length,
      });
    }
    if (Math.abs(weightedDelta - appliedDelta) > 0.01) {
      warnings.push({
        code,
        name: resource.name,
        reason: `调价幅度超过原价${Math.round(RESOURCE_DELTA_LIMIT * 100)}%保护阈值，已截断`,
        desiredDelta: round2(weightedDelta),
        appliedDelta: round2(appliedDelta),
        contributionCount: contributions.length,
      });
    }

    priceDeltaByCode.set(code, appliedDelta);
  }

  return { priceDeltaByCode, warnings, sharedResources, conflictResources };
}

function calcAdjustableCoverage(
  currentUnitPrice: number,
  resources: Array<{ consumption: number; master?: ResourceInfo }>,
): number {
  if (currentUnitPrice <= 0) return 0;
  const adjustableBase = resources.reduce((sum, resource) => {
    return sum + resource.consumption * (resource.master?.originalPrice || 0);
  }, 0);
  return Math.min(Math.max(adjustableBase / currentUnitPrice, 0), 1);
}

function buildItemDiagnostics(
  calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  items: ResolvedBalancedItem[],
  itemResourceMap: Map<string, Array<{ resourceCode: string; consumption: number }>>,
  resourceByCode: Map<string, ResourceInfo>,
) {
  return items.map((item) => {
    const sheet = calcWb.get(getAnalysisSheetName(item.category));
    const adjustedUnitPrice = toNum(sheet?.get(`${item.row},6`)?.value);
    const adjustedTotalPrice = toNum(sheet?.get(`${item.row},7`)?.value);
    const resources = itemResourceMap.get(`${item.category}-${item.row}`) || [];
    const adjustableResources = resources
      .map((resource) => ({ ...resource, master: resourceByCode.get(resource.resourceCode) }))
      .filter((resource) => resource.master?.isAdjustable && resource.master.originalPrice > 0 && resource.consumption > 0);
    const coverage = calcAdjustableCoverage(adjustedUnitPrice, adjustableResources);
    const rangeViolation = getRangeViolation(adjustedUnitPrice, item);
    const reviewReasons: string[] = [];
    if (!['matched', 'matched-same-row'].includes(item.mappingStatus)) reviewReasons.push(item.mappingReason);
    if (adjustableResources.length === 0) reviewReasons.push('没有有效可调资源');
    if (coverage < 0.15) reviewReasons.push('可调资源覆盖率偏低');
    if (rangeViolation.amount > 0.01) reviewReasons.push(`调整后单价${rangeViolation.direction === 'high' ? '高于' : '低于'}步骤5允许范围`);

    return {
      row: item.row,
      sourceRow: item.sourceRow,
      category: item.category,
      code: item.code,
      name: item.name,
      targetUnitPrice: round2(item.targetUnitPrice),
      adjustedUnitPrice: round2(adjustedUnitPrice),
      unitPriceDiff: round2(adjustedUnitPrice - item.targetUnitPrice),
      targetTotalPrice: round2(item.targetTotalPrice),
      adjustedTotalPrice: round2(adjustedTotalPrice),
      totalPriceDiff: round2(adjustedTotalPrice - item.targetTotalPrice),
      minAllowedUnitPrice: round2(item.minAllowedUnitPrice),
      maxAllowedUnitPrice: round2(item.maxAllowedUnitPrice),
      rangeCompliant: rangeViolation.amount <= 0.01,
      rangeViolation,
      adjustableResourceCount: adjustableResources.length,
      adjustableCoverageRate: round4(coverage),
      sharedResourceCodes: resources
        .map((resource) => resource.resourceCode)
        .filter((code, index, arr) => arr.indexOf(code) === index),
      manualReviewRequired: reviewReasons.length > 0,
      reviewReasons,
    };
  });
}

function getRangeViolation(
  adjustedUnitPrice: number,
  item: Pick<ResolvedBalancedItem, 'minAllowedUnitPrice' | 'maxAllowedUnitPrice' | 'maxUnitPrice' | 'strategy'>,
) {
  const tolerance = getRangeTolerance(item);
  if (adjustedUnitPrice < item.minAllowedUnitPrice - tolerance) {
    return { direction: 'low' as const, amount: round2(item.minAllowedUnitPrice - adjustedUnitPrice) };
  }
  if (adjustedUnitPrice > item.maxAllowedUnitPrice + tolerance) {
    return { direction: 'high' as const, amount: round2(adjustedUnitPrice - item.maxAllowedUnitPrice) };
  }
  return { direction: 'none' as const, amount: 0 };
}

function getRangeTolerance(item: Pick<ResolvedBalancedItem, 'maxUnitPrice' | 'strategy'>): number {
  if (item.strategy === '极高' || item.strategy === '极低') return 0.01;
  return Math.max(0.01, round2((item.maxUnitPrice || 0) * 0.02));
}

function resolveBalancedItemsAgainstWorkbook(
  wb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  balancedItems: BalancedInputItem[],
) {
  return balancedItems.map((item) => {
    const allowedRange = getAllowedUnitPriceRange(item);
    const sheet = wb.get(getAnalysisSheetName(item.category));
    if (!sheet) {
      return {
        ...item,
        ...allowedRange,
        sourceRow: item.row,
        mappingStatus: 'sheet-not-found' as const,
        mappingReason: `未找到单位工程对应的综合单价分析表：${item.category}`,
      };
    }

    const mainRows = getMainRows(sheet);
    const normalizedCode = normalizeCode(item.code);
    const normalizedName = normalizeText(item.name);
    const candidates = mainRows
      .map((row) => ({
        row,
        code: normalizeCode(String(sheet.get(`${row},2`)?.value ?? '')),
        name: normalizeText(String(sheet.get(`${row},3`)?.value ?? '')),
        quantity: toNum(sheet.get(`${row},5`)?.value),
      }))
      .filter((candidate) => candidate.code === normalizedCode);

    if (candidates.length === 0) {
      return {
        ...item,
        ...allowedRange,
        sourceRow: item.row,
        mappingStatus: 'not-found' as const,
        mappingReason: `在${item.category}中未找到项目编码${item.code}`,
      };
    }

    const scored = candidates
      .map((candidate) => {
        const nameScore = candidate.name === normalizedName
          ? 100
          : candidate.name.includes(normalizedName) || normalizedName.includes(candidate.name)
            ? 50
            : 0;
        const quantityBase = Math.max(Math.abs(item.quantity), 1);
        const quantityDiffRate = Math.abs(candidate.quantity - item.quantity) / quantityBase;
        const quantityScore = Math.max(0, 40 - quantityDiffRate * 100);
        const rowScore = candidate.row === item.row ? 10 : 0;
        return {
          ...candidate,
          score: nameScore + quantityScore + rowScore,
          reason: `名称${nameScore === 100 ? '完全匹配' : nameScore > 0 ? '包含匹配' : '未匹配'}，工程量差异率${(quantityDiffRate * 100).toFixed(2)}%`,
        };
      })
      .sort((a, b) => b.score - a.score);
    const matched = scored[0];
    const tied = scored.filter((candidate) => Math.abs(candidate.score - matched.score) < 0.0001);
    const ambiguous = tied.length > 1 && matched.score < 140;

    return {
      ...item,
      ...allowedRange,
      sourceRow: item.row,
      row: matched.row,
      mappingStatus: ambiguous ? 'ambiguous' as const : matched.row === item.row ? 'matched-same-row' as const : 'matched' as const,
      mappingReason: ambiguous
        ? `重复编码无法唯一定位，最高分候选${tied.length}个；暂使用评分最高行，需人工复核`
        : matched.reason,
    };
  });
}

function getAllowedUnitPriceRange(item: BalancedInputItem): { minAllowedUnitPrice: number; maxAllowedUnitPrice: number } {
  const maxUnitPrice = item.maxUnitPrice || 0;
  if (item.targetPriceRatioRange) {
    const [minRatio, maxRatio] = item.targetPriceRatioRange;
    return {
      minAllowedUnitPrice: round2(maxUnitPrice * minRatio),
      maxAllowedUnitPrice: round2(maxUnitPrice * maxRatio),
    };
  }
  if (item.targetDiscountRange) {
    const [minDiscount, maxDiscount] = item.targetDiscountRange;
    return {
      minAllowedUnitPrice: round2(maxUnitPrice * (1 - maxDiscount)),
      maxAllowedUnitPrice: round2(maxUnitPrice * (1 - minDiscount)),
    };
  }
  return {
    minAllowedUnitPrice: round2(item.targetUnitPrice),
    maxAllowedUnitPrice: round2(item.targetUnitPrice),
  };
}

function normalizeCode(value: string): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 提取可调价的工料机资源 */
function extractAdjustableResources(
  resourceSheet: Map<string, { value: CellValue; isFormula: boolean; formula?: string }>,
): ResourceInfo[] {
  const resources: ResourceInfo[] = [];
  const columns = detectResourceColumns(resourceSheet);

  for (const [key, cell] of resourceSheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === columns.codeCol && r > columns.headerRow && cell.value !== null && cell.value !== undefined) {
      const code = String(cell.value).trim();
      const name = String(resourceSheet.get(`${r},${columns.nameCol}`)?.value ?? '').trim();
      const unit = String(resourceSheet.get(`${r},${columns.unitCol}`)?.value ?? '').trim();
      const price = toNum(resourceSheet.get(`${r},${columns.priceCol}`)?.value);

      // 人工、材料、机械均允许参与调价；汇总类/不可竞争费用和无法识别项进入人工复核。
      const materialCheck = classifyAdjustableMaterial(code, name);
      const defaultFixed = isDefaultFixedResource(name);

      if (code && code !== 'null') {
        resources.push({
          row: r,
          priceCol: columns.priceCol,
          code,
          name,
          unit,
          originalPrice: price,
          adjustedPrice: price,
          isAdjustable: materialCheck.isAdjustable,
          fixed: defaultFixed,
          reviewRequired: materialCheck.reviewRequired,
          reviewReason: defaultFixed ? '临时材料费/其他材料费默认固定，人工可取消固定' : materialCheck.reason,
        });
      }
    }
  }

  return resources;
}

function buildFixedOverrideMap(lockedPriceChanges: LockedPriceChange[]) {
  const fixedOverrides = new Map<string, FixedPriceOverride>();
  for (const change of lockedPriceChanges) {
    const price = Number(change.adjustedPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    fixedOverrides.set(normalizeCode(change.code), {
      adjustedPrice: round2(price),
      fixed: Boolean(change.fixed),
    });
  }
  return fixedOverrides;
}

function applyFixedPriceOverrides(resources: ResourceInfo[], fixedOverrides: Map<string, FixedPriceOverride>) {
  for (const resource of resources) {
    const override = fixedOverrides.get(normalizeCode(resource.code));
    if (!override) continue;
    resource.fixed = override.fixed;
    if (override.fixed) {
      resource.adjustedPrice = override.adjustedPrice;
    }
  }
}

function detectResourceColumns(
  sheet: Map<string, { value: CellValue; isFormula: boolean; formula?: string }>,
) {
  const defaults = { headerRow: 1, codeCol: 2, nameCol: 3, unitCol: 4, priceCol: 6 };
  const aliases = {
    codeCol: ['编码', '材料编码', '人材机编码', '工料机编码', '项目编码'],
    nameCol: ['名称', '材料名称', '人材机名称', '工料机名称', '项目名称'],
    unitCol: ['单位'],
    priceCol: ['含税市场价', '含税单价', '市场价', '预算价', '单价'],
  };

  for (let row = 1; row <= 10; row += 1) {
    const found: Partial<typeof defaults> = { headerRow: row };
    for (let col = 1; col <= 30; col += 1) {
      const header = normalizeText(String(sheet.get(`${row},${col}`)?.value ?? ''));
      if (!header) continue;
      if (!found.codeCol && aliases.codeCol.some((name) => header.includes(name))) found.codeCol = col;
      if (!found.nameCol && aliases.nameCol.some((name) => header.includes(name))) found.nameCol = col;
      if (!found.unitCol && aliases.unitCol.some((name) => header === name || header.includes(name))) found.unitCol = col;
      if (!found.priceCol && !header.includes('不含税') && aliases.priceCol.some((name) => header.includes(name))) found.priceCol = col;
    }
    if (found.codeCol && found.nameCol && found.priceCol) {
      return {
        ...defaults,
        ...found,
        unitCol: found.unitCol ?? defaults.unitCol,
      };
    }
  }

  return defaults;
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
      const resourceCode = normalizeCode(String(sheet.get(`${r},4`)?.value ?? '')); // D列=资源编码
      if (!resourceCode || resourceCode === 'null' || resourceCode === '组价内容' || resourceCode === '编码') continue;
      if (resourceCode === 'undefined') continue;

      // 检查是否到了下一个主条目
      const aVal = sheet.get(`${r},1`)?.value;
      if (typeof aVal === 'number' && aVal > 0) break;

      const consumption = toNum(sheet.get(`${r},8`)?.value); // H列=消耗量
      resources.push({ resourceCode, consumption });
    }

    mapping.set(key, resources);
  }

  return mapping;
}

/** 计算公式引擎重算后的完整工程造价 */
function calcProjectTotal(calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>): number {
  const summarySheet = calcWb.get('汇总表');
  if (!summarySheet) return 0;

  for (const [key, cell] of summarySheet) {
    const [row, col] = key.split(',').map(Number);
    if (col !== 2) continue;
    const label = String(cell.value ?? '').replace(/\s+/g, '');
    if (label.includes('合计')) {
      return toNum(summarySheet.get(`${row},3`)?.value);
    }
  }

  return toNum(summarySheet.get('19,3')?.value);
}

/** 计算步骤5涉及的分部分项清单合价 */
function calcBalancedItemsTotal(
  calcWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  balancedItems: Array<{ row: number; category: string }>,
): number {
  return balancedItems.reduce((sum, item) => {
    const sheet = calcWb.get(getAnalysisSheetName(item.category));
    return sum + toNum(sheet?.get(`${item.row},7`)?.value);
  }, 0);
}

/** 提取调价前后对比 */
function extractPriceChanges(
  originalWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  finalWb: Map<string, Map<string, { value: CellValue; isFormula: boolean; formula?: string }>>,
  resources: Array<{ row: number; priceCol?: number; code: string; name: string; isAdjustable: boolean; fixed?: boolean; reviewReason?: string }>,
): Array<{ row: number; priceCol: number; code: string; name: string; originalPrice: number; adjustedPrice: number; diff: number; diffPercent: number; fixed: boolean; isAdjustable: boolean; reviewReason?: string }> {
  const origSheet = originalWb.get('工料机汇总表');
  const finalSheet = finalWb.get('工料机汇总表');
  if (!origSheet || !finalSheet) return [];

  return resources
    .map((res) => {
      const priceCol = res.priceCol ?? 6;
      const origPrice = toNum(origSheet.get(`${res.row},${priceCol}`)?.value);
      const finalPrice = toNum(finalSheet.get(`${res.row},${priceCol}`)?.value);
      return {
        code: res.code,
        row: res.row,
        priceCol,
        name: res.name,
        originalPrice: round2(origPrice),
        adjustedPrice: round2(finalPrice),
        diff: round2(finalPrice - origPrice),
        diffPercent: origPrice !== 0 ? round4((finalPrice - origPrice) / origPrice) : 0,
        fixed: Boolean(res.fixed),
        isAdjustable: res.isAdjustable,
        reviewReason: res.reviewReason,
      };
    });
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

function classifyAdjustableMaterial(code: string, name: string): { isAdjustable: boolean; reviewRequired: boolean; reason?: string } {
  if (!code) return { isAdjustable: false, reviewRequired: true, reason: '缺少编码，无法识别资源类型' };
  const trimmed = code.trim();
  const text = `${trimmed} ${name}`;
  if (isSummaryOrAggregateResource(trimmed, name)) {
    return { isAdjustable: false, reviewRequired: true, reason: '合计/汇总类行不是具体人材机，需人工复核' };
  }
  if (/管理费|企业管理费|利润|风险费|规费|税金|安全文明|暂列金额|专业工程暂估价|总承包服务费|计日工|措施项目费|其他项目费/.test(text)) {
    return { isAdjustable: false, reviewRequired: true, reason: '汇总类或不可竞争费用，需人工复核' };
  }
  if (/^(00|R)/i.test(trimmed)) return { isAdjustable: true, reviewRequired: false, reason: '人工费参与工料机调价' };
  if (/^(01|02|03|C)/i.test(trimmed)) return { isAdjustable: true, reviewRequired: false, reason: '材料费参与工料机调价' };
  if (isMaterialByName(text)) return { isAdjustable: true, reviewRequired: false, reason: '按名称识别为材料费，参与工料机调价' };
  if (/^(99|J)/i.test(trimmed)) return { isAdjustable: true, reviewRequired: false, reason: '机械费参与工料机调价' };
  return { isAdjustable: true, reviewRequired: false, reason: '未命中编码规则，按材料兜底参与工料机调价' };
}

function isSummaryOrAggregateResource(code: string, name: string): boolean {
  const normalizedCode = normalizeText(code);
  const normalizedName = normalizeText(name);
  const text = `${normalizedCode}${normalizedName}`;
  if (!normalizedName) return true;
  if (/合计|小计|汇总|总计|累计|合价|金额|费用合计|材料费合计|人工费合计|机械费合计|价差|差额/.test(text)) return true;
  if (/^(合计|小计|汇总|总计|材料费|人工费|机械费)$/.test(normalizedCode)) return true;
  return false;
}

function isDefaultFixedResource(name: string): boolean {
  const normalizedName = normalizeText(name);
  return /临时材料费|其他材料费/.test(normalizedName);
}

function isMaterialByName(text: string): boolean {
  return /材料|主材|辅材|钢筋|钢板|钢管|钢绞线|型钢|铁件|水泥|砂|碎石|石屑|石灰|粉煤灰|沥青|混凝土|砂浆|砖|砌块|管材|管道|电缆|电线|塑料|土工|土布|土膜|土格栅|玻璃|涂料|油漆|柴油|汽油|苗木|草皮|临时材料费/.test(text);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
