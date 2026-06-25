'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAppState, type StrategyItem } from '@/lib/app-state';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

const STRATEGY_COLORS: Record<string, string> = {
  '极高': 'text-red-700 bg-red-100',
  '高': 'text-orange-700 bg-orange-100',
  '平均偏高': 'text-amber-700 bg-amber-100',
  '平均': 'text-green-700 bg-green-100',
  '平均偏低': 'text-blue-700 bg-blue-100',
  '低': 'text-indigo-700 bg-indigo-100',
  '极低': 'text-purple-700 bg-purple-100',
};

const STRATEGY_LEVELS = ['极高', '高', '平均偏高', '平均', '平均偏低', '低', '极低'] as const;

interface StrategyOverride {
  row: number;
  category: string;
  code: string;
  strategyLevel?: string;
  suggestion?: string;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function itemKey(item: Pick<StrategyItem, 'row' | 'category' | 'code'>): string {
  return `${item.category}::${item.row}::${item.code}`;
}

function normalizeName(name: string): string {
  return String(name || '').replace(/\s+/g, '').trim();
}

function normalizePrice(price: number): number {
  return Math.round((Number(price) || 0) * 10000) / 10000;
}

function isSameNameAndControlPrice(a: StrategyItem, b: StrategyItem): boolean {
  return normalizeName(a.name) === normalizeName(b.name)
    && normalizePrice(a.maxUnitPrice) === normalizePrice(b.maxUnitPrice);
}

export function Step4Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiMessage, setAiMessage] = useState('');
  const [overrides, setOverrides] = useState<Record<string, StrategyOverride>>({});
  const [activeStrategyFilter, setActiveStrategyFilter] = useState<string | null>(null);

  const step3Data = state.step3Data;
  const step4Data = state.step4Data;
  const filteredStep4Data = step4Data
    ? (activeStrategyFilter ? step4Data.filter((item) => item.strategyLevel === activeStrategyFilter) : step4Data)
    : null;

  const handleStrategy = useCallback(async () => {
    if (!step3Data?.length) {
      setError('请先在步骤3中执行限价对比');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/step4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compareItems: step3Data,
          averageDiscountRate: state.targetDiscountRate || 0.3,
          strategyOverrides: Object.values(overrides),
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({ step4Data: data.strategyItems || data.items });
      } else {
        setError(data.error || '策略分配失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [step3Data, state.targetDiscountRate, overrides, updateState]);

  useEffect(() => {
    if (!step3Data?.length || Object.keys(overrides).length === 0) return;
    const timer = window.setTimeout(() => {
      void handleStrategy();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [handleStrategy, overrides, step3Data]);

  const updateOverride = useCallback((
    item: StrategyItem,
    patch: Pick<StrategyOverride, 'strategyLevel' | 'suggestion'>,
  ) => {
    setOverrides((current) => ({
      ...current,
      ...(patch.strategyLevel
        ? (step4Data || [])
          .filter((candidate) => isSameNameAndControlPrice(candidate, item))
          .reduce<Record<string, StrategyOverride>>((linked, candidate) => {
            const key = itemKey(candidate);
            linked[key] = {
              ...current[key],
              row: candidate.row,
              category: candidate.category,
              code: candidate.code,
              strategyLevel: patch.strategyLevel,
            };
            return linked;
          }, {})
        : {
            [itemKey(item)]: {
              ...current[itemKey(item)],
              row: item.row,
              category: item.category,
              code: item.code,
              ...patch,
            },
          }),
    }));
  }, [step4Data]);

  const handleAiSuggest = useCallback(async () => {
    if (!step4Data?.length) {
      setError('请先生成步骤4策略，再使用AI辅助建议');
      return;
    }

    setAiLoading(true);
    setError('');
    setAiMessage('');
    try {
      const res = await fetch('/api/step4/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: step4Data }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'AI辅助建议失败');
        return;
      }

      const suggestions = data.suggestions as Array<{
        row: number;
        category: string;
        code: string;
        projectMajorType?: string;
        projectSubType?: string;
        checklistStep?: string;
        reviewStatus?: string;
        strategyLevel: string;
        suggestion: string;
        reason: string;
      }>;

      const findSuggestionForItem = (item: StrategyItem) => {
        const direct = suggestions.find((suggestion) => (
          item.row === suggestion.row
          && item.code === suggestion.code
          && (!suggestion.category || item.category === suggestion.category)
        )) || suggestions.find((suggestion) => item.row === suggestion.row && item.code === suggestion.code);
        if (direct) return direct;
        const matchedSource = step4Data.find((source) => suggestions.some((suggestion) => (
          source.row === suggestion.row
          && source.code === suggestion.code
          && (!suggestion.category || source.category === suggestion.category)
        )) && isSameNameAndControlPrice(source, item));
        if (!matchedSource) return null;
        return suggestions.find((suggestion) => matchedSource.row === suggestion.row && matchedSource.code === suggestion.code) || null;
      };

      updateState({
        step4Data: step4Data.map((item) => {
          const suggestion = findSuggestionForItem(item);
          if (!suggestion) return item;
          return {
            ...item,
            projectMajorType: suggestion.projectMajorType || item.projectMajorType,
            projectSubType: suggestion.projectSubType || item.projectSubType,
            checklistStep: suggestion.checklistStep || item.checklistStep,
            reviewStatus: suggestion.reviewStatus || item.reviewStatus,
          };
        }),
      });

      setOverrides((current) => {
        const next = { ...current };
        let appliedCount = 0;
        for (const suggestion of suggestions) {
          const matched = step4Data.find((item) => (
            item.row === suggestion.row
            && item.code === suggestion.code
            && (!suggestion.category || item.category === suggestion.category)
          )) || step4Data.find((item) => item.row === suggestion.row && item.code === suggestion.code);
          if (!matched) continue;
          for (const candidate of step4Data.filter((item) => isSameNameAndControlPrice(item, matched))) {
            const key = itemKey(candidate);
            next[key] = {
              ...next[key],
              row: candidate.row,
              category: candidate.category,
              code: candidate.code,
              strategyLevel: suggestion.strategyLevel,
              suggestion: `${suggestion.suggestion}；AI理由：${suggestion.reason}（AI辅助，需人工复核）`,
            };
            appliedCount += 1;
          }
        }
        setAiMessage(`已应用 DeepSeek 辅助建议：${appliedCount} 项。请人工复核后再进入步骤5。`);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI辅助建议请求失败');
    } finally {
      setAiLoading(false);
    }
  }, [step4Data, updateState]);

  const handleExport = useCallback(async () => {
    if (!filteredStep4Data) return;
    const rows = filteredStep4Data.map((item, index) => [
      index + 1,
      item.projectMajorType || '',
      item.projectSubType || '',
      item.category,
      item.checklistStep || '',
      item.code,
      item.name,
      item.feature || '',
      item.unit,
      item.quantity,
      item.maxUnitPrice,
      item.maxTotalPrice ?? item.maxUnitPrice * item.quantity,
      item.isScreeningItem ? '是' : '否',
      item.deviationLevel,
      item.deviationRate,
      item.profitOpportunity || '',
      item.strategyLevel,
      item.reviewStatus || '',
      item.suggestion,
      item.reason || '',
    ]);
    const result = await exportToExcel(
      [{
        name: '不平衡报价策略',
        headers: ['序号', '工程大类', '工程子类', '单位工程', '清单步骤', '项目编码', '项目名称', '项目特征', '单位', '工程量', '限价综合单价', '限价合价', '是否单价甄别项目', '偏差等级', '偏差率', '利润点/策略依据', '建议价格等级', '复核状态', '报价建议', '判断理由'],
        rows,
      }],
      '表5 不平衡报价策略表.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [filteredStep4Data]);

  const strategyCounts = step4Data
    ? Object.entries(step4Data.reduce<Record<string, number>>((counts, item) => {
      counts[item.strategyLevel] = (counts[item.strategyLevel] || 0) + 1;
      return counts;
    }, {}))
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤4：不平衡报价策略</h2>
        {step4Data && (
          <div className="flex gap-2">
            <button
              onClick={handleAiSuggest}
              disabled={aiLoading}
              className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              {aiLoading ? 'AI建议中...' : 'DeepSeek辅助建议'}
            </button>
            <button onClick={handleExport} className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">
              导出表5
            </button>
          </div>
        )}
      </div>

      <div className="rounded bg-muted/30 p-3 text-xs text-muted-foreground">
        建议价格依据表9生成：优先考虑限价是否已压价、工程量能否优化，并沿用步骤3的偏差率和单价甄别结果。可使用 DeepSeek 做辅助建议，但最终仍以页面上的人工确认等级为准；修改建议等级时，同项目名称且同限价综合单价的清单会同步修改。
      </div>

      <button
        onClick={handleStrategy}
        disabled={loading || !step3Data}
        className="w-full rounded bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '策略计算中...' : '生成不平衡报价策略'}
      </button>

      {!step3Data && <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">请先完成步骤3限价对比。</div>}
      {error && <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
      {aiMessage && <div className="rounded bg-blue-50 p-2 text-xs text-blue-700">{aiMessage}</div>}

      {step4Data && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveStrategyFilter(null)}
            className={`rounded px-2 py-1 text-xs transition hover:scale-[1.02] ${
              activeStrategyFilter === null
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            全部清单：{step4Data.length}项
          </button>
          {strategyCounts.map(([level, count]) => (
            <button
              key={level}
              type="button"
              onClick={() => setActiveStrategyFilter((current) => (current === level ? null : level))}
              className={`rounded px-2 py-1 text-xs transition hover:scale-[1.02] ${STRATEGY_COLORS[level] || ''} ${
                activeStrategyFilter === level ? 'ring-2 ring-primary ring-offset-1' : ''
              }`}
            >
              {level}：{count}项
            </button>
          ))}
          {activeStrategyFilter && (
            <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
              当前筛选：{activeStrategyFilter}，显示 {filteredStep4Data?.length || 0} 项
            </span>
          )}
        </div>
      )}

      {filteredStep4Data && (
        <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
          <table className="w-full min-w-max table-auto text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/60">
                <th className="border-r border-border bg-muted px-2 py-2 text-center align-middle" rowSpan={2}>序号</th>
                <th className="border-r border-border bg-muted px-2 py-2 text-center" colSpan={12}>根据最高投标限价与策略库识别</th>
                <th className="border-r border-border bg-muted px-2 py-2 text-center" colSpan={2}>最高投标限价与未下浮清单单价偏差率</th>
                <th className="border-r border-border bg-muted px-2 py-2 text-center" colSpan={3}>建议价格</th>
                <th className="bg-muted px-2 py-2 text-center" colSpan={2}>输出结果</th>
              </tr>
              <tr className="bg-muted/50">
                <th className="px-2 py-2 text-left">工程大类</th>
                <th className="px-2 py-2 text-left">工程子类</th>
                <th className="px-2 py-2 text-left">单位工程</th>
                <th className="px-2 py-2 text-left">清单步骤</th>
                <th className="px-2 py-2 text-left">项目编码</th>
                <th className="px-2 py-2 text-left">项目名称</th>
                <th className="px-2 py-2 text-left">项目特征</th>
                <th className="px-2 py-2 text-left">单位</th>
                <th className="px-2 py-2 text-right">工程量</th>
                <th className="px-2 py-2 text-right">限价综合单价</th>
                <th className="px-2 py-2 text-right">限价合价</th>
                <th className="border-r border-border px-2 py-2 text-center">是否单价甄别项目</th>
                <th className="px-2 py-2 text-center">等级</th>
                <th className="border-r border-border px-2 py-2 text-right">偏差率</th>
                <th className="px-2 py-2 text-left">利润点/依据</th>
                <th className="border-r border-border px-2 py-2 text-center">等级</th>
                <th className="border-r border-border px-2 py-2 text-left">复核状态</th>
                <th className="px-2 py-2 text-left">报价建议</th>
                <th className="px-2 py-2 text-left">判断理由</th>
              </tr>
            </thead>
            <tbody>
              {filteredStep4Data.map((item, index) => (
                <tr key={`${item.category}-${item.row}`} className="border-t border-border align-top hover:bg-muted/20">
                  <td className="border-r border-border px-2 py-2 text-center font-mono">{index + 1}</td>
                  <td className="px-2 py-2 leading-relaxed">{item.projectMajorType || '待确认'}</td>
                  <td className="px-2 py-2 leading-relaxed">{item.projectSubType || '待确认'}</td>
                  <td className="px-2 py-2 leading-relaxed">{item.category || '待确认'}</td>
                  <td className="px-2 py-2 leading-relaxed">{item.checklistStep || '待人工确认'}</td>
                  <td className="px-2 py-2 font-mono whitespace-nowrap">{item.code}</td>
                  <td className="px-2 py-2 leading-relaxed">{item.name}</td>
                  <td className="max-w-80 whitespace-pre-wrap break-words px-2 py-2 leading-relaxed text-muted-foreground">{item.feature || ''}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{item.unit}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(item.quantity)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(item.maxUnitPrice)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(item.maxTotalPrice ?? item.maxUnitPrice * item.quantity)}</td>
                  <td className="border-r border-border px-2 py-2 text-center" title={item.screeningBasis}>
                    {item.isScreeningItem ? '是' : '否'}
                  </td>
                  <td className="px-2 py-2 text-center">{item.deviationLevel}</td>
                  <td className="border-r border-border px-2 py-2 text-right font-mono">{formatPercent(item.deviationRate)}</td>
                  <td className="px-2 py-2 leading-relaxed text-muted-foreground">{item.profitOpportunity || item.optimization || '待人工确认'}</td>
                  <td className="border-r border-border px-2 py-2 text-center">
                    <select
                      value={overrides[itemKey(item)]?.strategyLevel ?? item.strategyLevel}
                      onChange={(event) => updateOverride(item, { strategyLevel: event.target.value })}
                      className={`w-24 rounded border border-border px-1.5 py-1 text-xs ${STRATEGY_COLORS[overrides[itemKey(item)]?.strategyLevel ?? item.strategyLevel] || ''}`}
                      aria-label={`${item.name}建议价格等级`}
                    >
                      {STRATEGY_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </td>
                  <td className="border-r border-border px-2 py-2 leading-relaxed text-muted-foreground">{item.reviewStatus || '需人工复核'}</td>
                  <td className="min-w-72 max-w-96 px-2 py-2">
                    <textarea
                      value={overrides[itemKey(item)]?.suggestion ?? item.suggestion}
                      onChange={(event) => updateOverride(item, { suggestion: event.target.value })}
                      rows={3}
                      className="min-h-20 w-full resize-y whitespace-pre-wrap break-words rounded border border-border bg-background px-2 py-1 leading-relaxed"
                      aria-label={`${item.name}报价建议`}
                    />
                  </td>
                  <td className="w-80 max-w-80 whitespace-pre-wrap break-words px-2 py-2 leading-relaxed text-muted-foreground">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
