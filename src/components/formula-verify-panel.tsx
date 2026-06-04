'use client';

import { useState } from 'react';

interface VerifyResult {
  success: boolean;
  calculationTime: string;
  stats: {
    totalFormulas: number;
    calculated: number;
    errorCount: number;
    firstErrors: Array<{ sheet: string; cell: string; error: string }>;
  };
  comparison: {
    total: number;
    matched: number;
    matchRate: string;
    mismatchCount: number;
    topMismatches: Array<{
      sheet: string;
      cell: string;
      engineValue: number | string;
      excelValue: number | string;
      diff: number;
    }>;
  };
  keyValues: {
    engineTotal: number | string | null;
    excelTotal: number | string | null;
    expectedTotal: number;
    diff: string;
  };
  error?: string;
}

export default function FormulaVerifyPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const handleVerify = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/formula-verify');
      const data = await res.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        calculationTime: '',
        stats: { totalFormulas: 0, calculated: 0, errorCount: 0, firstErrors: [] },
        comparison: { total: 0, matched: 0, matchRate: '0%', mismatchCount: 0, topMismatches: [] },
        keyValues: { engineTotal: null, excelTotal: null, expectedTotal: 8902813.81, diff: 'N/A' },
        error: String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h2 className="text-lg font-semibold text-slate-800">公式引擎验证</h2>
        <p className="text-sm text-slate-500 mt-2">
          使用表7（公式版清单组价表）数据验证公式引擎的计算正确性。
          目标：计算汇总表合计值与Excel原始结果 8,902,813.81 元的误差在0.01元以内。
        </p>
        <button
          onClick={handleVerify}
          disabled={loading}
          className="mt-4 px-5 py-2 bg-amber-500 text-white text-sm font-medium rounded-md hover:bg-amber-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '验证中...' : '开始验证'}
        </button>
      </div>

      {result && (
        <>
          {/* 核心指标 */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">计算时间</div>
              <div className="text-xl font-semibold font-data text-slate-800 mt-1">
                {result.calculationTime}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">公式总数</div>
              <div className="text-xl font-semibold font-data text-slate-800 mt-1">
                {result.stats.totalFormulas}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">匹配率</div>
              <div
                className={`text-xl font-semibold font-data mt-1 ${
                  parseFloat(result.comparison.matchRate) > 90
                    ? 'text-emerald-600'
                    : 'text-amber-600'
                }`}
              >
                {result.comparison.matchRate}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">误差（元）</div>
              <div
                className={`text-xl font-semibold font-data mt-1 ${
                  result.keyValues.diff !== 'N/A' && parseFloat(result.keyValues.diff) < 1
                    ? 'text-emerald-600'
                    : 'text-rose-500'
                }`}
              >
                {result.keyValues.diff}
              </div>
            </div>
          </div>

          {/* 关键值对比 */}
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-medium text-slate-700 mb-3">汇总表合计值对比</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-slate-500">引擎计算</div>
                <div className="font-data text-lg font-semibold text-slate-800">
                  {typeof result.keyValues.engineTotal === 'number'
                    ? result.keyValues.engineTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })
                    : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Excel基准</div>
                <div className="font-data text-lg font-semibold text-slate-800">
                  {typeof result.keyValues.excelTotal === 'number'
                    ? result.keyValues.excelTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })
                    : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">差额</div>
                <div className={`font-data text-lg font-semibold ${
                  result.keyValues.diff !== 'N/A' && parseFloat(result.keyValues.diff) < 1
                    ? 'text-emerald-600'
                    : 'text-rose-500'
                }`}>
                  {result.keyValues.diff !== 'N/A'
                    ? `¥${parseFloat(result.keyValues.diff).toFixed(2)}`
                    : 'N/A'}
                </div>
              </div>
            </div>
          </div>

          {/* 错误列表 */}
          {result.stats.firstErrors.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-3">
                计算错误（{result.stats.errorCount} 个）
              </h3>
              <div className="max-h-48 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-3 py-2 text-slate-600">Sheet</th>
                      <th className="px-3 py-2 text-slate-600">单元格</th>
                      <th className="px-3 py-2 text-slate-600">错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.stats.firstErrors.map((err, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-600">{err.sheet}</td>
                        <td className="px-3 py-1.5 font-data text-slate-800">{err.cell}</td>
                        <td className="px-3 py-1.5 text-rose-500">{err.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 不匹配项 */}
          {result.comparison.topMismatches.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-3">
                不匹配项（{result.comparison.mismatchCount} 个，展示前20条）
              </h3>
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-3 py-2 text-slate-600">Sheet</th>
                      <th className="px-3 py-2 text-slate-600">单元格</th>
                      <th className="px-3 py-2 text-slate-600">引擎值</th>
                      <th className="px-3 py-2 text-slate-600">Excel值</th>
                      <th className="px-3 py-2 text-slate-600">差额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.comparison.topMismatches.map((m, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-600">{m.sheet}</td>
                        <td className="px-3 py-1.5 font-data text-slate-800">{m.cell}</td>
                        <td className="px-3 py-1.5 font-data">{String(m.engineValue)}</td>
                        <td className="px-3 py-1.5 font-data">{String(m.excelValue)}</td>
                        <td className="px-3 py-1.5 font-data text-amber-600">
                          {typeof m.diff === 'number' ? m.diff.toFixed(4) : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 原始错误 */}
          {result.error && (
            <div className="bg-rose-50 rounded-lg border border-rose-200 p-5">
              <h3 className="text-sm font-medium text-rose-700 mb-2">错误</h3>
              <pre className="text-xs text-rose-600 whitespace-pre-wrap">{result.error}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
