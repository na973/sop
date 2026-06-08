'use client';

import { useState } from 'react';
import { useAppState, type BalancedItem } from '@/lib/app-state';

export default function Step5Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxPriceTotal = state.maxPriceTotal || 38000000;
  const targetDiscountRate = state.targetDiscountRate || 0.05;

  const handleCalculate = async () => {
    if (!state.fileBase64) {
      setError('请先上传Excel文件（步骤2）');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/step5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: state.fileBase64,
          maxPriceTotal,
          targetDiscountRate,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '配平计算失败');
      updateState({ step5Data: data });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const l1 = state.step5Data?.level1;
  const l2 = state.step5Data?.level2;
  const validation = state.step5Data?.validation;
  const items = l2?.items || [];

  return (
    <div className="h-full flex flex-col">
      {/* 操作区 */}
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white flex-wrap">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤5：清单调价配平</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600">最高限价合计:</label>
          <input
            type="number"
            value={maxPriceTotal}
            onChange={(e) => updateState({ maxPriceTotal: Number(e.target.value) })}
            className="w-32 px-2 py-1 text-xs border rounded font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600">下浮率:</label>
          <input
            type="number"
            step="0.01"
            value={targetDiscountRate}
            onChange={(e) => updateState({ targetDiscountRate: Number(e.target.value) })}
            className="w-20 px-2 py-1 text-xs border rounded font-mono"
          />
        </div>
        <button
          onClick={handleCalculate}
          disabled={loading || !state.fileBase64}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '计算中...' : '配平计算'}
        </button>
        {!state.fileBase64 && (
          <span className="text-xs text-rose-500">需先上传Excel文件（步骤2）</span>
        )}
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 一级配平结果 */}
      {l1 && (
        <div className="mx-4 mt-2 grid grid-cols-3 gap-3">
          <div className="p-3 bg-slate-50 rounded border">
            <div className="text-xs text-slate-500">最高限价合计</div>
            <div className="font-mono font-semibold text-slate-800">{l1.maxPriceTotal.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-amber-50 rounded border">
            <div className="text-xs text-slate-500">目标总价（下浮{(l1.discountRate * 100).toFixed(1)}%）</div>
            <div className="font-mono font-semibold text-amber-700">{l1.targetTotal.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-emerald-50 rounded border">
            <div className="text-xs text-slate-500">实际总价</div>
            <div className="font-mono font-semibold text-emerald-700">{l2?.actualTotal.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* 校验结果 */}
      {validation && (
        <div className="mx-4 mt-2 flex gap-3">
          <span className={`text-xs px-2 py-1 rounded ${validation.totalPass ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            总价偏差: {validation.totalPass ? '通过' : '未通过'} (差额 {validation.totalDiff.toFixed(2)})
          </span>
          <span className={`text-xs px-2 py-1 rounded ${validation.coefficientPass ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            单价甄别: {validation.coefficientPass ? '通过' : '未通过'} (违规 {validation.coefficientViolationCount} 条)
          </span>
          <span className={`text-xs px-2 py-1 rounded font-medium ${validation.overallPass ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            综合: {validation.overallPass ? '通过' : '未通过'}
          </span>
        </div>
      )}

      {/* 清单配平表 */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {items.length > 0 && (
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">清单配平明细 ({items.length}项)</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1">分类</th>
                  <th className="border border-slate-300 px-2 py-1">项目编码</th>
                  <th className="border border-slate-300 px-2 py-1">项目名称</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">工程量</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">原始单价</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">限价单价</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">价格比</th>
                  <th className="border border-slate-300 px-2 py-1">策略</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">目标单价</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">目标合价</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: BalancedItem, i: number) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="border border-slate-300 px-2 py-1">{item.category}</td>
                    <td className="border border-slate-300 px-2 py-1 font-mono">{item.code}</td>
                    <td className="border border-slate-300 px-2 py-1">{item.name}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.quantity.toLocaleString()}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.unitPrice.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono text-amber-700">{item.maxUnitPrice.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.priceRatio.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1">{item.strategy}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono font-semibold">{item.targetUnitPrice.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.targetTotalPrice.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
