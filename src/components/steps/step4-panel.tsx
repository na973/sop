'use client';

import { useState, useCallback, useMemo } from 'react';
import { useAppState, type StrategyItem } from '@/lib/app-state';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

const QUANTITY_FORECAST_OPTIONS = ['明确增加', '可能增加', '基本一致/不确定', '可能减少', '明确减少'];
const OPTIMIZATION_OPTIONS = ['不能优化', '优化较少', '优化一般/不确定', '优化较多', '优化多'];

const STRATEGY_COLORS: Record<string, string> = {
  '极高': 'text-red-700 bg-red-100',
  '高': 'text-orange-700 bg-orange-100',
  '平均偏高': 'text-amber-700 bg-amber-100',
  '平均': 'text-green-700 bg-green-100',
  '平均偏低': 'text-blue-700 bg-blue-100',
  '低': 'text-indigo-700 bg-indigo-100',
  '极低': 'text-purple-700 bg-purple-100',
};

// 评分映射
const QUANTITY_SCORES: Record<string, number> = {
  '明确增加': 4, '可能增加': 2, '基本一致/不确定': 0, '可能减少': -2, '明确减少': -4,
};
const OPTIMIZATION_SCORES: Record<string, number> = {
  '不能优化': 0, '优化较少': 1, '优化一般/不确定': 2, '优化较多': 3, '优化多': 4,
};
const DEVIATION_SCORES: Record<string, number> = {
  '明显偏高': 4, '偏高': 2, '基本接近': 0, '偏低': -2, '明显偏低': -4,
};

// 7档策略等级及系数范围
const STRATEGY_LEVELS = [
  { level: '极高', minCoeff: 0.78, maxCoeff: 0.80 },
  { level: '高', minCoeff: 0.74, maxCoeff: 0.76 },
  { level: '平均偏高', minCoeff: 0.68, maxCoeff: 0.72 },
  { level: '平均', minCoeff: 0.62, maxCoeff: 0.66 },
  { level: '平均偏低', minCoeff: 0.56, maxCoeff: 0.60 },
  { level: '低', minCoeff: 0.50, maxCoeff: 0.54 },
  { level: '极低', minCoeff: 0.46, maxCoeff: 0.50 },
];

function computeStrategyLevel(totalScore: number): { level: string; coefficientRange: [number, number]; discountRange: [number, number] } {
  let idx: number;
  if (totalScore >= 9) idx = 0;
  else if (totalScore >= 6) idx = 1;
  else if (totalScore >= 3) idx = 2;
  else if (totalScore >= -2) idx = 3;
  else if (totalScore >= -5) idx = 4;
  else if (totalScore >= -8) idx = 5;
  else idx = 6;

  const s = STRATEGY_LEVELS[idx];
  const discountMin = 1 - s.maxCoeff;
  const discountMax = 1 - s.minCoeff;
  return {
    level: s.level,
    coefficientRange: [s.minCoeff, s.maxCoeff],
    discountRange: [discountMin, discountMax],
  };
}

function getSuggestion(level: string, name: string): string {
  const suggestions: Record<string, string> = {
    '极高': `${name}：工程量预计大幅增加且可优化空间大，建议报高价以提高前期收入。系数${STRATEGY_LEVELS[0].minCoeff}~${STRATEGY_LEVELS[0].maxCoeff}。`,
    '高': `${name}：工程量预计增加或可优化，建议适当报高价。系数${STRATEGY_LEVELS[1].minCoeff}~${STRATEGY_LEVELS[1].maxCoeff}。`,
    '平均偏高': `${name}：条件偏向报高价，建议略高于平均报价。系数${STRATEGY_LEVELS[2].minCoeff}~${STRATEGY_LEVELS[2].maxCoeff}。`,
    '平均': `${name}：各维度评分均衡，建议采用平均报价水平。系数${STRATEGY_LEVELS[3].minCoeff}~${STRATEGY_LEVELS[3].maxCoeff}。`,
    '平均偏低': `${name}：条件偏向报低价，建议略低于平均报价。系数${STRATEGY_LEVELS[4].minCoeff}~${STRATEGY_LEVELS[4].maxCoeff}。`,
    '低': `${name}：工程量预计减少或不可优化，建议适当报低价。系数${STRATEGY_LEVELS[5].minCoeff}~${STRATEGY_LEVELS[5].maxCoeff}。`,
    '极低': `${name}：工程量预计大幅减少且不可优化，建议报低价以降低风险。系数${STRATEGY_LEVELS[6].minCoeff}~${STRATEGY_LEVELS[6].maxCoeff}。`,
  };
  return suggestions[level] || `${name}：建议平均报价。`;
}

export function Step4Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const step3Data = state.step3Data;
  const step4Data = state.step4Data;

  // 本地编辑状态：记录人工修改
  const [localEdits, setLocalEdits] = useState<Record<string, { quantityForecast?: string; optimization?: string }>>({});

  // 实时计算后的策略项
  const computedItems = useMemo(() => {
    if (!step4Data) return null;
    return step4Data.map((it) => {
      const editKey = `${it.category}|${it.row}|${it.code}`;
      const edit = localEdits[editKey];

      // 如果有本地编辑，使用编辑后的值重新计算
      const quantityForecast = edit?.quantityForecast ?? it.quantityForecast;
      const optimization = edit?.optimization ?? it.optimization;
      const quantityScore = QUANTITY_SCORES[quantityForecast] ?? it.quantityScore ?? 0;
      const optimizationScore = OPTIMIZATION_SCORES[optimization] ?? it.optimizationScore ?? 0;
      const deviationScore = DEVIATION_SCORES[it.deviationLevel] ?? it.deviationScore ?? 0;
      const totalScore = quantityScore + optimizationScore + deviationScore;
      const { level, coefficientRange, discountRange } = computeStrategyLevel(totalScore);
      const suggestion = getSuggestion(level, it.name);

      return {
        ...it,
        quantityForecast,
        optimization,
        quantityScore,
        optimizationScore,
        deviationScore,
        totalScore,
        strategyLevel: level,
        coefficientRange,
        discountRange,
        suggestion,
      };
    });
  }, [step4Data, localEdits]);

  const handleStrategy = useCallback(async () => {
    if (!step3Data || step3Data.length === 0) {
      setError('请先在步骤3中执行限价对比');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const overrides = Object.entries(localEdits).map(([, v]) => v).filter(v => v.quantityForecast || v.optimization);
      const res = await fetch('/api/step4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compareItems: step3Data,
          strategyOverrides: overrides.length > 0 ? overrides : undefined,
          averageDiscountRate: state.targetDiscountRate || 0.3,
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({ step4Data: data.strategyItems || data.items });
        setLocalEdits({}); // 清空本地编辑，因为服务端已重新计算
      } else {
        setError(data.error || '策略分配失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [step3Data, localEdits, state.targetDiscountRate, updateState]);

  const handleLocalEdit = useCallback((item: StrategyItem, field: 'quantityForecast' | 'optimization', value: string) => {
    const key = `${item.category}|${item.row}|${item.code}`;
    setLocalEdits((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  }, []);

  const handleExport = useCallback(async () => {
    if (!computedItems) return;
    const rows = computedItems.map((it) => [
      it.category, it.code, it.name, it.unit,
      it.quantity, it.maxUnitPrice, it.maxTotalPrice ?? it.maxUnitPrice * it.quantity, it.ourUnitPrice,
      it.itemReviewPrice ?? it.maxTotalPrice ?? it.maxUnitPrice * it.quantity,
      it.isScreeningItem ? '是' : '否',
      it.screeningRank ?? '',
      it.isAbnormalBidItem ? '是' : '否',
      it.deviationLevel, it.deviationScore ?? 0,
      it.quantityForecast, it.quantityScore ?? 0,
      it.optimization, it.optimizationScore ?? 0,
      it.totalScore, it.strategyLevel,
      it.discountRange ? `${(it.discountRange[0] * 100).toFixed(1)}%~${(it.discountRange[1] * 100).toFixed(1)}%` : '',
      `${it.coefficientRange[0]}~${it.coefficientRange[1]}`,
      it.suggestion,
    ]);
    const result = await exportToExcel(
      [{ name: '不平衡报价策略', headers: ['分部', '编码', '名称', '单位', '工程量', '限价综合单价', '限价合价', '我方单价', '子目评审价', '单价甄别', '甄别排名', '异常报价项', '控制价等级', '控制价评分', '工程量预测', '工程量评分', '优化等级', '优化评分', '总评分', '建议价格等级', '下浮率区间', '系数范围', '报价建议/判断理由'], rows }],
      '不平衡报价策略.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [computedItems]);

  const strategyCounts = computedItems ? Object.entries(
    computedItems.reduce<Record<string, number>>((acc, it) => {
      acc[it.strategyLevel] = (acc[it.strategyLevel] || 0) + 1;
      return acc;
    }, {}),
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤4：不平衡报价策略</h2>
        {computedItems && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出Excel
          </button>
        )}
      </div>

      {!step3Data && (
        <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded">
          提示：请先在步骤3中执行限价对比，或直接点击下方按钮使用已有数据
        </div>
      )}

      {Object.keys(localEdits).length > 0 && (
        <div className="text-xs text-amber-700 p-2 bg-amber-50 rounded">
          已修改人工预测/优化判断，数据已实时更新。点击"分配报价策略"可同步到服务端。
        </div>
      )}

      <button
        onClick={handleStrategy}
        disabled={loading || !step3Data}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '策略计算中...' : '分配报价策略'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {/* 策略分布 */}
      {strategyCounts && (
        <div className="flex flex-wrap gap-2">
          {strategyCounts.map(([level, count]) => (
            <span key={level} className={`text-xs px-2 py-1 rounded ${STRATEGY_COLORS[level] || ''}`}>
              {level}: {count}项
            </span>
          ))}
        </div>
      )}

      {/* 策略结果表格 */}
      {computedItems && (
        <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
          <table className="min-w-[1900px] w-max table-auto text-xs">
            <colgroup>
              <col className="w-12" />
              <col className="w-32" />
              <col className="w-56" />
              <col className="w-16" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-36" />
              <col className="w-16" />
              <col className="w-36" />
              <col className="w-16" />
              <col className="w-40" />
              <col className="w-16" />
              <col className="w-16" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-56" />
              <col className="w-72" />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/60">
                <th className="border-r border-border bg-muted px-2 py-2 text-center align-middle" rowSpan={2}>序号</th>
                <th className="border-r border-border bg-muted px-2 py-2 text-center" colSpan={8}>根据最高投标限价</th>
                <th className="border-r border-border bg-muted px-2 py-2 text-center" colSpan={2}>人工预测结算工程量</th>
                <th className="border-r border-border bg-muted px-2 py-2 text-center" colSpan={2}>工程量能否优化</th>
                <th className="border-r border-border bg-muted px-2 py-2 text-center" colSpan={2}>最高投标限价与未下浮清单单价偏差率</th>
                <th className="border-r border-border bg-muted px-2 py-2 text-center" colSpan={3}>建议价格</th>
                <th className="bg-muted px-2 py-2 text-center" colSpan={2}>输出结果</th>
              </tr>
              <tr className="bg-muted/50">
                <th className="bg-muted/50 px-2 py-2 text-left align-bottom">项目编码</th>
                <th className="bg-muted/50 px-2 py-2 text-left align-bottom">项目名称</th>
                <th className="bg-muted/50 px-2 py-2 text-left align-bottom">单位</th>
                <th className="bg-muted/50 px-2 py-2 text-right align-bottom">工程量</th>
                <th className="bg-muted/50 px-2 py-2 text-right align-bottom">限价综合单价</th>
                <th className="bg-muted/50 px-2 py-2 text-right align-bottom">限价合价</th>
                <th className="bg-muted/50 px-2 py-2 text-right align-bottom">子目评审价</th>
                <th className="border-r border-border bg-muted/50 px-2 py-2 text-center align-bottom">是否单价甄别项目</th>
                <th className="bg-muted/50 px-2 py-2 text-center align-bottom">等级</th>
                <th className="border-r border-border bg-muted/50 px-2 py-2 text-center align-bottom">评分</th>
                <th className="bg-muted/50 px-2 py-2 text-center align-bottom">等级</th>
                <th className="border-r border-border bg-muted/50 px-2 py-2 text-center align-bottom">评分</th>
                <th className="bg-muted/50 px-2 py-2 text-center align-bottom">等级</th>
                <th className="border-r border-border bg-muted/50 px-2 py-2 text-center align-bottom">评分</th>
                <th className="bg-muted/50 px-2 py-2 text-center align-bottom">总评分</th>
                <th className="bg-muted/50 px-2 py-2 text-center align-bottom">等级</th>
                <th className="border-r border-border bg-muted/50 px-2 py-2 text-center align-bottom">系数范围</th>
                <th className="bg-muted/50 px-2 py-2 text-left align-bottom">报价建议</th>
                <th className="bg-muted/50 px-2 py-2 text-left align-bottom">判断理由</th>
              </tr>
            </thead>
            <tbody>
              {computedItems.map((it, i) => (
                <tr key={i} className={`border-t border-border align-top hover:bg-muted/20 ${it.isScreeningItem ? 'bg-amber-50/50' : ''}`}>
                  <td className="border-r border-border px-2 py-2 text-center font-mono">{i + 1}</td>
                  <td className="px-2 py-2 font-mono whitespace-nowrap">{it.code}</td>
                  <td className="px-2 py-2 leading-relaxed whitespace-normal break-words">{it.name}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{it.unit}</td>
                  <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{fmt(it.quantity)}</td>
                  <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{fmt(it.maxUnitPrice)}</td>
                  <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{fmt(it.maxTotalPrice ?? it.maxUnitPrice * it.quantity)}</td>
                  <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{fmt(it.itemReviewPrice ?? it.maxTotalPrice ?? it.maxUnitPrice * it.quantity)}</td>
                  <td className="border-r border-border px-2 py-2 text-center whitespace-nowrap" title={it.screeningBasis}>
                    {it.isScreeningItem ? `是${it.screeningRank ? `(${it.screeningRank})` : ''}` : '否'}
                    {it.isAbnormalBidItem && <span className="ml-1 text-destructive font-bold">异常</span>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <select
                      className="w-full min-w-32 border border-border rounded bg-background px-1 py-1"
                      value={it.quantityForecast}
                      onChange={(e) => handleLocalEdit(it, 'quantityForecast', e.target.value)}
                    >
                      {QUANTITY_FORECAST_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td className={`border-r border-border px-2 py-2 text-center font-mono ${(localEdits[`${it.category}|${it.row}|${it.code}`]?.quantityForecast) ? 'text-primary font-bold' : ''}`}>
                    {it.quantityScore ?? 0}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <select
                      className="w-full min-w-32 border border-border rounded bg-background px-1 py-1"
                      value={it.optimization}
                      onChange={(e) => handleLocalEdit(it, 'optimization', e.target.value)}
                    >
                      {OPTIMIZATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td className={`border-r border-border px-2 py-2 text-center font-mono ${(localEdits[`${it.category}|${it.row}|${it.code}`]?.optimization) ? 'text-primary font-bold' : ''}`}>
                    {it.optimizationScore ?? 0}
                  </td>
                  <td className="px-2 py-2 text-center text-muted-foreground whitespace-normal break-words">{it.deviationLevel}</td>
                  <td className="border-r border-border px-2 py-2 text-center font-mono">{it.deviationScore ?? 0}</td>
                  <td className={`px-2 py-2 text-center font-mono ${(localEdits[`${it.category}|${it.row}|${it.code}`]) ? 'text-primary font-bold' : ''}`}>{it.totalScore}</td>
                  <td className="px-2 py-2 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${STRATEGY_COLORS[it.strategyLevel] || ''}`}>
                      {it.strategyLevel}
                    </span>
                  </td>
                  <td className="border-r border-border px-2 py-2 text-center font-mono text-[10px] whitespace-nowrap">
                    {it.coefficientRange[0]}~{it.coefficientRange[1]}
                  </td>
                  <td className="px-2 py-2 leading-relaxed whitespace-normal break-words">{it.suggestion.split('。')[0]}</td>
                  <td className="px-2 py-2 leading-relaxed text-muted-foreground whitespace-normal break-words">{it.suggestion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
