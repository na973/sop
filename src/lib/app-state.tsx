'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/* ──────── 类型定义 ──────── */

/** 文件库条目 */
export interface FileEntry {
  id: string;
  name: string;
  base64: string;
  type: 'excel' | 'pdf' | 'text';
  uploadedAt: number;
}

/** 汇总行 */
export interface SummaryRow {
  key: string;
  content: string;
  amount: number;
}

/** 清单条目 */
export interface BidItem {
  row: number;
  category: string;
  code: string;
  name: string;
  feature?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  resources: ResourceRow[];
}

/** 工料机子项 */
export interface ResourceRow {
  row: number;
  code: string;
  name: string;
  type: string;
  consumption: number;
  unitPrice: number;
  totalPrice: number;
}

/** 工料机汇总条目 */
export interface ResourceSummaryItem {
  row: number;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  taxInclusivePrice: number;
  taxRate: number;
  /** 不含税单价 */
  price: number;
  /** 数量 × 不含税单价 */
  totalPrice: number;
}

/** 步骤2结果 */
export interface Step2Data {
  stats: { totalFormulas: number; calculated: number; errorCount: number; firstErrors: Array<{ sheet: string; cell: string; error: string }> };
  summary: Record<string, number>;
  /** 安全文明施工项目清单明细表中的费率，百分数口径，如2.5表示2.5% */
  safetyCivilizedRatePercent?: number;
  bidItems: BidItem[];
  resourceSummary: ResourceSummaryItem[];
}

/** 步骤3限价对比条目 */
export interface PriceCompareItem {
  row: number;
  category: string;
  code: string;
  name: string;
  feature?: string;
  unit: string;
  quantity: number;
  ourUnitPrice: number;
  ourTotalPrice: number;
  maxUnitPrice: number;
  maxTotalPrice: number;
  limitPriceSource?: 'pdf' | 'excel' | 'summary' | 'none';
  itemReviewPrice?: number;
  screeningRank?: number;
  screeningBasis?: string;
  isAbnormalBidItem?: boolean;
  abnormalDeviationRate?: number;
  totalDeviationRate?: number;
  limitQuantity?: number;
  limitName?: string;
  quantityDiff?: number;
  nameMatched?: boolean;
  deviationRate: number;
  deviationLevel: string;
  isScreeningItem: boolean;
}

/** 步骤4策略条目 */
export interface StrategyItem {
  row: number;
  category: string;
  code: string;
  name: string;
  feature?: string;
  unit: string;
  quantity: number;
  maxUnitPrice: number;
  maxTotalPrice?: number;
  ourUnitPrice: number;
  deviationRate: number;
  deviationLevel: string;
  isScreeningItem: boolean;
  itemReviewPrice?: number;
  screeningRank?: number;
  screeningBasis?: string;
  isAbnormalBidItem?: boolean;
  quantityForecast?: string;
  optimization?: string;
  projectMajorType?: string;
  projectSubType?: string;
  checklistStep?: string;
  profitOpportunity?: string;
  reviewStatus?: string;
  strategyLevel: string;
  discountRange?: [number, number];
  coefficientRange: [number, number];
  suggestion: string;
  reason?: string;
}

/** 步骤5配平条目 */
export interface BalancedItem {
  row: number;
  category: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  maxUnitPrice: number;
  isScreeningItem?: boolean;
  strategy: string;
  targetPriceRatio?: number;
  targetPriceRatioRange?: [number, number];
  priceRatio: number;
  targetUnitPrice: number;
  targetTotalPrice: number;
}

/** 步骤6工料机调价条目 */
export interface PriceChange {
  row: number;
  priceCol?: number;
  code: string;
  name: string;
  originalPrice: number;
  adjustedPrice: number;
  diff: number;
  diffPercent?: number;
  fixed?: boolean;
  isAdjustable?: boolean;
  reviewReason?: string;
}

export interface AdjustedBidItem {
  row: number;
  category: string;
  code: string;
  name: string;
  isScreeningItem?: boolean;
  quantity: number;
  maxUnitPrice: number;
  maxTotalPrice: number;
  targetUnitPrice: number;
  targetTotalPrice: number;
  adjustedUnitPrice: number;
  adjustedTotalPrice: number;
  discountRate: number;
  minAllowedUnitPrice?: number;
  maxAllowedUnitPrice?: number;
  targetDiscountRateRange?: [number, number];
  rangeCompliant?: boolean;
  rangeViolation?: { direction: 'low' | 'high' | 'none'; amount: number };
  unitPriceDiff?: number;
  totalPriceDiff?: number;
}

/** 步骤5结果 */
export interface Step5Data {
  level1: { maxPriceTotal: number; targetTotal: number; totalDiscount: number; discountRate: number; pass: boolean };
  level2: { totalItems: number; targetTotal: number; actualTotal: number; items: BalancedItem[] };
  validation: {
    totalDiff: number;
    totalDiffRate: number;
    totalPass: boolean;
    coefficientRange: { min: number; max: number };
    predictedAverageDiscountRate: number;
    predictedEquivalentListDiscountRate: number;
    coefficientViolationCount: number;
    coefficientPass: boolean;
    overallPass: boolean;
  };
}

/** 步骤6结果 */
export interface Step6Data {
  level3: {
    adjustableResourceCount: number;
    priceChanges: PriceChange[];
    adjustedItems: AdjustedBidItem[];
    baseTotal: number;
    baseProjectTotal?: number;
    iterationLog: Array<{ iteration: number; totalDiff: number; adjustedCount: number }>;
    itemAdjustmentLog?: unknown[];
    itemDiagnostics?: unknown[];
    rowMappingLog?: unknown[];
    resourceWarnings?: unknown[];
    sharedResources?: unknown[];
    conflictResources?: unknown[];
    manualReviewResources?: unknown[];
    formulaWorkbookStats?: unknown;
    method: string;
  };
  validation: {
    targetTotal: number;
    actualTotal: number;
    diff: number;
    pass: boolean;
    iterations: number;
    converged: boolean;
    bestScaleFactor?: number;
    targetType?: string;
    targetProjectTotal?: number;
    projectTotal?: number;
    projectDiff?: number;
    tolerance?: number;
    baseProjectTotal?: number;
    itemTotalAbsDiff?: number;
    rangeCompliantCount?: number;
    rangeViolationCount?: number;
    rangeViolationAmount?: number;
    selectedReason?: string;
  };
  finalSummary: SummaryRow[] | null;
}

/** 步骤1提取结果 */
export interface Step1Data {
  items: Array<{ category: string; items: Array<{ label: string; value: string; editable?: boolean }> }>;
}

/** 全局应用状态 */
export interface AppState {
  /** 文件库 */
  fileLibrary: FileEntry[];
  /** 各步骤选中的文件ID */
  selectedFileIds: Record<number, string>;

  step1Data: Step1Data | null;
  step2Data: Step2Data | null;
  step3Data: PriceCompareItem[] | null;
  step3LimitSummary: Record<string, number> | null;
  step4Data: StrategyItem[] | null;
  step5Data: Step5Data | null;
  step6Data: Step6Data | null;
  step7FileBase64: string | null;
  step7FileName: string | null;

  /** 最高投标限价合计（用户输入） */
  maxPriceTotal: number;
  /** 总下浮率（用户输入，如0.05表示5%） */
  targetDiscountRate: number;
  /** 人工预测所有投标单位平均下浮率（用于评标单价约束） */
  predictedAverageDiscountRate: number;
}

const initialState: AppState = {
  fileLibrary: [],
  selectedFileIds: {},

  step1Data: null,
  step2Data: null,
  step3Data: null,
  step3LimitSummary: null,
  step4Data: null,
  step5Data: null,
  step6Data: null,
  step7FileBase64: null,
  step7FileName: null,

  maxPriceTotal: 0,
  targetDiscountRate: 0.05,
  predictedAverageDiscountRate: 0.05,
};

/* ──────── Context ──────── */

interface AppContextValue {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  /** 便捷更新部分状态 */
  updateState: (partial: Partial<AppState>) => void;
  /** 添加文件到文件库 */
  addFile: (entry: Omit<FileEntry, 'id' | 'uploadedAt'>) => string;
  /** 获取指定步骤选中的文件 */
  getSelectedFile: (step: number) => FileEntry | undefined;
  /** 选择文件给某步骤 */
  selectFile: (step: number, fileId: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const updateState = useCallback((partial: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const addFile = useCallback((entry: Omit<FileEntry, 'id' | 'uploadedAt'>) => {
    const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newFile: FileEntry = { ...entry, id, uploadedAt: Date.now() };
    setState((prev) => ({
      ...prev,
      fileLibrary: [...prev.fileLibrary, newFile],
    }));
    return id;
  }, []);

  const getSelectedFile = useCallback((step: number) => {
    const fileId = state.selectedFileIds[step];
    if (!fileId) return undefined;
    return state.fileLibrary.find((f) => f.id === fileId);
  }, [state.selectedFileIds, state.fileLibrary]);

  const selectFile = useCallback((step: number, fileId: string) => {
    setState((prev) => ({
      ...prev,
      selectedFileIds: { ...prev.selectedFileIds, [step]: fileId },
    }));
  }, []);

  return (
    <AppContext.Provider value={{ state, setState, updateState, addFile, getSelectedFile, selectFile }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}
