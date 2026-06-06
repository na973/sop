'use client';

import { useState, useRef } from 'react';

interface PriceChange {
  code: string;
  name: string;
  originalPrice: number;
  adjustedPrice: number;
  diff: number;
}

interface Step6Result {
  success: boolean;
  level3: { adjustableResourceCount: number; priceChanges: PriceChange[]; iterationLog: Array<{ iteration: number; totalDiff: number; adjustedCount: number }> };
  validation: { targetTotal: number; actualTotal: number; diff: number; pass: boolean; iterations: number; converged: boolean; formulaErrors: number };
  finalSummary: Array<{ key: string; content: string; amount: number }> | null;
}

export default function Step6Panel() {
  const [result, setResult] = useState<Step6Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxIterations, setMaxIterations] = useState(100);
  const [tolerance, setTolerance] = useState(1.0);
  const [step5Result, setStep5Result] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('请选择表7文件');
      if (!step5Result) throw new Error('请粘贴步骤5的配平结果JSON');

      const b64 = await fileToBase64(file);
      const balancedItems = JSON.parse(step5Result);

      const res = await fetch('/api/step6', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table7FileBase64: b64,
          balancedItems,
          maxIterations,
          tolerance,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '材料调价计算失败');
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
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤6：材料调价配平</h2>
        <label className="text-xs text-slate-600">表7文件:</label>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="text-xs text-slate-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-amber-50 file:text-amber-700" />
        <label className="text-xs text-slate-600">最大迭代:</label>
        <input type="number" value={maxIterations} onChange={(e) => setMaxIterations(Number(e.target.value))} className="w-16 px-2 py-1 text-xs border rounded font-mono" />
        <label className="text-xs text-slate-600">容差(元):</label>
        <input type="number" value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} step="0.01" className="w-20 px-2 py-1 text-xs border rounded font-mono" />
        <button onClick={handleCalculate} disabled={loading} className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50">
          {loading ? '调价中...' : '材料调价'}
        </button>
      </div>

      {/* 步骤5结果输入 */}
      <div className="mx-4 mt-2">
        <label className="text-xs text-slate-600 block mb-1">粘贴步骤5配平结果 (balancedItems JSON):</label>
        <textarea
          value={step5Result}
          onChange={(e) => setStep5Result(e.target.value)}
          rows={3}
          className="w-full px-2 py-1 text-xs border rounded font-mono"
          placeholder='[{"row":2,"category":"道路工程","code":"041001004001","name":"铣刨路面",...}]'
        />
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 校验结果 */}
      {result && (
        <div className={`mx-4 mt-2 p-2 rounded text-xs ${result.validation.pass ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {result.validation.pass ? '配平通过' : '配平未通过'} |
          目标: {result.validation.targetTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} |
          实际: {result.validation.actualTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} |
          差额: {result.validation.diff.toFixed(2)}元 |
          迭代: {result.validation.iterations}次 |
          {result.validation.converged ? '已收敛' : '未收敛'}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {/* 调价明细 */}
        {result && (
          <>
            <h3 className="text-xs font-semibold text-slate-700 mb-2">材料调价明细 (共{result.level3.adjustableResourceCount}种可调资源，{result.level3.priceChanges.length}种已调整)</h3>
            <table className="w-full text-xs border-collapse mb-4">
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
                {result.level3.priceChanges.map((pc, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="border border-slate-300 px-2 py-1 font-mono">{pc.code}</td>
                    <td className="border border-slate-300 px-2 py-1">{pc.name}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{pc.originalPrice.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono text-amber-700 font-semibold">{pc.adjustedPrice.toFixed(2)}</td>
                    <td className={`border border-slate-300 px-2 py-1 text-right font-mono ${pc.diff > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{pc.diff > 0 ? '+' : ''}{pc.diff.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{((pc.diff / pc.originalPrice) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 迭代日志 */}
            <h3 className="text-xs font-semibold text-slate-700 mb-2">迭代日志 (最近{result.level3.iterationLog.length}次)</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1">迭代</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">差额(元)</th>
                  <th className="border border-slate-300 px-2 py-1 text-right">调整项数</th>
                </tr>
              </thead>
              <tbody>
                {result.level3.iterationLog.map((log, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="border border-slate-300 px-2 py-1">{log.iteration}</td>
                    <td className={`border border-slate-300 px-2 py-1 text-right font-mono ${Math.abs(log.totalDiff) < 1 ? 'text-emerald-600' : 'text-red-600'}`}>{log.totalDiff.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{log.adjustedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {!result && !loading && (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            上传表7文件 + 粘贴步骤5配平结果，点击"材料调价"
          </div>
        )}
      </div>
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
