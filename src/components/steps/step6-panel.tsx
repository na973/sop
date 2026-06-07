'use client';

import { useState } from 'react';
import { useAppState, type BalancedItem } from '@/lib/app-state';

export default function Step6Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCalculate = async () => {
    if (!state.fileBase64) {
      setError('请先上传Excel文件（步骤2）');
      return;
    }
    if (!state.step5Data?.level2?.items?.length) {
      setError('请先完成步骤5配平');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const balancedItems = state.step5Data.level2.items.map((item: BalancedItem) => ({
        row: item.row,
        category: item.category,
        code: item.code,
        name: item.name,
        quantity: item.quantity,
        targetUnitPrice: item.targetUnitPrice,
        targetTotalPrice: item.targetTotalPrice,
      }));

      const res = await fetch('/api/step6', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: state.fileBase64,
          balancedItems,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '材料调价失败');
      updateState({ step6Data: data });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const l3 = state.step6Data?.level3;
  const validation = state.step6Data?.validation;
  const priceChanges = l3?.priceChanges || [];

  return (
    <div className="h-full flex flex-col">
      {/* 操作区 */}
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤6：材料调价配平</h2>
        <button
          onClick={handleCalculate}
          disabled={loading || !state.step5Data}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '计算中...' : '材料调价'}
        </button>
        {!state.step5Data && (
          <span className="text-xs text-rose-500">需先完成步骤5配平</span>
        )}
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 计算结果概览 */}
      {validation && (
        <div className="mx-4 mt-2 grid grid-cols-4 gap-3">
          <div className="p-3 bg-slate-50 rounded border">
            <div className="text-xs text-slate-500">基准总价</div>
            <div className="font-mono font-semibold text-slate-800">{l3?.baseTotal.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-amber-50 rounded border">
            <div className="text-xs text-slate-500">目标总价</div>
            <div className="font-mono font-semibold text-amber-700">{validation.targetTotal.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-emerald-50 rounded border">
            <div className="text-xs text-slate-500">最终总价</div>
            <div className="font-mono font-semibold text-emerald-700">{validation.actualTotal.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-blue-50 rounded border">
            <div className="text-xs text-slate-500">缩放因子k</div>
            <div className="font-mono font-semibold text-blue-700">{validation.bestScaleFactor.toFixed(4)}</div>
          </div>
        </div>
      )}

      {/* 收敛状态 */}
      {validation && (
        <div className="mx-4 mt-2 flex gap-3">
          <span className={`text-xs px-2 py-1 rounded ${validation.converged ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            {validation.converged ? '已收敛' : '未收敛'} ({validation.iterations}次迭代)
          </span>
          <span className={`text-xs px-2 py-1 rounded ${Math.abs(validation.diff) < 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            差额: {validation.diff.toFixed(2)}元
          </span>
        </div>
      )}

      {/* 材料价格变更 */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {priceChanges.length > 0 && (
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">材料价格调整 ({priceChanges.length}项)</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1">编码</th>
                  <th className="border border-slate-300 px-2 py-1">名称</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">原含税市场价</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">调后含税市场价</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">调整额</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">调整率</th>
                </tr>
              </thead>
              <tbody>
                {priceChanges.map((pc: { code: string; name: string; originalPrice: number; adjustedPrice: number; diff: number }, i: number) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="border border-slate-300 px-2 py-1 font-mono">{pc.code}</td>
                    <td className="border border-slate-300 px-2 py-1">{pc.name}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{pc.originalPrice.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono text-amber-700">{pc.adjustedPrice.toFixed(2)}</td>
                    <td className={`border border-slate-300 px-2 py-1 text-right font-mono ${pc.diff > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {pc.diff > 0 ? '+' : ''}{pc.diff.toFixed(2)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">
                      {((pc.diff / pc.originalPrice) * 100).toFixed(1)}%
                    </td>
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
