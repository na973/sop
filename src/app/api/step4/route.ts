import { NextRequest, NextResponse } from 'next/server';

type StrategyLevel = '极高' | '高' | '平均偏高' | '平均' | '平均偏低' | '低' | '极低';

interface CompareItemInput {
  row: number;
  category: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  ourUnitPrice: number;
  maxUnitPrice: number;
  maxTotalPrice?: number;
  deviationLevel: string;
  isScreeningItem?: boolean;
  itemReviewPrice?: number;
  screeningRank?: number;
  screeningBasis?: string;
  isAbnormalBidItem?: boolean;
}

interface StrategyOverride {
  row?: number;
  code?: string;
  category?: string;
  quantityForecast?: string;
  optimization?: string;
}

const QUANTITY_FORECAST_SCORES: Record<string, number> = {
  '明确增加': 4,
  '可能增加': 3,
  '基本一致/不确定': 0,
  '可能减少': -3,
  '明确减少': -4,
};

const OPTIMIZATION_SCORES: Record<string, number> = {
  '不能优化': 3,
  '优化较少': 2,
  '优化一般/不确定': 0,
  '优化一般': 0,
  '优化较多': -2,
  '优化多': -3,
};

const DEVIATION_SCORES: Record<string, number> = {
  '控制价明显偏低/疑似已压价': 2,
  '明显偏低': 2,
  '控制价偏低': 1,
  '偏低': 1,
  '基本接近': 0,
  '控制价偏高': -1,
  '偏高': -1,
  '控制价明显偏高': -2,
  '明显偏高': -2,
  '无限价数据': 0,
};

const OPTIMIZATION_KEYWORDS: Array<{ keywords: string[]; level: string }> = [
  { keywords: ['软基', '换填', '碎石垫层', '砂砾垫层', '宕渣垫层', '土基', '拆除基层', '凿除桥面'], level: '优化多' },
  { keywords: ['清表', '场地平整', '路基填筑', '路床', '防水层', '台背回填', '路基补强'], level: '优化较多' },
  { keywords: ['水稳底基层', '检查井', '雨水口', '管道', '支座', '梁板安装', '湿接缝', '防撞护栏', '桥头接顺'], level: '优化一般/不确定' },
  { keywords: ['铣刨', '沥青下面层', '沥青中面层', '混凝土基层', '桥面铺装基层'], level: '优化较少' },
  { keywords: ['沥青上面层', '侧石', '平石', '缘石', '找平层', '面砖', '透水砖', '花岗岩', '承台', '墩柱', '桥台', '盖梁', '台帽', '现浇梁', '伸缩缝', '桥头搭板'], level: '不能优化' },
];

function normalizeCode(code: string): string {
  return String(code || '').replace(/\s+/g, '').trim();
}

function overrideKey(item: { row?: number; category?: string; code?: string }): string {
  return `${item.category || ''}|${item.row || ''}|${normalizeCode(item.code || '')}`;
}

function scoreToLevel(score: number): StrategyLevel {
  if (score >= 5) return '极高';
  if (score >= 3) return '高';
  if (score >= 1) return '平均偏高';
  if (score >= -1) return '平均';
  if (score >= -3) return '平均偏低';
  if (score >= -5) return '低';
  return '极低';
}

function getScreeningRatio(bidScreeningRatio?: number): number {
  return bidScreeningRatio && bidScreeningRatio > 0 ? bidScreeningRatio : 0.3;
}

function markScreeningItems(items: CompareItemInput[], bidScreeningRatio?: number): Set<string> {
  const ratio = getScreeningRatio(bidScreeningRatio);
  const sorted = [...items].sort((a, b) => (b.maxTotalPrice || b.maxUnitPrice * b.quantity || 0) - (a.maxTotalPrice || a.maxUnitPrice * a.quantity || 0));
  const count = Math.max(1, Math.ceil(items.length * ratio));
  return new Set(sorted.slice(0, count).map(overrideKey));
}

function inferOptimization(item: CompareItemInput): string {
  const text = `${item.category} ${item.name}`.toLowerCase();
  const matched = OPTIMIZATION_KEYWORDS.find((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
  return matched?.level || '优化一般/不确定';
}

function getDefaultQuantityForecast(): string {
  return '基本一致/不确定';
}

function normalizeDeviationLevel(level: string): string {
  if (level.includes('明显偏低') || level.includes('已压价')) return '控制价明显偏低/疑似已压价';
  if (level.includes('偏低')) return '控制价偏低';
  if (level.includes('明显偏高')) return '控制价明显偏高';
  if (level.includes('偏高')) return '控制价偏高';
  return '基本接近';
}

function getDiscountRange(level: StrategyLevel, averageDiscountRate: number): [number, number] {
  const avg = Math.min(Math.max(averageDiscountRate, 0.01), 0.95);
  const low = Math.max(avg * 0.3, 0);
  const high = Math.min(avg * 1.7, 0.95);
  const midHigh = (low + avg) / 2;
  const midLow = (avg + high) / 2;

  const ranges: Record<StrategyLevel, [number, number]> = {
    '极高': [0, low],
    '高': [low, midHigh],
    '平均偏高': [midHigh, avg],
    '平均': [Math.max(avg - 0.03, 0), Math.min(avg + 0.03, 0.95)],
    '平均偏低': [avg, midLow],
    '低': [midLow, high],
    '极低': [high, 0.95],
  };
  return ranges[level];
}

function discountToCoefficientRange(range: [number, number]): [number, number] {
  return [round4(1 - range[1]), round4(1 - range[0])];
}

function getSuggestion(level: StrategyLevel, isScreeningItem: boolean, optimization: string, deviationLevel: string): string {
  const screeningNote = isScreeningItem ? '；属于单价甄别关注项，注意不得突破招标文件上下限' : '';
  const map: Record<StrategyLevel, string> = {
    '极高': '建议报高，优先保利润和抗风险',
    '高': '建议偏高报价，保留较好利润空间',
    '平均偏高': '建议略高于平均，稳健提高',
    '平均': '建议按平均水平报价，保持平衡',
    '平均偏低': '建议略低于平均，为总价下浮腾空间',
    '低': '建议偏低报价，配合其他高价项平衡',
    '极低': '建议低价处理，作为让利或可优化项',
  };
  return `${map[level]}。优化判断：${optimization}；限价判断：${deviationLevel}${screeningNote}`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { compareItems, strategyOverrides, bidScreeningRatio, averageDiscountRate = 0.3 } = body as {
      compareItems?: CompareItemInput[];
      strategyOverrides?: StrategyOverride[];
      bidScreeningRatio?: number;
      averageDiscountRate?: number;
    };

    if (!compareItems?.length) {
      return NextResponse.json({ success: false, error: '请提供：compareItems(步骤3的对比结果)' }, { status: 400 });
    }

    const overrideMap = new Map<string, StrategyOverride>();
    for (const override of strategyOverrides || []) {
      overrideMap.set(overrideKey(override), override);
      if (override.code) overrideMap.set(normalizeCode(override.code), override);
    }

    const hasStep3Screening = compareItems.some((item) => item.isScreeningItem);
    const fallbackScreeningKeys = hasStep3Screening ? new Set<string>() : markScreeningItems(compareItems, bidScreeningRatio);

    const strategyItems = compareItems.map((item) => {
      const itemKey = overrideKey(item);
      const override = overrideMap.get(itemKey) || overrideMap.get(normalizeCode(item.code));
      const quantityForecast = override?.quantityForecast || getDefaultQuantityForecast();
      const optimization = override?.optimization || inferOptimization(item);
      const deviationLevel = normalizeDeviationLevel(item.deviationLevel);
      const isScreeningItem = Boolean(item.isScreeningItem) || fallbackScreeningKeys.has(itemKey);

      const quantityScore = QUANTITY_FORECAST_SCORES[quantityForecast] ?? 0;
      const optimizationScore = OPTIMIZATION_SCORES[optimization] ?? 0;
      const deviationScore = DEVIATION_SCORES[deviationLevel] ?? 0;
      const screeningScore = isScreeningItem ? 0 : 0;
      const totalScore = quantityScore + optimizationScore + deviationScore + screeningScore;
      const strategyLevel = scoreToLevel(totalScore);
      const discountRange = getDiscountRange(strategyLevel, averageDiscountRate);
      const coefficientRange = discountToCoefficientRange(discountRange);

      return {
        row: item.row,
        category: item.category,
        code: item.code,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        maxUnitPrice: item.maxUnitPrice,
        maxTotalPrice: item.maxTotalPrice ?? item.maxUnitPrice * item.quantity,
        ourUnitPrice: item.ourUnitPrice,
        deviationLevel,
        isScreeningItem,
        itemReviewPrice: item.itemReviewPrice ?? item.maxTotalPrice ?? item.maxUnitPrice * item.quantity,
        screeningRank: item.screeningRank,
        screeningBasis: item.screeningBasis || (isScreeningItem ? '按评标规则B项：子目评审价排序前30%' : '未进入子目评审价排序前30%'),
        isAbnormalBidItem: Boolean(item.isAbnormalBidItem),
        quantityForecast,
        optimization,
        quantityScore,
        optimizationScore,
        deviationScore,
        screeningScore,
        totalScore,
        strategyLevel,
        discountRange,
        coefficientRange,
        suggestion: getSuggestion(strategyLevel, isScreeningItem, optimization, deviationLevel),
      };
    });

    const levelCounts: Record<string, number> = {};
    for (const item of strategyItems) {
      levelCounts[item.strategyLevel] = (levelCounts[item.strategyLevel] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      strategyItems,
      stats: {
        totalItems: strategyItems.length,
        levelCounts,
        screeningRatio: getScreeningRatio(bidScreeningRatio),
        screeningRule: '评标规则B项：子目评审价排序前30%，相对偏差绝对值>30%为异常报价项',
        screeningItems: strategyItems.filter((item) => item.isScreeningItem).length,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
