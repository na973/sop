'use client';

import { useState } from 'react';
import { useAppState, type PriceCompareItem } from '@/lib/app-state';

export default function Step3Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>('全部');

  const handleCompare = async () => {
    if (!state.fileBase64) {
      setError('请先在步骤2上传Excel文件');
      return;
    }
    if (!state.maxPriceTotal) {
      setError('请设置最高投标限价合计');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/step3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table7FileBase64: state.fileBase64,
          maxPriceTotal: state.maxPriceTotal,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '对比失败');
      updateState({ step3Data: data.compareItems });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const items = state.step3Data || [];
  const filtered = filterLevel === '全部' ? items : items.filter((i) => i.deviationLevel === filterLevel);

  const deviationLevels = ['控制价明显偏高', '控制价偏高', '基本接近', '控制价偏低', '控制价明显偏低/疑似已压价'];
  const levelColors: Record<string, string> = {
    '控制价明显偏高': 'text-rose-600 bg-rose-50',
    '控制价偏高': 'text-orange-600 bg-orange-50',
    '基本接近': 'text-slate-600 bg-slate-50',
    '控制价偏低': 'text-blue-600 bg-blue-50',
    '控制价明显偏低/疑似已压价': 'text-purple-600 bg-purple-50',
  };

  return (
    <div className="h-full flex flex-col">
      {/* 操作区 */}
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white flex-wrap">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤3：最高投标限价对比</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600">最高限价合计:</label>
          <input
            type="number"
            value={state.maxPriceTotal || ''}
            onChange={(e) => updateState({ maxPriceTotal: Number(e.target.value) })}
            placeholder="0.00"
            className="w-36 px-2 py-1 text-xs border rounded font-mono"
          />
          <span className="text-xs text-slate-400">元</span>
        </div>
        <button
          onClick={handleCompare}
          disabled={loading || !state.fileBase64}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '计算中...' : '限价对比'}
        </button>
        {!state.fileBase64 && (
          <span className="text-xs text-rose-500">需先完成步骤2上传文件</span>
        )}
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 统计摘要 */}
      {items.length > 0 && (
        <div className="mx-4 mt-2 grid grid-cols-5 gap-3">
          <div className="p-2 bg-slate-50 rounded text-center">
            <div className="text-lg font-mono font-semibold text-slate-800">{items.length}</div>
            <div className="text-xs text-slate-500">总条目</div>
          </div>
          <div className="p-2 bg-rose-50 rounded text-center">
            <div className="text-lg font-mono font-semibold text-rose-600">{items.filter(i => Math.abs(i.deviationRate) >= 0.20).length}</div>
            <div className="text-xs text-slate-500">高偏差(&gt;20%)</div>
          </div>
          <div className="p-2 bg-orange-50 rounded text-center">
            <div className="text-lg font-mono font-semibold text-orange-600">{items.filter(i => Math.abs(i.deviationRate) >= 0.10 && Math.abs(i.deviationRate) < 0.20).length}</div>
            <div className="text-xs text-slate-500">中偏差(10-20%)</div>
          </div>
          <div className="p-2 bg-emerald-50 rounded text-center">
            <div className="text-lg font-mono font-semibold text-emerald-600">{items.filter(i => Math.abs(i.deviationRate) < 0.10).length}</div>
            <div className="text-xs text-slate-500">低偏差(&lt;10%)</div>
          </div>
          <div className="p-2 bg-amber-50 rounded text-center">
            <div className="text-lg font-mono font-semibold text-amber-600">{items.filter(i => i.isScreeningItem).length}</div>
            <div className="text-xs text-slate-500">单价甄别项</div>
          </div>
        </div>
      )}

      {/* 筛选标签 */}
      {items.length > 0 && (
        <div className="px-4 pt-2 flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterLevel('全部')}
            className={`text-xs px-2.5 py-1 rounded ${filterLevel === '全部' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            全部 ({items.length})
          </button>
          {deviationLevels.map((level) => {
            const count = items.filter((i) => i.deviationLevel === level).length;
            if (count === 0) return null;
            return (
              <button
                key={level}
                onClick={() => setFilterLevel(level)}
                className={`text-xs px-2.5 py-1 rounded ${filterLevel === level ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
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
                <th className="border border-slate-300 px-2 py-1">项目编码</th>
                <th className="border border-slate-300 px-2 py-1">项目名称</th>
                <th className="border border-slate-300 px-2 py-1">单位</th>
                <th className="border border-slate-300 px-2 py-1 text-right">工程量</th>
                <th className="border border-slate-300 px-2 py-1 text-right">我方单价</th>
                <th className="border border-slate-300 px-2 py-1 text-right">限价单价</th>
                <th className="border border-slate-300 px-2 py-1 text-right">偏差率</th>
                <th className="border border-slate-300 px-2 py-1">偏差等级</th>
                <th className="border border-slate-300 px-2 py-1">甄别项</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="border border-slate-300 px-2 py-1">{item.category}</td>
                  <td className="border border-slate-300 px-2 py-1 font-mono">{item.code}</td>
                  <td className="border border-slate-300 px-2 py-1">{item.name}</td>
                  <td className="border border-slate-300 px-2 py-1">{item.unit}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.quantity.toLocaleString()}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.ourUnitPrice.toFixed(2)}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono text-amber-700">{item.maxUnitPrice.toFixed(2)}</td>
                  <td className={`border border-slate-300 px-2 py-1 text-right font-mono ${item.deviationRate >= 0.10 ? 'text-rose-600' : item.deviationRate <= -0.10 ? 'text-blue-600' : 'text-slate-600'}`}>
                    {(item.deviationRate * 100).toFixed(1)}%
                  </td>
                  <td className="border border-slate-300 px-2 py-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${levelColors[item.deviationLevel] || ''}`}>
                      {item.deviationLevel}
                    </span>
                  </td>
                  <td className="border border-slate-300 px-2 py-1 text-center">
                    {item.isScreeningItem && <span className="text-amber-500">&#9679;</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!items.length && !loading && (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            上传Excel文件并设置限价合计后，点击"限价对比"
          </div>
        )}
      </div>
    </div>
  );
}
