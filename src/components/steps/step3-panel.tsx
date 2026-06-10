'use client';

import { useState, useCallback } from 'react';
import { useAppState, type PriceCompareItem } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

const DEVIATION_COLORS: Record<string, string> = {
  '明显偏高': 'text-red-600 bg-red-50',
  '偏高': 'text-orange-600 bg-orange-50',
  '基本接近': 'text-green-600 bg-green-50',
  '偏低': 'text-blue-600 bg-blue-50',
  '明显偏低': 'text-purple-600 bg-purple-50',
};

export function Step3Panel() {
  const { state, updateState, getSelectedFile } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [localMaxPrice, setLocalMaxPrice] = useState(state.maxPriceTotal || 38000000);

  const step3Data = state.step3Data;
  const pricingFile = getSelectedFile(3);
  const limitBillFile = getSelectedFile(31);
  const limitPdfFile = getSelectedFile(32);

  const handleCompare = useCallback(async () => {
    const bidItems = state.step2Data?.bidItems;
    if (!bidItems?.length && !pricingFile) {
      setError('请先完成步骤2，或上传我方清单组价表');
      return;
    }
    if (!limitBillFile && !limitPdfFile && (!localMaxPrice || localMaxPrice <= 0)) {
      setError('请上传最高限价PDF/表3，或手动输入最高投标限价合计');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/step3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidItems,
          table7FileBase64: bidItems?.length ? undefined : pricingFile?.base64,
          limitBillFileBase64: limitBillFile?.base64,
          limitPdfBase64: limitPdfFile?.base64,
          maxPriceTotal: localMaxPrice || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({
          step3Data: data.compareItems || data.items,
          maxPriceTotal: data.maxPriceTotal || localMaxPrice,
        });
      } else {
        setError(data.error || '对比失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [state.step2Data?.bidItems, pricingFile, limitBillFile, limitPdfFile, localMaxPrice, updateState]);

  const handleExport = useCallback(async () => {
    if (!step3Data) return;
    const rows = step3Data.map((it) => [
      it.category, it.code, it.name, it.unit,
      it.quantity, it.ourUnitPrice, it.ourTotalPrice,
      it.maxUnitPrice, it.maxTotalPrice,
      it.deviationRate, it.deviationLevel,
      it.itemReviewPrice ?? it.maxTotalPrice,
      it.isScreeningItem ? '是' : '否',
      it.screeningRank ?? '',
      it.isAbnormalBidItem ? '是' : '否',
      it.screeningBasis ?? '',
    ]);
    const result = await exportToExcel(
      [{ name: '限价对比', headers: ['分部', '编码', '名称', '单位', '工程量', '我方单价', '我方合价', '限价单价', '限价合价', '偏差率', '偏差等级', '子目评审价', '甄别项', '甄别排名', '异常报价项', '甄别依据'], rows }],
      '限价对比结果.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [step3Data]);

  const counts = step3Data ? {
    total: step3Data.length,
    screening: step3Data.filter((i) => i.isScreeningItem).length,
    high: step3Data.filter((i) => i.deviationLevel.includes('偏高')).length,
    low: step3Data.filter((i) => i.deviationLevel.includes('偏低')).length,
  } : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤3：限价对比</h2>
        {step3Data && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出Excel
          </button>
        )}
      </div>

      {/* 文件选择 */}
      <div className="space-y-3">
        {!state.step2Data?.bidItems?.length && (
          <div>
            <label className="text-sm font-medium text-muted-foreground">我方清单组价表（表2/表7）</label>
            <FileSelector step={3} accept=".xlsx,.xls" />
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-muted-foreground">表3 分部分项工程量清单计价表（可选，提供清单结构）</label>
          <FileSelector step={31} accept=".xlsx,.xls" />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">最高投标限价 PDF（可选，优先读取真实综合单价）</label>
          <FileSelector step={32} accept=".pdf" />
        </div>
      </div>

      {/* 限价输入 */}
      <div>
        <label className="text-sm font-medium text-muted-foreground">最高投标限价合计（元）</label>
        <input
          type="number"
          className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground font-mono"
          value={localMaxPrice || ''}
          onChange={(e) => setLocalMaxPrice(Number(e.target.value))}
          placeholder="如：38000000"
        />
      </div>

      {/* 执行按钮 */}
      <button
        onClick={handleCompare}
        disabled={loading || (!state.step2Data?.bidItems?.length && !pricingFile)}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '对比计算中...' : '执行限价对比'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {/* 统计 */}
      {counts && (
        <div className="grid grid-cols-4 gap-2">
          <div className="border border-border rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">总项数</div>
            <div className="text-sm font-mono font-medium">{counts.total}</div>
          </div>
          <div className="border border-border rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">甄别项</div>
            <div className="text-sm font-mono font-medium text-destructive">{counts.screening}</div>
          </div>
          <div className="border border-border rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">偏高</div>
            <div className="text-sm font-mono font-medium text-orange-600">{counts.high}</div>
          </div>
          <div className="border border-border rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">偏低</div>
            <div className="text-sm font-mono font-medium text-blue-600">{counts.low}</div>
          </div>
        </div>
      )}

      {/* 对比结果表格 */}
      {step3Data && (
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-2 py-1.5 text-left">分部</th>
                <th className="px-2 py-1.5 text-left">编码</th>
                <th className="px-2 py-1.5 text-left">名称</th>
                <th className="px-2 py-1.5 text-right">工程量</th>
                <th className="px-2 py-1.5 text-right">我方单价</th>
                <th className="px-2 py-1.5 text-right">限价单价</th>
                <th className="px-2 py-1.5 text-center">来源</th>
                <th className="px-2 py-1.5 text-right">子目评审价</th>
                <th className="px-2 py-1.5 text-right">偏差率</th>
                <th className="px-2 py-1.5 text-center">偏差等级</th>
                <th className="px-2 py-1.5 text-center">甄别</th>
                <th className="px-2 py-1.5 text-center">异常</th>
              </tr>
            </thead>
            <tbody>
              {step3Data.map((it, i) => (
                <tr key={i} className={`border-t border-border ${it.isScreeningItem ? 'bg-red-50/50' : ''}`}>
                  <td className="px-2 py-1">{it.category}</td>
                  <td className="px-2 py-1 font-mono">{it.code}</td>
                  <td className="px-2 py-1">{it.name}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.quantity)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.ourUnitPrice)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.maxUnitPrice)}</td>
                  <td className="px-2 py-1 text-center">{it.limitPriceSource || '-'}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.itemReviewPrice ?? it.maxTotalPrice)}</td>
                  <td className="px-2 py-1 text-right font-mono">{(it.deviationRate * 100).toFixed(1)}%</td>
                  <td className="px-2 py-1 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${DEVIATION_COLORS[it.deviationLevel] || ''}`}>
                      {it.deviationLevel}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    {it.isScreeningItem ? `是${it.screeningRank ? `(${it.screeningRank})` : ''}` : '否'}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {it.isAbnormalBidItem ? <span className="text-destructive font-bold">是</span> : '否'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
