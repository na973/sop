'use client';

import { useState } from 'react';
import { useAppState } from '@/lib/app-state';

export default function Step7Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [finalSummary, setFinalSummary] = useState<Array<{ key: string; content: string; amount: number }> | null>(null);

  const handleExport = async () => {
    if (!state.fileBase64) {
      setError('请先上传Excel文件');
      return;
    }
    if (!state.step5Data?.level2?.items?.length) {
      setError('请先完成步骤5配平');
      return;
    }
    if (!state.step6Data?.level3?.priceChanges?.length) {
      setError('请先完成步骤6材料调价');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const balancedItems = state.step5Data.level2.items.map((item) => ({
        row: item.row,
        category: item.category,
        code: item.code,
        name: item.name,
        quantity: item.quantity,
        targetUnitPrice: item.targetUnitPrice,
        targetTotalPrice: item.targetTotalPrice,
      }));

      const res = await fetch('/api/step7', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table7FileBase64: state.fileBase64,
          balancedItems,
          priceChanges: state.step6Data.level3.priceChanges,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '导出失败');

      // 下载Excel文件
      const buffer = Buffer.from(data.fileBase64, 'base64');
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.fileName || '调价后报价表.xlsx';
      a.click();
      URL.revokeObjectURL(url);

      setFinalSummary(data.summary);
      setExported(true);
      updateState({ step7Completed: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 操作区 */}
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤7：调价与导出</h2>
        <button
          onClick={handleExport}
          disabled={loading || !state.step6Data}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '生成中...' : '导出调价后Excel'}
        </button>
        {!state.step6Data && (
          <span className="text-xs text-rose-500">需先完成步骤5/6配平</span>
        )}
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 导出状态 */}
      {exported && (
        <div className="mx-4 mt-2 p-3 bg-emerald-50 rounded border border-emerald-200">
          <div className="flex items-center gap-2 text-emerald-700">
            <span className="text-lg">&#10003;</span>
            <span className="text-sm font-medium">调价后报价表已导出</span>
          </div>
          <p className="text-xs text-emerald-600 mt-1">
            文件已保存到本地，请查看下载目录
          </p>
        </div>
      )}

      {/* 调价前后对比 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* 当前数据概览 */}
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">配平结果概览</h3>
            <div className="grid grid-cols-3 gap-4">
              {state.step5Data && (
                <>
                  <div className="p-3 bg-slate-50 rounded">
                    <div className="text-xs text-slate-500 mb-1">最高限价合计</div>
                    <div className="font-mono font-semibold text-slate-800">
                      {state.step5Data.level1.maxPriceTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}元
                    </div>
                  </div>
                  <div className="p-3 bg-amber-50 rounded">
                    <div className="text-xs text-slate-500 mb-1">目标总价</div>
                    <div className="font-mono font-semibold text-amber-700">
                      {state.step5Data.level1.targetTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}元
                    </div>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded">
                    <div className="text-xs text-slate-500 mb-1">配平后总价</div>
                    <div className="font-mono font-semibold text-emerald-700">
                      {state.step5Data.level2.actualTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}元
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 材料调价概览 */}
          {state.step6Data && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">材料调价概览</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-slate-50 rounded">
                  <div className="text-xs text-slate-500 mb-1">调价前总价</div>
                  <div className="font-mono font-semibold text-slate-800">
                    {state.step6Data.level3.baseTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}元
                  </div>
                </div>
                <div className="p-3 bg-amber-50 rounded">
                  <div className="text-xs text-slate-500 mb-1">调价方式</div>
                  <div className="font-mono font-semibold text-amber-700">
                    逐项材料分摊
                  </div>
                </div>
                <div className="p-3 bg-emerald-50 rounded">
                  <div className="text-xs text-slate-500 mb-1">最终总价</div>
                  <div className="font-mono font-semibold text-emerald-700">
                    {state.step6Data.validation.actualTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}元
                  </div>
                </div>
              </div>

              {/* 材料价格变更 */}
              {state.step6Data.level3.priceChanges.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-medium text-slate-700 mb-2">材料价格调整</h4>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-300 px-2 py-1">编码</th>
                        <th className="border border-slate-300 px-2 py-1">名称</th>
                        <th className="border border-slate-300 px-2 py-1 text-right">原单价</th>
                        <th className="border border-slate-300 px-2 py-1 text-right">调后单价</th>
                        <th className="border border-slate-300 px-2 py-1 text-right">调整额</th>
                        <th className="border border-slate-300 px-2 py-1 text-right">调整率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.step6Data.level3.priceChanges.map((pc, i) => (
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
          )}

          {/* 导出后最终汇总 */}
          {finalSummary && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">调价后最终汇总</h3>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 px-3 py-1.5 text-left">序号</th>
                    <th className="border border-slate-300 px-3 py-1.5 text-left">汇总内容</th>
                    <th className="border border-slate-300 px-3 py-1.5 text-right">金额(元)</th>
                  </tr>
                </thead>
                <tbody>
                  {finalSummary.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="border border-slate-300 px-3 py-1.5">{row.key}</td>
                      <td className="border border-slate-300 px-3 py-1.5">{row.content}</td>
                      <td className="border border-slate-300 px-3 py-1.5 text-right font-mono">{row.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!state.step5Data && !loading && (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
              完成步骤5/6配平后，可导出调价后的Excel文件
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
