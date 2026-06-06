'use client';

import { useState, useRef } from 'react';

interface BalancedItem {
  row: number;
  category: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  maxUnitPrice: number;
  strategy: string;
  priceRatio: number;
  targetUnitPrice: number;
  targetTotalPrice: number;
}

interface Step5Result {
  success: boolean;
  level1: { maxPriceTotal: number; targetTotal: number; totalDiscount: number; discountRate: number; pass: boolean };
  level2: { totalItems: number; targetTotal: number; actualTotal: number; items: BalancedItem[] };
  validation: { totalDiff: number; totalDiffRate: number; totalPass: boolean; coefficientViolationCount: number; coefficientPass: boolean; overallPass: boolean };
}

export default function Step5Panel() {
  const [maxPriceTotal, setMaxPriceTotal] = useState<number>(0);
  const [targetDiscountRate, setTargetDiscountRate] = useState<number>(5);
  const [result, setResult] = useState<Step5Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('请选择表7文件');

      const b64 = await fileToBase64(file);
      const res = await fetch('/api/step5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table7FileBase64: b64,
          maxPriceTotal,
          targetDiscountRate: targetDiscountRate / 100,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '配平计算失败');
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
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white flex-wrap">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤5：清单调价配平</h2>
        <label className="text-xs text-slate-600">表7文件:</label>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="text-xs text-slate-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-amber-50 file:text-amber-700" />
        <label className="text-xs text-slate-600">最高限价合计:</label>
        <input type="number" value={maxPriceTotal || ''} onChange={(e) => setMaxPriceTotal(Number(e.target.value))} placeholder="0.00" className="w-32 px-2 py-1 text-xs border rounded font-mono" />
        <label className="text-xs text-slate-600">总下浮率(%):</label>
        <input type="number" value={targetDiscountRate} onChange={(e) => setTargetDiscountRate(Number(e.target.value))} step="0.1" className="w-20 px-2 py-1 text-xs border rounded font-mono" />
        <button onClick={handleCalculate} disabled={loading} className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50">
          {loading ? '计算中...' : '计算配平'}
        </button>
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 第一级：总价配平 */}
      {result && (
        <div className="mx-4 mt-2 p-3 bg-slate-50 rounded">
          <h3 className="text-xs font-semibold text-slate-700 mb-2">第一级：总价配平</h3>
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div><span className="text-slate-500">最高限价合计</span><br /><span className="font-mono font-semibold">{result.level1.maxPriceTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span></div>
            <div><span className="text-slate-500">目标总价</span><br /><span className="font-mono font-semibold text-amber-600">{result.level1.targetTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span></div>
            <div><span className="text-slate-500">总下浮额</span><br /><span className="font-mono font-semibold text-emerald-600">{result.level1.totalDiscount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span></div>
            <div><span className="text-slate-500">下浮率</span><br /><span className="font-mono font-semibold">{(result.level1.discountRate * 100).toFixed(2)}%</span></div>
          </div>
        </div>
      )}

      {/* 校验结果 */}
      {result && (
        <div className={`mx-4 mt-2 p-2 rounded text-xs ${result.validation.overallPass ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {result.validation.overallPass ? '配平通过' : '配平未通过'} |
          总价差额: {result.validation.totalDiff.toFixed(2)}元 |
          系数违规: {result.validation.coefficientViolationCount}条
        </div>
      )}

      {/* 第二级：清单配平 */}
      {result && (
        <div className="flex-1 overflow-auto p-4">
          <h3 className="text-xs font-semibold text-slate-700 mb-2">第二级：清单配平 ({result.level2.totalItems}条)</h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-1">分类</th>
                <th className="border border-slate-300 px-2 py-1">项目名称</th>
                <th className="border border-slate-300 px-2 py-1 text-right">工程量</th>
                <th className="border border-slate-300 px-2 py-1 text-right">原单价</th>
                <th className="border border-slate-300 px-2 py-1 text-right">目标单价</th>
                <th className="border border-slate-300 px-2 py-1 text-right">目标合价</th>
                <th className="border border-slate-300 px-2 py-1 text-right">系数</th>
                <th className="border border-slate-300 px-2 py-1">策略</th>
              </tr>
            </thead>
            <tbody>
              {result.level2.items.map((item, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="border border-slate-300 px-2 py-1">{item.category}</td>
                  <td className="border border-slate-300 px-2 py-1">{item.name}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.quantity.toLocaleString()}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{item.unitPrice.toFixed(2)}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono text-amber-700 font-semibold">{item.targetUnitPrice.toFixed(2)}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono text-amber-700 font-semibold">{item.targetTotalPrice.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-mono">{(item.priceRatio * 100).toFixed(1)}%</td>
                  <td className="border border-slate-300 px-2 py-1">{item.strategy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
