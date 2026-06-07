import { NextRequest, NextResponse } from 'next/server';
import type { CellValue } from '@/lib/formula-engine/types';

/** 策略系数映射 */
const STRATEGY_COEFFICIENT_MAP: Record<string, [number, number]> = {
  '极高': [0.78, 0.80],
  '高': [0.74, 0.76],
  '平均偏高': [0.68, 0.72],
  '平均': [0.62, 0.66],
  '平均偏低': [0.56, 0.60],
  '低': [0.50, 0.54],
  '极低': [0.46, 0.50],
};

/** 评分规则 */
const QUANTITY_FORECAST_SCORES: Record<string, number> = {
  '明确增加': 4,
  '可能增加': 3,
  '基本一致/不确定': 0,
  '可能减少': -3,
  '明确减少': -4,
};

const OPTIMIZATION_SCORES: Record<string, number> = {
  '不能优化': 0,
  '少量优化': 1,
  '中等优化': 2,
  '较多优化': 3,
  '大量优化': 4,
};

const DEVIATION_SCORES: Record<string, number> = {
  '控制价明显偏高': 4,
  '控制价偏高': 2,
  '基本接近': 0,
  '控制价偏低': -2,
  '控制价明显偏低/疑似已压价': -4,
};

function totalScoreToLevel(score: number): string {
  if (score >= 8) return '极高';
  if (score >= 4) return '高';
  if (score >= 1) return '平均偏高';
  if (score >= -1) return '平均';
  if (score >= -4) return '平均偏低';
  if (score >= -8) return '低';
  return '极低';
}

function getSuggestion(strategyLevel: string): string {
  const map: Record<string, string> = {
    '极高': '报高价，接近限价上限，获取最大利润',
    '高': '适当报高，在安全范围内提高单价',
    '平均偏高': '略高于平均水平，适度提高',
    '平均': '按平均价格报价，保持稳健',
    '平均偏低': '略低于平均水平，适度降低',
    '低': '报低价，为其他高价项腾出空间',
    '极低': '报最低价，大幅让利以平衡总价',
  };
  return map[strategyLevel] || '按平均价格报价';
}

/** 步骤4：不平衡报价策略 — 基于限价对比+人工判断，为每条清单分配策略等级 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { compareItems, strategyOverrides } = body as {
      compareItems?: Array<{
        row: number;
        category: string;
        code: string;
        name: string;
        unit: string;
        quantity: number;
        ourUnitPrice: number;
        maxUnitPrice: number;
        deviationLevel: string;
        isScreeningItem: boolean;
      }>;
      strategyOverrides?: Array<{
        row: number;
        quantityForecast: string;
        optimization: string;
      }>;
    };

    if (!compareItems?.length) {
      return NextResponse.json({ success: false, error: '请提供：compareItems(步骤3的对比结果)' }, { status: 400 });
    }

    // 构建 overrides 查找表
    const overrideMap = new Map<number, { quantityForecast: string; optimization: string }>();
    for (const o of strategyOverrides || []) {
      overrideMap.set(o.row, o);
    }

    // 为每条清单计算策略
    const strategyItems = compareItems.map((item) => {
      // 读取人工覆盖或使用默认值
      const override = overrideMap.get(item.row);
      const quantityForecast = override?.quantityForecast || '基本一致/不确定';
      const optimization = override?.optimization || '不能优化';

      // 计算各维度评分
      const quantityScore = QUANTITY_FORECAST_SCORES[quantityForecast] ?? 0;
      const optimizationScore = OPTIMIZATION_SCORES[optimization] ?? 0;
      const deviationScore = DEVIATION_SCORES[item.deviationLevel] ?? 0;

      const totalScore = quantityScore + optimizationScore + deviationScore;
      const strategyLevel = totalScoreToLevel(totalScore);
      const coefficientRange = STRATEGY_COEFFICIENT_MAP[strategyLevel] || [0.62, 0.66];

      return {
        row: item.row,
        category: item.category,
        code: item.code,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        maxUnitPrice: item.maxUnitPrice,
        ourUnitPrice: item.ourUnitPrice,
        deviationLevel: item.deviationLevel,
        isScreeningItem: item.isScreeningItem,
        quantityForecast,
        optimization,
        quantityScore,
        optimizationScore,
        deviationScore,
        totalScore,
        strategyLevel,
        coefficientRange,
        suggestion: getSuggestion(strategyLevel),
      };
    });

    // 统计
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
        screeningItems: strategyItems.filter((i) => i.isScreeningItem).length,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
