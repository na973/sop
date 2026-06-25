/**
 * 商务标核心业务类型定义
 */

/** 清单条目 - 表2/表3的核心数据单元 */
export interface BidItem {
  id: string;
  /** 项目编码 如 041001004001 */
  code: string;
  /** 项目名称 如 铣刨路面 */
  name: string;
  /** 项目特征描述 */
  description: string;
  /** 计量单位 */
  unit: string;
  /** 工程量 */
  quantity: number;
  /** 综合单价（元） */
  unitPrice: number;
  /** 综合合价（元）= 工程量 × 综合单价 */
  totalPrice: number;
  /** 所属分项：从 综合单价分析表【xxx】 自动识别 */
  category: string;
  /** 工料机明细 */
  resources: ResourceItem[];
}

/** 工料机条目 - 综合单价分析表的子项 */
export interface ResourceItem {
  id: string;
  /** 所属清单ID */
  bidItemId: string;
  /** 工料机编码 */
  resourceCode: string;
  /** 工料机名称 */
  resourceName: string;
  /** 类型：人工/材料/机械 */
  resourceType: '人工' | '材料' | '机械';
  /** 消耗量 */
  consumption: number;
  /** 单价（元） */
  unitPrice: number;
  /** 合价 = 消耗量 × 单价 */
  totalPrice: number;
  /** 来源：定额/信息价/市场价 */
  priceSource: string;
}

/** 汇总表数据 */
export interface SummaryData {
  /** 分部分项工程项目费 */
  partProjectFee: number;
  /** 道路工程费 */
  roadFee: number;
  /** 桥梁工程费 */
  bridgeFee: number;
  /** 排水工程费 */
  drainageFee: number;
  /** 措施项目费 */
  measureFee: number;
  /** 安全文明施工费 */
  safetyFee: number;
  /** 其他措施项目费 */
  otherMeasureFee: number;
  /** 其他项目费 */
  otherFee: number;
  /** 暂列金额 */
  provisionalSum: number;
  /** 专业工程暂估价 */
  professionalEstimate: number;
  /** 计日工 */
  dayWork: number;
  /** 增值税 */
  vat: number;
  /** 合计 */
  total: number;
}

/** 步骤3: 限价对比条目 */
export interface PriceComparisonItem {
  id: string;
  bidItemId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  /** 最高投标限价综合单价 */
  limitUnitPrice: number;
  /** 最高投标限价合价 */
  limitTotalPrice: number;
  /** 我方综合单价（未下浮） */
  ourUnitPrice: number;
  /** 我方合价 */
  ourTotalPrice: number;
  /** 控制价偏差率 = (限价单价 - 我方单价) / 我方单价 */
  deviationRate: number;
  /** 偏差等级 */
  deviationLevel: '控制价明显偏高' | '控制价偏高' | '基本接近' | '控制价偏低' | '控制价明显偏低/疑似已压价';
  /** 是否单价甄别项目 */
  isScreeningItem: boolean;
}

/** 步骤4: 不平衡报价策略评分维度 */
export type StrategyLevel = 
  | '明确增加' | '可能增加' | '基本一致/不确定' | '可能减少' | '明确减少'
  | '不能优化' | '少量优化' | '中等优化' | '较多优化' | '大量优化'
  | '控制价明显偏高' | '控制价偏高' | '基本接近' | '控制价偏低' | '控制价明显偏低/疑似已压价';

/** 步骤4: 不平衡报价策略条目 */
export interface StrategyItem {
  id: string;
  comparisonItemId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  /** 限价综合单价 */
  limitUnitPrice: number;
  /** 限价合价 */
  limitTotalPrice: number;
  /** 是否单价甄别项目 */
  isScreeningItem: boolean;
  /** 人工预测结算工程量 - 等级 */
  quantityForecastLevel: string;
  /** 人工预测结算工程量 - 评分 */
  quantityForecastScore: number;
  /** 工程量能否优化 - 等级 */
  optimizationLevel: string;
  /** 工程量能否优化 - 评分 */
  optimizationScore: number;
  /** 偏差率等级 */
  deviationLevel: string;
  /** 偏差率评分 */
  deviationScore: number;
  /** 总评分 */
  totalScore: number;
  /** 策略等级：极高/高/平均偏高/平均/平均偏低/低/极低 */
  strategyLevel: string;
  /** 报价建议 */
  suggestion: string;
  /** 判断理由 */
  reason: string;
}

/** 步骤5: 清单调价配平条目 */
export interface ListBalanceItem {
  id: string;
  strategyItemId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  /** 限价综合单价 */
  limitUnitPrice: number;
  /** 限价合价 */
  limitTotalPrice: number;
  /** 原综合单价（未下浮） */
  originalUnitPrice: number;
  /** 原合价 */
  originalTotalPrice: number;
  /** 策略等级 */
  strategyLevel: string;
  /** 策略系数范围 */
  coefficientRange: [number, number];
  /** 实际采用系数 */
  actualCoefficient: number;
  /** 目标综合单价 = 限价单价 × 系数 */
  targetUnitPrice: number;
  /** 目标合价 = 目标单价 × 工程量 */
  targetTotalPrice: number;
  /** 清单下浮率 = (限价单价 - 目标单价) / 限价单价 */
  listFloatRate: number;
}

/** 步骤5: 配平结果 */
export interface ListBalanceResult {
  /** 输入的总下浮率 */
  inputFloatRate: number;
  /** 限价总价 */
  limitTotalPrice: number;
  /** 目标总价 = 限价总价 × (1 - 总下浮率) */
  targetTotalPrice: number;
  /** 配平后实际总价 */
  actualTotalPrice: number;
  /** 总价差额 */
  totalPriceDiff: number;
  /** 配平条目列表 */
  items: ListBalanceItem[];
  /** 是否通过校验 */
  passed: boolean;
  /** 校验信息 */
  messages: string[];
}

/** 步骤6: 工料机调价条目 */
export interface MaterialAdjustItem {
  id: string;
  /** 工料机编码 */
  resourceCode: string;
  /** 工料机名称 */
  resourceName: string;
  /** 类型 */
  resourceType: '人工' | '材料' | '机械';
  /** 原单价 */
  originalUnitPrice: number;
  /** 调整后单价 */
  adjustedUnitPrice: number;
  /** 调整量 */
  adjustment: number;
  /** 影响的清单条目数 */
  affectedBidItemCount: number;
  /** 影响的清单合价变化 */
  affectedTotalPriceChange: number;
}

/** 步骤6: 工料机调价配平结果 */
export interface MaterialBalanceResult {
  /** 目标总价（来自步骤5） */
  targetTotalPrice: number;
  /** 调价前总价 */
  beforeTotalPrice: number;
  /** 调价后总价 */
  afterTotalPrice: number;
  /** 与目标总价差额 */
  diffFromTarget: number;
  /** 工料机调价条目 */
  items: MaterialAdjustItem[];
  /** 匹配清单数量 */
  matchedBidItemCount: number;
  /** 工料机资源数量 */
  resourceCount: number;
  /** 是否通过校验 */
  passed: boolean;
  /** 校验信息 */
  messages: string[];
}

/** 策略等级到系数范围的映射 */
export const STRATEGY_COEFFICIENT_MAP: Record<string, [number, number]> = {
  '极高': [0.78, 0.80],
  '高': [0.74, 0.76],
  '平均偏高': [0.68, 0.72],
  '平均': [0.62, 0.66],
  '平均偏低': [0.56, 0.60],
  '低': [0.50, 0.54],
  '极低': [0.46, 0.50],
};

/** 偏差率分档规则 */
export const DEVIATION_RULES: Array<{ min: number; max: number; level: string }> = [
  { min: 0.20, max: Infinity, level: '控制价明显偏高' },
  { min: 0.10, max: 0.20, level: '控制价偏高' },
  { min: -0.10, max: 0.10, level: '基本接近' },
  { min: -0.20, max: -0.10, level: '控制价偏低' },
  { min: -Infinity, max: -0.20, level: '控制价明显偏低/疑似已压价' },
];

/** 评分规则映射 */
export const SCORING_RULES = {
  quantityForecast: {
    '明确增加': 4,
    '可能增加': 3,
    '基本一致/不确定': 0,
    '可能减少': -3,
    '明确减少': -4,
  } as Record<string, number>,
  optimization: {
    '不能优化': 0,
    '少量优化': 1,
    '中等优化': 2,
    '较多优化': 3,
    '大量优化': 4,
  } as Record<string, number>,
  deviation: {
    '控制价明显偏高': 4,
    '控制价偏高': 2,
    '基本接近': 0,
    '控制价偏低': -2,
    '控制价明显偏低/疑似已压价': -4,
  } as Record<string, number>,
  /** 总评分 → 策略等级 */
  totalScoreToLevel(score: number): string {
    if (score >= 8) return '极高';
    if (score >= 4) return '高';
    if (score >= 1) return '平均偏高';
    if (score >= -1) return '平均';
    if (score >= -4) return '平均偏低';
    if (score >= -8) return '低';
    return '极低';
  },
};

