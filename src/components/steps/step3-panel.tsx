'use client';

import { useRef, useState } from 'react';
import { useAppState, type PriceCompareItem } from '@/lib/app-state';

export default function Step3Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>('全部');
  const [limitPdfBase64, setLimitPdfBase64] = useState('');
  const [limitPdfName, setLimitPdfName] = useState('');
  const [limitBillBase64, setLimitBillBase64] = useState('');
  const [limitBillName, setLimitBillName] = useState('');
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const billInputRef = useRef<HTMLInputElement>(null);

  const fileToBase64 = async (file: File) => {
    const buffer = await file.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  };

  const handleLimitPdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLimitPdfBase64(await fileToBase64(file));
    setLimitPdfName(file.name);
  };

  const handleLimitBillChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLimitBillBase64(await fileToBase64(file));
    setLimitBillName(file.name);
  };

  const handleCompare = async () => {
    if (!state.step2Data?.bidItems?.length) {
      setError('请先在步骤2上传表2清单组价表，并完成组价计算');
      return;
    }
    if (!limitPdfBase64) {
      setError('请上传最高投标限价PDF文件');
      return;
    }
    if (!limitBillBase64) {
      setError('请上传表3分部分项工程量清单计价表');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/step3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidItems: state.step2Data.bidItems,
          limitPdfBase64,
          limitBillFileBase64: limitBillBase64,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '对比失败');
      updateState({ step3Data: data.compareItems, maxPriceTotal: data.maxPriceTotal });
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
        <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={handleLimitPdfChange} />
        <input ref={billInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleLimitBillChange} />
        <button
          onClick={() => pdfInputRef.current?.click()}
          className="px-3 py-1 text-xs bg-slate-700 text-white rounded hover:bg-slate-800"
        >
          上传最高限价PDF
        </button>
        <button
          onClick={() => billInputRef.current?.click()}
          className="px-3 py-1 text-xs bg-slate-700 text-white rounded hover:bg-slate-800"
        >
          上传表3清单计价表
        </button>
        <button
          onClick={handleCompare}
          disabled={loading || !state.step2Data?.bidItems?.length || !limitPdfBase64 || !limitBillBase64}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '计算中...' : '限价对比'}
        </button>
        {limitPdfName && <span className="text-xs text-slate-500">PDF: {limitPdfName}</span>}
        {limitBillName && <span className="text-xs text-slate-500">表3: {limitBillName}</span>}
        {state.maxPriceTotal > 0 && (
          <span className="text-xs text-emerald-700">PDF提取最高限价: {state.maxPriceTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元</span>
        )}
        {!state.step2Data?.bidItems?.length && (
          <span className="text-xs text-rose-500">需先完成步骤2表2清单组价</span>
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
                <th className="border border-slate-300 px-2 py-1">来源</th>
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
                  <td className="border border-slate-300 px-2 py-1">
                    {item.limitPriceSource === 'pdf' ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">PDF</span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">表3兜底</span>
                    )}
                  </td>
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
            上传最高限价PDF和表3清单计价表后，点击&quot;限价对比&quot;
          </div>
        )}
      </div>
    </div>
  );
}
