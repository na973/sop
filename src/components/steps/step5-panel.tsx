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
  const [localDiscountRate, setLocalDiscountRate] = useState(state.targetDiscountRate || 5);

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
          maxPriceTotal: localMaxPrice,
          targetDiscountRate: localDiscountRate / 100,
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({
          step5Data: data,
          maxPriceTotal: localMaxPrice,
          targetDiscountRate: localDiscountRate,
        });
      } else {
        setError(data.error || '配平失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [selectedFile, localMaxPrice, localDiscountRate, updateState]);

  const handleExport = useCallback(async () => {
    if (!step5Data?.level2?.items) return;
    const items = step5Data.level2.items;
    const rows = items.map((it: BalancedItem) => [
      it.category, it.code, it.name, '',
      it.quantity, it.unitPrice, it.totalPrice,
      it.maxUnitPrice, it.strategy,
      it.priceRatio?.toFixed(4) ?? '', it.targetUnitPrice?.toFixed(2) ?? '', it.targetTotalPrice?.toFixed(2) ?? '',
    ]);
    const result = await exportToExcel(
      [{ name: '清单配平', headers: ['分部', '编码', '名称', '单位', '工程量', '原综合单价', '原合价', '限价单价', '策略', '价格系数', '目标单价', '目标合价'], rows }],
      '清单调价配平结果.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [step5Data]);

  const level1 = step5Data?.level1;
  const level2 = step5Data?.level2;

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
                </tr>
              </thead>
              <tbody>
                {level2.items.slice(0, 50).map((it: BalancedItem, i: number) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1">{it.category}</td>
                    <td className="px-2 py-1 font-mono">{it.code}</td>
                    <td className="px-2 py-1">{it.name}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.unitPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.maxUnitPrice)}</td>
                    <td className="px-2 py-1 text-center">{it.strategy}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.targetUnitPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.targetTotalPrice)}</td>
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
