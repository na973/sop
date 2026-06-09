'use client';

import { useState, useCallback } from 'react';
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

export function Step4Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        body: JSON.stringify({ compareItems: step3Data }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({ step4Data: data.items });
      } else {
        setError(data.error || '策略分配失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [step3Data, updateState]);

  const handleExport = useCallback(async () => {
    if (!step4Data) return;
    const rows = step4Data.map((it) => [
      it.category, it.code, it.name, it.unit,
      it.quantity, it.maxUnitPrice, it.ourUnitPrice,
      it.deviationLevel, it.quantityForecast, it.optimization,
      it.totalScore, it.strategyLevel,
      `${it.coefficientRange[0]}~${it.coefficientRange[1]}`,
      it.suggestion,
    ]);
    const result = await exportToExcel(
      [{ name: '报价策略', headers: ['分部', '编码', '名称', '单位', '工程量', '限价单价', '我方单价', '偏差等级', '工程量预测', '优化评估', '总分', '策略等级', '系数范围', '建议'], rows }],
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
    <div className="space-y-4">
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
      {step4Data && (
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-2 py-1.5 text-left">分部</th>
                <th className="px-2 py-1.5 text-left">编码</th>
                <th className="px-2 py-1.5 text-left">名称</th>
                <th className="px-2 py-1.5 text-right">工程量</th>
                <th className="px-2 py-1.5 text-right">偏差</th>
                <th className="px-2 py-1.5 text-center">评分</th>
                <th className="px-2 py-1.5 text-center">策略</th>
                <th className="px-2 py-1.5 text-center">系数范围</th>
              </tr>
            </thead>
            <tbody>
              {step4Data.map((it, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1">{it.category}</td>
                  <td className="px-2 py-1 font-mono">{it.code}</td>
                  <td className="px-2 py-1">{it.name}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.quantity)}</td>
                  <td className="px-2 py-1 text-center text-muted-foreground">{it.deviationLevel}</td>
                  <td className="px-2 py-1 text-center font-mono">{it.totalScore}</td>
                  <td className="px-2 py-1 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${STRATEGY_COLORS[it.strategyLevel] || ''}`}>
                      {it.strategyLevel}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-center font-mono text-[10px]">
                    {it.coefficientRange[0]}~{it.coefficientRange[1]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
