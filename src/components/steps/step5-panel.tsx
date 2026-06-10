'use client';

import { useState, useCallback } from 'react';
import { useAppState, type BalancedItem } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

export function Step5Panel() {
  const { state, updateState, getSelectedFile } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [localMaxPrice, setLocalMaxPrice] = useState(state.maxPriceTotal || 38000000);
  const [localDiscountRate, setLocalDiscountRate] = useState(state.targetDiscountRate <= 1 ? state.targetDiscountRate * 100 : state.targetDiscountRate || 5);

  const step5Data = state.step5Data;
  const selectedFile = getSelectedFile(5);

  const handleBalance = useCallback(async () => {
    if (!selectedFile) {
      setError('请先上传或选择Excel文件');
      return;
    }
    if (!localMaxPrice || localMaxPrice <= 0) {
      setError('请输入最高投标限价合计');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/step5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table7FileBase64: selectedFile.base64,
          compareItems: state.step3Data || undefined,
          maxPriceTotal: localMaxPrice,
          targetDiscountRate: localDiscountRate / 100,
          strategyRules: state.step4Data?.map((item) => ({ row: item.row, category: item.category, strategy: item.strategyLevel })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({
          step5Data: data,
          maxPriceTotal: localMaxPrice,
          targetDiscountRate: localDiscountRate / 100,
        });
      } else {
        setError(data.error || '配平失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [selectedFile, localMaxPrice, localDiscountRate, state.step3Data, state.step4Data, updateState]);

  const handleExport = useCallback(async () => {
    if (!step5Data?.level2?.items) return;
    const items = step5Data.level2.items;
    const rows = items.map((it: BalancedItem) => [
      it.category, it.code, it.name, '',
      it.quantity, it.unitPrice, it.totalPrice,
      it.maxUnitPrice, it.strategy,
      it.priceRatio?.toFixed(4) ?? '',
      (it.averageDiscountRate ?? 0).toFixed(2) + '%',
      (it.weightRatio ?? 0).toFixed(4),
      it.targetUnitPrice?.toFixed(2) ?? '', it.targetTotalPrice?.toFixed(2) ?? '',
    ]);
    const result = await exportToExcel(
      [{ name: '清单配平', headers: ['分部', '编码', '名称', '单位', '工程量', '原综合单价', '原合价', '限价单价', '策略', '价格系数', '平均下浮率', '权重占比', '目标单价', '目标合价'], rows }],
      '清单调价配平结果.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [step5Data]);

  const level1 = step5Data?.level1;
  const level2 = step5Data?.level2;
  const validation = step5Data?.validation;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤5：清单调价配平</h2>
        {step5Data && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出Excel
          </button>
        )}
      </div>

      {/* 文件选择 */}
      <FileSelector step={5} accept=".xlsx,.xls" />

      {/* 参数输入 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-muted-foreground">最高投标限价合计（元）</label>
          <input
            type="number"
            className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground font-mono"
            value={localMaxPrice || ''}
            onChange={(e) => setLocalMaxPrice(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">下浮率（%）</label>
          <input
            type="number"
            step="0.1"
            className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground font-mono"
            value={localDiscountRate || ''}
            onChange={(e) => setLocalDiscountRate(Number(e.target.value))}
          />
        </div>
      </div>

      {/* 费用说明 */}
      <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded border border-border">
        <strong>总价构成说明：</strong>目标总价 = 限价合计 × (1 - 总下浮率)，该总价包含分部分项清单合价 + 安全文明施工费 + 暂列金额等费用。清单配平后，各清单目标合价之和应等于目标总价。平均下浮率 = 1 - 目标单价/限价单价，反映每条清单相对限价的下浮幅度。
      </div>

      <button
        onClick={handleBalance}
        disabled={loading || !selectedFile}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '配平计算中...' : '执行清单调价配平'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {/* 第一级配平结果 */}
      {level1 && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">第一级：总价配平</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>限价合计：<span className="font-mono">{fmt(level1.maxPriceTotal)}</span></div>
            <div>目标总价：<span className="font-mono">{fmt(level1.targetTotal)}</span></div>
            <div>下浮额：<span className="font-mono">{fmt(level1.totalDiscount)}</span></div>
            <div>下浮率：<span className="font-mono">{(level1.discountRate * 100).toFixed(1)}%</span></div>
            <div>校验：<span className={level1.pass ? 'text-green-600' : 'text-red-600'}>{level1.pass ? '通过' : '未通过'}</span></div>
          </div>
        </div>
      )}

      {/* 校验结果 */}
      {validation && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">约束校验</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>总价差额：<span className="font-mono">{fmt(validation.totalDiff)}</span>元</div>
            <div>差额率：<span className="font-mono">{(validation.totalDiffRate * 100).toFixed(4)}%</span></div>
            <div>系数违规项：<span className={`font-mono ${validation.coefficientViolationCount > 0 ? 'text-destructive' : 'text-green-600'}`}>{validation.coefficientViolationCount}</span></div>
            <div>整体校验：<span className={validation.overallPass ? 'text-green-600 font-bold' : 'text-destructive font-bold'}>{validation.overallPass ? '通过' : '未通过'}</span></div>
          </div>
          {!validation.coefficientPass && (
            <div className="text-xs text-destructive mt-1">提示：有清单系数超出0.455~0.845范围（评标规则约束），请调整下浮率或策略分配</div>
          )}
        </div>
      )}

      {/* 第二级配平结果 */}
      {level2 && (
        <div>
          <h3 className="text-sm font-medium mb-2">第二级：清单配平（{level2.totalItems}项）</h3>
          <div className="text-xs mb-2 text-muted-foreground">
            目标总价：<span className="font-mono">{fmt(level2.targetTotal)}</span> |
            实际总价：<span className="font-mono">{fmt(level2.actualTotal)}</span>
          </div>
          <div className="overflow-x-auto border border-border rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-1.5 text-left">分部</th>
                  <th className="px-2 py-1.5 text-left">编码</th>
                  <th className="px-2 py-1.5 text-left">名称</th>
                  <th className="px-2 py-1.5 text-right">原单价</th>
                  <th className="px-2 py-1.5 text-right">限价</th>
                  <th className="px-2 py-1.5 text-center">策略</th>
                  <th className="px-2 py-1.5 text-right">目标单价</th>
                  <th className="px-2 py-1.5 text-right">目标合价</th>
                  <th className="px-2 py-1.5 text-right">平均下浮率</th>
                  <th className="px-2 py-1.5 text-right">权重</th>
                </tr>
              </thead>
              <tbody>
                {level2.items.slice(0, 50).map((it: BalancedItem, i: number) => (
                  <tr key={i} className={`border-t border-border ${it.averageDiscountRate !== undefined && (it.averageDiscountRate > 0.545 || it.averageDiscountRate < 0.155) ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-2 py-1">{it.category}</td>
                    <td className="px-2 py-1 font-mono">{it.code}</td>
                    <td className="px-2 py-1">{it.name}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.unitPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.maxUnitPrice)}</td>
                    <td className="px-2 py-1 text-center">{it.strategy}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.targetUnitPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.targetTotalPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{((it.averageDiscountRate ?? 0) * 100).toFixed(1)}%</td>
                    <td className="px-2 py-1 text-right font-mono">{((it.weightRatio ?? 0) * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {level2.items.length > 50 && (
              <div className="text-xs text-muted-foreground p-2 text-center">... 共{level2.items.length}项，仅显示前50项</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
