'use client';

import { useState, useCallback } from 'react';
import { useAppState } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File, fmt } from '@/lib/export-utils';

function findAmount(source: Record<string, number>, labels: string[]): number {
  for (const label of labels) {
    if (source[label] != null) return source[label];
  }
  const found = Object.entries(source).find(([key]) => labels.some((label) => key.includes(label)));
  return found?.[1] || 0;
}

function buildStep2TotalRows(
  items: Array<{ category: string; totalPrice: number }>,
  summary: Record<string, number>,
) {
  const byCategory = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + (item.totalPrice || 0);
    return acc;
  }, {});
  const projectNames = Object.keys(byCategory);
  const sectionTotal = projectNames.reduce((sum, name) => sum + (byCategory[name] || 0), 0);
  const projectTotal = findAmount(summary, ['建设项目分部分项工程项目费']) || sectionTotal;

  const row = (code: string, name: string, amount: number | '') => [code, name, amount] as const;
  const projectRows = projectNames.map((name, index) => row(`1.1.${index + 1}`, name, byCategory[name] || findAmount(summary, [name])));

  return [
    row('1', '建设项目分部分项工程项目费', projectTotal),
    row('1.1', '单项工程', projectTotal),
    ...projectRows,
    row('', '', ''),
    row('2', '措施项目费', findAmount(summary, ['措施项目费'])),
    row('2.1', '其中：安全文明施工费', findAmount(summary, ['其中：安全文明施工费', '安全文明施工费'])),
    row('2.2', '其他措施项目费', findAmount(summary, ['其他措施项目费'])),
    row('', '', ''),
    row('3', '其他项目费', findAmount(summary, ['其他项目费'])),
    row('3.1', '暂列金额', findAmount(summary, ['暂列金额'])),
    row('3.2', '专业工程暂估价（含税）', findAmount(summary, ['专业工程暂估价（含税）', '专业工程暂估价'])),
    row('3.3', '计日工', findAmount(summary, ['计日工'])),
    row('3.4', '总承包服务费', findAmount(summary, ['总承包服务费'])),
    row('', '', ''),
    row('4', '增值税', findAmount(summary, ['增值税'])),
    row('合计=1+2+3+4', '合计=1+2+3+4', findAmount(summary, ['合计=1+2+3+4', '合计'])),
  ];
}

export function Step2Panel() {
  const { state, updateState, getSelectedFile } = useAppState();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
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
    if (!selectedFile) {
      setError('请先上传或选择Excel文件');
      return;
    }

    setExporting(true);
    setError('');
    try {
      const res = await fetch('/api/step2/formula-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: selectedFile.base64 }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || '导出公式版失败');
        return;
      }
      downloadBase64File(data.fileBase64, data.fileName || '公式版清单组价表.xlsx');
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出公式版失败');
    } finally {
      setExporting(false);
    }
  }, [selectedFile]);

  const summary = step2Data?.summary;
  const totalRows = step2Data && summary ? buildStep2TotalRows(step2Data.bidItems, summary) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤2：清单组价</h2>
        {selectedFile && (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {exporting ? '导出中...' : '导出公式版'}
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

      {/* 总价汇总 */}
      {summary && (
        <div className="border border-border rounded overflow-hidden">
          <div className="px-3 py-2 bg-muted/40 text-sm font-medium">清单组价总价</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-1.5 text-left">序号</th>
                  <th className="px-2 py-1.5 text-left">汇总内容</th>
                  <th className="px-2 py-1.5 text-right">清单组价金额</th>
                </tr>
              </thead>
              <tbody>
                {totalRows.map((row, index) => (
                  <tr key={index} className="border-t border-border">
                    <td className="px-2 py-1">{row[0]}</td>
                    <td className="px-2 py-1">{row[1]}</td>
                    <td className="px-2 py-1 text-right font-mono">{typeof row[2] === 'number' && row[2] > 0 ? fmt(row[2]) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                    <th className="px-2 py-1.5 text-right">含税市场价</th>
                    <th className="px-2 py-1.5 text-right">税率</th>
                    <th className="px-2 py-1.5 text-right">不含税单价</th>
                    <th className="px-2 py-1.5 text-right">不含税合价</th>
                  </tr>
                </thead>
                <tbody>
                  {step2Data.resourceSummary.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">{r.code}</td>
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1">{r.unit}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(r.quantity)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(r.taxInclusivePrice)}</td>
                      <td className="px-2 py-1 text-right font-mono">{r.taxRate.toFixed(2)}%</td>
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
