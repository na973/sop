'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/* ──────── 类型定义 ──────── */

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
  price: number;
  totalPrice: number;
}

/** 步骤2结果 */
export interface Step2Data {
  stats: { totalFormulas: number; calculated: number; errorCount: number; firstErrors: Array<{ sheet: string; cell: string; error: string }> };
  summary: Record<string, number>;
  bidItems: BidItem[];
  resourceSummary: ResourceSummaryItem[];
}

/** 步骤3限价对比条目 */
export interface PriceCompareItem {
  row: number;
  category: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  ourUnitPrice: number;
  ourTotalPrice: number;
  maxUnitPrice: number;
  maxTotalPrice: number;
  limitPriceSource?: 'pdf' | 'excel';
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
  unit: string;
  quantity: number;
  maxUnitPrice: number;
  ourUnitPrice: number;
  deviationLevel: string;
  isScreeningItem: boolean;
  quantityForecast: string;
  optimization: string;
  totalScore: number;
  strategyLevel: string;
  coefficientRange: [number, number];
  suggestion: string;
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
  strategy: string;
  priceRatio: number;
  targetUnitPrice: number;
  targetTotalPrice: number;
}

/** 步骤6材料调价条目 */
export interface PriceChange {
  row: number;
  code: string;
  name: string;
  originalPrice: number;
  adjustedPrice: number;
  diff: number;
}

/** 步骤5结果 */
export interface Step5Data {
  level1: { maxPriceTotal: number; targetTotal: number; totalDiscount: number; discountRate: number; pass: boolean };
  level2: { totalItems: number; targetTotal: number; actualTotal: number; items: BalancedItem[] };
  validation: { totalDiff: number; totalDiffRate: number; totalPass: boolean; coefficientViolationCount: number; coefficientPass: boolean; overallPass: boolean };
}

/** 步骤6结果 */
export interface Step6Data {
  level3: { adjustableResourceCount: number; priceChanges: PriceChange[]; baseTotal: number; iterationLog: Array<{ iteration: number; totalDiff: number; adjustedCount: number }>; method: string };
  validation: { targetTotal: number; actualTotal: number; diff: number; pass: boolean; iterations: number; converged: boolean };
  finalSummary: SummaryRow[] | null;
}

/** 全局应用状态 */
export interface AppState {
  /** 已加载的Excel文件名 */
  fileName: string;
  /** Excel文件Base64（供后续步骤使用） */
  fileBase64: string;

  step1Completed: boolean;
  step2Data: Step2Data | null;
  step3Data: PriceCompareItem[] | null;
  step4Data: StrategyItem[] | null;
  step5Data: Step5Data | null;
  step6Data: Step6Data | null;
  step7Completed: boolean;
  step8Completed: boolean;

  /** 最高投标限价合计（用户输入） */
  maxPriceTotal: number;
  /** 总下浮率（用户输入，如0.05表示5%） */
  targetDiscountRate: number;
}

const initialState: AppState = {
  fileName: '',
  fileBase64: '',
  step1Completed: false,
  step2Data: null,
  step3Data: null,
  step4Data: null,
  step5Data: null,
  step6Data: null,
  step7Completed: false,
  step8Completed: false,
  maxPriceTotal: 0,
  targetDiscountRate: 0.05,
};

/* ──────── Context ──────── */

interface AppContextValue {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  /** 便捷更新部分状态 */
  updateState: (partial: Partial<AppState>) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const updateState = useCallback((partial: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  return (
    <AppContext.Provider value={{ state, setState, updateState }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}
