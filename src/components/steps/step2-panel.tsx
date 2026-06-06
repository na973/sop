'use client';

import { useState, useRef } from 'react';

interface SummaryRow {
  key: string;
  content: string;
  amount: number;
}

interface BidItem {
  row: number;
  category: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface Step2Result {
  success: boolean;
  calculationTime: string;
  stats: { totalFormulas: number; calculated: number; errorCount: number; firstErrors: Array<{ sheet: string; cell: string; error: string }> };
  summary: SummaryRow[] | null;
  bidItems: BidItem[];
  resourceSummary: Array<{ row: number; code: string; name: string; unit: string; quantity: number; price: number; totalPrice: number }>;
}

export default function Step2Panel() {
  const [result, setResult] = useState<Step2Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'items' | 'resources'>('summary');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('请选择文件'); return; }

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/step2', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '计算失败');
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部操作区 */}
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤2：清单组价</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="text-xs text-slate-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100"
        />
        <button
          onClick={handleUpload}
          disabled={loading}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '计算中...' : '导入并计算'}
        </button>
      </div>

      {/* 错误提示 */}
      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 计算统计 */}
      {result && (
        <div className="mx-4 mt-2 p-2 bg-slate-50 rounded text-xs text-slate-600">
          公式: {result.stats.totalFormulas} | 已计算: {result.stats.calculated} | 错误: {result.stats.errorCount} | 耗时: {result.calculationTime}
          {result.stats.errorCount > 0 && result.stats.firstErrors.map((e, i) => (
            <div key={i} className="text-red-600 mt-1">[{e.sheet}] {e.cell}: {e.error}</div>
          ))}
        </div>
      )}

      {/* 标签页 */}
      {result && (
        <div className="flex border-b border-slate-200 mx-4">
          {(['summary', 'items', 'resources'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'summary' ? '汇总表' : tab === 'items' ? '清单条目' : '工料机汇总'}
            </button>
          ))}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-4">
        {result && activeTab === 'summary' && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-1 text-left">序号</th>
                <th className="border border-slate-300 px-2 py-1 text-left">汇总内容</th>
                <th className="border border-slate-300 px-2 py-1 text-right">金额(元)</th>
              </tr>
            </thead>
            <tbody>
              {result.summary?.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="border border-slate-300 px-2 py-1">{row.key}</td>
                  <td className="border border-slate-300 px-2 py-1">{row.content}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{row.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {result && activeTab === 'items' && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-1">分类</th>
                <th className="border border-slate-300 px-2 py-1">项目编码</th>
                <th className="border border-slate-300 px-2 py-1">项目名称</th>
                <th className="border border-slate-300 px-2 py-1">单位</th>
                <th className="border border-slate-300 px-2 py-1 text-right">工程量</th>
                <th className="border border-slate-300 px-2 py-1 text-right">综合单价</th>
                <th className="border border-slate-300 px-2 py-1 text-right">综合合价</th>
              </tr>
            </thead>
            <tbody>
              {result.bidItems.map((item, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="border border-slate-300 px-2 py-1">{item.category}</td>
                  <td className="border border-slate-300 px-2 py-1 font-mono">{item.code}</td>
                  <td className="border border-slate-300 px-2 py-1">{item.name}</td>
                  <td className="border border-slate-300 px-2 py-1">{item.unit}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.quantity.toLocaleString()}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.unitPrice.toFixed(2)}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.totalPrice.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {result && activeTab === 'resources' && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-1">编码</th>
                <th className="border border-slate-300 px-2 py-1">名称</th>
                <th className="border border-slate-300 px-2 py-1">单位</th>
                <th className="border border-slate-300 px-2 py-1 text-right">数量</th>
                <th className="border border-slate-300 px-2 py-1 text-right">单价</th>
                <th className="border border-slate-300 px-2 py-1 text-right">合价</th>
              </tr>
            </thead>
            <tbody>
              {result.resourceSummary.map((res, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="border border-slate-300 px-2 py-1 font-mono">{res.code}</td>
                  <td className="border border-slate-300 px-2 py-1">{res.name}</td>
                  <td className="border border-slate-300 px-2 py-1">{res.unit}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{res.quantity.toFixed(4)}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{res.price.toFixed(2)}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{res.totalPrice.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!result && !loading && (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            上传清单组价表Excel文件，点击"导入并计算"
          </div>
        )}
      </div>
    </div>
  );
}
