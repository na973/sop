'use client';

import { useState, useCallback } from 'react';
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

export function Step4Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [overrides, setOverrides] = useState<Record<string, { row: number; code: string; category: string; quantityForecast?: string; optimization?: string }>>({});

  const step3Data = state.step3Data;
  const step4Data = state.step4Data;

  const handleStrategy = useCallback(async () => {
    if (!step3Data || step3Data.length === 0) {
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
          strategyOverrides: Object.values(overrides),
          averageDiscountRate: state.targetDiscountRate || 0.3,
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
  }, [step3Data, overrides, state.targetDiscountRate, updateState]);

  const updateOverride = useCallback((item: StrategyItem, field: 'quantityForecast' | 'optimization', value: string) => {
    const key = `${item.category}|${item.row}|${item.code}`;
    setOverrides((prev) => ({
      ...prev,
      [key]: {
        row: item.row,
        code: item.code,
        category: item.category,
        quantityForecast: field === 'quantityForecast' ? value : prev[key]?.quantityForecast,
        optimization: field === 'optimization' ? value : prev[key]?.optimization,
      },
    }));
  }, []);

  const handleExport = useCallback(async () => {
    if (!step4Data) return;
    const rows = step4Data.map((it) => [
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
  }, [step4Data]);

  const strategyCounts = step4Data ? Object.entries(
    step4Data.reduce<Record<string, number>>((acc, it) => {
      acc[it.strategyLevel] = (acc[it.strategyLevel] || 0) + 1;
      return acc;
    }, {}),
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤4：不平衡报价策略</h2>
        {step4Data && (
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

      {step4Data && Object.keys(overrides).length > 0 && (
        <div className="text-xs text-amber-700 p-2 bg-amber-50 rounded">
          已修改人工预测/优化判断，请点击“分配报价策略”重新计算评分和建议价格。
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

      {/* 策略结果表格：对应《表5 不平衡报价策略表.xlsx》的“不平衡报价策略”工作表 */}
      {step4Data && (
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
              {step4Data.map((it, i) => (
                <tr key={i} className="border-t border-border align-top hover:bg-muted/20">
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
                      onChange={(e) => updateOverride(it, 'quantityForecast', e.target.value)}
                    >
                      {QUANTITY_FORECAST_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td className="border-r border-border px-2 py-2 text-center font-mono">{it.quantityScore ?? 0}</td>
                  <td className="px-2 py-2 text-center">
                    <select
                      className="w-full min-w-32 border border-border rounded bg-background px-1 py-1"
                      value={it.optimization}
                      onChange={(e) => updateOverride(it, 'optimization', e.target.value)}
                    >
                      {OPTIMIZATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td className="border-r border-border px-2 py-2 text-center font-mono">{it.optimizationScore ?? 0}</td>
                  <td className="px-2 py-2 text-center text-muted-foreground whitespace-normal break-words">{it.deviationLevel}</td>
                  <td className="border-r border-border px-2 py-2 text-center font-mono">{it.deviationScore ?? 0}</td>
                  <td className="px-2 py-2 text-center font-mono">{it.totalScore}</td>
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
