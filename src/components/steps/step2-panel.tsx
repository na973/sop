'use client';

import { useState, useRef } from 'react';
import { useAppState } from '@/lib/app-state';

export default function Step2Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      // Store file base64 for later steps
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      updateState({ fileBase64: base64, fileName: file.name });

      // Call step2 API
      const res = await fetch('/api/step2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: base64 }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '组价计算失败');
      updateState({ step2Data: data });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  const bidItems = state.step2Data?.bidItems || [];
  const summary = state.step2Data?.summary || {};
  const stats = state.step2Data?.stats;

  return (
    <div className="h-full flex flex-col">
      {/* 操作区 */}
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤2：清单组价</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '计算中...' : '上传Excel文件'}
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        {state.fileName && <span className="text-xs text-slate-500">当前文件: {state.fileName}</span>}
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 文件拖拽区 */}
      {!state.step2Data && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="m-4 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-amber-400 transition-colors"
        >
          <div className="text-sm text-slate-500">拖拽Excel文件到此处，或点击上方按钮选择文件</div>
          <div className="text-xs text-slate-400 mt-2">支持 .xlsx 格式，包含清单数据和公式的工作簿</div>
        </div>
      )}

      {/* 计算统计 */}
      {stats && (
        <div className="mx-4 mt-2 grid grid-cols-4 gap-3">
          <div className="p-3 bg-slate-50 rounded border">
            <div className="text-xs text-slate-500">总公式数</div>
            <div className="font-mono font-semibold text-slate-800">{stats.totalFormulas}</div>
          </div>
          <div className="p-3 bg-emerald-50 rounded border">
            <div className="text-xs text-slate-500">计算成功</div>
            <div className="font-mono font-semibold text-emerald-700">{stats.calculated}</div>
          </div>
          <div className="p-3 bg-rose-50 rounded border">
            <div className="text-xs text-slate-500">错误数</div>
            <div className="font-mono font-semibold text-rose-700">{stats.errorCount}</div>
          </div>
          <div className="p-3 bg-amber-50 rounded border">
            <div className="text-xs text-slate-500">计算耗时</div>
            <div className="font-mono font-semibold text-amber-700">{stats.totalFormulas} formulas</div>
          </div>
        </div>
      )}

      {/* 汇总数据 */}
      {Object.keys(summary).length > 0 && (
        <div className="mx-4 mt-3">
          <h3 className="text-xs font-semibold text-slate-700 mb-2">汇总数据</h3>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(summary).map(([key, value]) => (
              <div key={key} className="p-2 bg-white rounded border border-slate-200">
                <div className="text-xs text-slate-500">{key}</div>
                <div className="font-mono text-sm font-semibold text-slate-800">
                  {typeof value === 'number' ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) : String(value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 清单项表格 */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {bidItems.length > 0 && (
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">分部分项清单 ({bidItems.length}项)</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1">分类</th>
                  <th className="border border-slate-300 px-2 py-1">项目编码</th>
                  <th className="border border-slate-300 px-2 py-1">项目名称</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">工程量</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">综合单价</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">合价</th>
                </tr>
              </thead>
              <tbody>
                {bidItems.map((item: { category: string; code: string; name: string; quantity: number; unitPrice: number; totalPrice: number }, i: number) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="border border-slate-300 px-2 py-1">{item.category}</td>
                    <td className="border border-slate-300 px-2 py-1 font-mono">{item.code}</td>
                    <td className="border border-slate-300 px-2 py-1">{item.name}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.quantity.toLocaleString()}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.unitPrice.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono font-semibold">{item.totalPrice.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
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
