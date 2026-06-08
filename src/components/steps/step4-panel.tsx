'use client';

import { useState } from 'react';
import { useAppState, type StrategyItem } from '@/lib/app-state';

const FORECAST_OPTIONS = ['明确增加', '可能增加', '基本一致/不确定', '可能减少', '明确减少'];
const OPTIMIZATION_OPTIONS = ['不能优化', '少量优化', '中等优化', '较多优化', '大量优化'];

const STRATEGY_COLORS: Record<string, string> = {
  '极高': 'bg-rose-100 text-rose-700',
  '高': 'bg-orange-100 text-orange-700',
  '平均偏高': 'bg-amber-100 text-amber-700',
  '平均': 'bg-slate-100 text-slate-700',
  '平均偏低': 'bg-blue-100 text-blue-700',
  '低': 'bg-indigo-100 text-indigo-700',
  '极低': 'bg-purple-100 text-purple-700',
};

export default function Step4Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<number, { quantityForecast: string; optimization: string }>>({});
  const [filterStrategy, setFilterStrategy] = useState<string>('全部');

  const handleCalculate = async () => {
    if (!state.step3Data?.length) {
      setError('请先完成步骤3限价对比');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 构建compareItems和overrides
      const compareItems = state.step3Data.map((item) => ({
        row: item.row,
        category: item.category,
        code: item.code,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        ourUnitPrice: item.ourUnitPrice,
        maxUnitPrice: item.maxUnitPrice,
        deviationLevel: item.deviationLevel,
        isScreeningItem: item.isScreeningItem,
      }));

      const strategyOverrides = Object.entries(overrides).map(([row, o]) => ({
        row: Number(row),
        ...o,
      }));

      const res = await fetch('/api/step4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compareItems, strategyOverrides }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '策略计算失败');
      updateState({ step4Data: data.strategyItems });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const items = state.step4Data || [];
  const filtered = filterStrategy === '全部' ? items : items.filter((i) => i.strategyLevel === filterStrategy);

  const strategyLevels = ['极高', '高', '平均偏高', '平均', '平均偏低', '低', '极低'];

  const updateOverride = (row: number, field: 'quantityForecast' | 'optimization', value: string) => {
    setOverrides((prev) => ({
      ...prev,
      [row]: { ...(prev[row] || { quantityForecast: '基本一致/不确定', optimization: '不能优化' }), [field]: value },
    }));
  };

  return (
    <div className="h-full flex flex-col">
      {/* 操作区 */}
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white flex-wrap">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤4：不平衡报价策略</h2>
        <button
          onClick={handleCalculate}
          disabled={loading || !state.step3Data?.length}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '计算中...' : '策略评分'}
        </button>
        {!state.step3Data?.length && (
          <span className="text-xs text-rose-500">需先完成步骤3限价对比</span>
        )}
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 策略分布 */}
      {items.length > 0 && (
        <div className="mx-4 mt-2 flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterStrategy('全部')}
            className={`text-xs px-2.5 py-1 rounded ${filterStrategy === '全部' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            全部 ({items.length})
          </button>
          {strategyLevels.map((level) => {
            const count = items.filter((i) => i.strategyLevel === level).length;
            if (count === 0) return null;
            return (
              <button
                key={level}
                onClick={() => setFilterStrategy(level)}
                className={`text-xs px-2.5 py-1 rounded ${filterStrategy === level ? 'bg-amber-500 text-white' : STRATEGY_COLORS[level]}`}
              >
                {level} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* 数据表格 */}
      <div className="flex-1 overflow-auto p-4">
        {filtered.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-1">分类</th>
                <th className="border border-slate-300 px-2 py-1">项目名称</th>
                <th className="border border-slate-300 px-2 py-1 text-right">我方单价</th>
                <th className="border border-slate-300 px-2 py-1 text-right">限价单价</th>
                <th className="border border-slate-300 px-2 py-1">偏差等级</th>
                <th className="border border-slate-300 px-2 py-1">工程量预测</th>
                <th className="border border-slate-300 px-2 py-1">优化空间</th>
                <th className="border border-slate-300 px-2 py-1 text-right">总分</th>
                <th className="border border-slate-300 px-2 py-1">策略等级</th>
                <th className="border border-slate-300 px-2 py-1">系数范围</th>
                <th className="border border-slate-300 px-2 py-1">建议</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="border border-slate-300 px-2 py-1">{item.category}</td>
                  <td className="border border-slate-300 px-2 py-1">{item.name}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.ourUnitPrice.toFixed(2)}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono text-amber-700">{item.maxUnitPrice.toFixed(2)}</td>
                  <td className="border border-slate-300 px-2 py-1 text-xs">{item.deviationLevel}</td>
                  <td className="border border-slate-300 px-2 py-1">
                    <select
                      value={overrides[item.row]?.quantityForecast || item.quantityForecast}
                      onChange={(e) => updateOverride(item.row, 'quantityForecast', e.target.value)}
                      className="text-xs border rounded px-1 py-0.5 w-24"
                    >
                      {FORECAST_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="border border-slate-300 px-2 py-1">
                    <select
                      value={overrides[item.row]?.optimization || item.optimization}
                      onChange={(e) => updateOverride(item.row, 'optimization', e.target.value)}
                      className="text-xs border rounded px-1 py-0.5 w-20"
                    >
                      {OPTIMIZATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className={`border border-slate-300 px-2 py-1 text-right font-mono font-semibold ${item.totalScore >= 4 ? 'text-rose-600' : item.totalScore <= -4 ? 'text-blue-600' : 'text-slate-700'}`}>
                    {item.totalScore}
                  </td>
                  <td className="border border-slate-300 px-2 py-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STRATEGY_COLORS[item.strategyLevel] || ''}`}>
                      {item.strategyLevel}
                    </span>
                  </td>
                  <td className="border border-slate-300 px-2 py-1 font-mono text-xs">
                    {item.coefficientRange[0].toFixed(2)}~{item.coefficientRange[1].toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1 text-xs text-slate-500 max-w-32">{item.suggestion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!items.length && !loading && (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            完成步骤3后，点击&quot;策略评分&quot;自动计算不平衡报价策略
          </div>
        )}
      </div>
    </div>
  );
}
