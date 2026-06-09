'use client';

import { useState, useCallback } from 'react';
import { useAppState, type BidItem, type ResourceSummaryItem } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

export function Step2Panel() {
  const { state, updateState, getSelectedFile } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'items' | 'resources'>('items');

  const step2Data = state.step2Data;
  const selectedFile = getSelectedFile(2);

  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) {
      setError('请先上传或选择Excel文件');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/step2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: selectedFile.base64 }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({ step2Data: data });
        // 自动设置maxPriceTotal
        if (data.summary?.合计 && !state.maxPriceTotal) {
          updateState({ maxPriceTotal: Math.ceil(data.summary.合计 * 1.07) });
        }
      } else {
        setError(data.error || '分析失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [selectedFile, updateState, state.maxPriceTotal]);

  const handleExport = useCallback(async () => {
    if (!step2Data) return;
    const itemRows = step2Data.bidItems.map((it) => [it.category, it.code, it.name, it.unit, it.quantity, it.unitPrice, it.totalPrice]);
    const resRows = step2Data.resourceSummary.map((r) => [r.code, r.name, r.unit, r.quantity, r.price, r.totalPrice]);
    const result = await exportToExcel(
      [
        { name: '分部分项清单', headers: ['分部', '编码', '名称', '单位', '工程量', '综合单价', '合价'], rows: itemRows },
        { name: '工料机汇总', headers: ['编码', '名称', '单位', '数量', '单价', '合价'], rows: resRows },
      ],
      '清单组价结果.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [step2Data]);

  const summary = step2Data?.summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤2：清单组价</h2>
        {step2Data && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出Excel
          </button>
        )}
      </div>

      {/* 文件选择 */}
      <FileSelector step={2} accept=".xlsx,.xls" />

      {/* 执行按钮 */}
      <button
        onClick={handleAnalyze}
        disabled={loading || !selectedFile}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '计算中...' : '读取清单并计算'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {/* 汇总信息 */}
      {summary && (
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(summary).map(([key, val]) => (
            <div key={key} className="border border-border rounded p-2 text-center">
              <div className="text-xs text-muted-foreground">{key}</div>
              <div className="text-sm font-mono font-medium">{fmt(val as number)}</div>
            </div>
          ))}
        </div>
      )}

      {/* 清单数据 */}
      {step2Data && (
        <div>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setTab('items')}
              className={`text-xs px-3 py-1 rounded ${tab === 'items' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              分部分项清单 ({step2Data.bidItems.length})
            </button>
            <button
              onClick={() => setTab('resources')}
              className={`text-xs px-3 py-1 rounded ${tab === 'resources' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              工料机汇总 ({step2Data.resourceSummary.length})
            </button>
          </div>

          {tab === 'items' ? (
            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-2 py-1.5 text-left">分部</th>
                    <th className="px-2 py-1.5 text-left">编码</th>
                    <th className="px-2 py-1.5 text-left">名称</th>
                    <th className="px-2 py-1.5 text-right">工程量</th>
                    <th className="px-2 py-1.5 text-right">综合单价</th>
                    <th className="px-2 py-1.5 text-right">合价</th>
                  </tr>
                </thead>
                <tbody>
                  {step2Data.bidItems.map((it, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1">{it.category}</td>
                      <td className="px-2 py-1 font-mono">{it.code}</td>
                      <td className="px-2 py-1">{it.name}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(it.quantity)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(it.unitPrice)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(it.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-2 py-1.5 text-left">编码</th>
                    <th className="px-2 py-1.5 text-left">名称</th>
                    <th className="px-2 py-1.5 text-left">单位</th>
                    <th className="px-2 py-1.5 text-right">数量</th>
                    <th className="px-2 py-1.5 text-right">单价</th>
                    <th className="px-2 py-1.5 text-right">合价</th>
                  </tr>
                </thead>
                <tbody>
                  {step2Data.resourceSummary.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">{r.code}</td>
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1">{r.unit}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(r.quantity)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(r.price)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(r.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 公式引擎统计 */}
          {step2Data.stats && (
            <div className="mt-2 text-xs text-muted-foreground">
              公式引擎：{step2Data.stats.totalFormulas}个公式，{step2Data.stats.calculated}个已计算，{step2Data.stats.errorCount}个错误
            </div>
          )}
        </div>
      )}
    </div>
  );
}
