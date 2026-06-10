'use client';

import { useState, useCallback } from 'react';
import { useAppState } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

export function Step6Panel() {
  const { state, updateState, getSelectedFile } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const step5Data = state.step5Data;
  const step6Data = state.step6Data;
  const selectedFile = getSelectedFile(6);

  const handleMaterialPricing = useCallback(async () => {
    if (!selectedFile) {
      setError('请先上传或选择Excel文件');
      return;
    }
    if (!step5Data?.level2?.items || step5Data.level2.items.length === 0) {
      setError('请先在步骤5中执行清单调价配平');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/step6', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table7FileBase64: selectedFile.base64,
          balancedItems: step5Data.level2.items,
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({ step6Data: data });
      } else {
        setError(data.error || '材料调价失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [selectedFile, step5Data, updateState]);

  const handleExport = useCallback(async () => {
    if (!step6Data?.level3?.priceChanges) return;
    const changes = step6Data.level3.priceChanges;
    const rows = changes.map((c) => [c.code, c.name, c.originalPrice, c.adjustedPrice, c.diff, ((c.diffPercent ?? 0) * 100).toFixed(1) + '%']);
    const result = await exportToExcel(
      [{ name: '材料调价', headers: ['编码', '名称', '原含税价', '调后含税价', '差额', '调整比例'], rows }],
      '材料调价配平结果.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [step6Data]);

  const validation = step6Data?.validation;
  const level3 = step6Data?.level3;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤6：材料调价配平</h2>
        {step6Data && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出Excel
          </button>
        )}
      </div>

      {/* 方法说明 */}
      <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded border border-border">
        <strong>反推逻辑：</strong>基于表2（综合单价分析表），根据步骤5每条清单的目标单价，保持人工和机械单价不变，反推每种材料的不含税单价。材料目标合价 = 目标合价 - 人工合价 - 机械合价，同一材料在多条清单中出现时取加权平均。
      </div>

      {/* 文件选择 */}
      <FileSelector step={6} accept=".xlsx,.xls" />

      {!step5Data?.level2?.items && (
        <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded">
          提示：请先在步骤5中执行清单调价配平以获取配平项目数据
        </div>
      )}

      <button
        onClick={handleMaterialPricing}
        disabled={loading || !selectedFile || !step5Data?.level2?.items}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '反推计算中...' : '执行材料调价配平'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {/* 验证结果 */}
      {validation && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">验证结果</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>收敛：<span className={validation.converged ? 'text-green-600 font-bold' : 'text-red-600'}>{validation.converged ? '是' : '否'}</span></div>
            <div>迭代次数：<span className="font-mono">{validation.iterations}</span></div>
            <div>目标总价：<span className="font-mono">{fmt(validation.targetTotal)}</span></div>
            <div>实际总价：<span className="font-mono">{fmt(validation.actualTotal)}</span></div>
            <div>差值：<span className="font-mono">{fmt(validation.diff)}</span>元</div>
            <div>校验：<span className={validation.pass ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{validation.pass ? '通过' : '未通过'}</span></div>
          </div>
        </div>
      )}

      {/* 清单调整明细 */}
      {level3?.itemDetails && level3.itemDetails.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">清单调整明细（{level3.itemDetails.length}项）</h3>
          <div className="overflow-x-auto border border-border rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-1.5 text-left">编码</th>
                  <th className="px-2 py-1.5 text-left">名称</th>
                  <th className="px-2 py-1.5 text-right">目标单价</th>
                  <th className="px-2 py-1.5 text-right">原合价</th>
                  <th className="px-2 py-1.5 text-right">目标合价</th>
                  <th className="px-2 py-1.5 text-right">差额</th>
                  <th className="px-2 py-1.5 text-right">材料原合价</th>
                  <th className="px-2 py-1.5 text-right">材料目标合价</th>
                </tr>
              </thead>
              <tbody>
                {level3.itemDetails.slice(0, 50).map((it, i) => (
                  <tr key={i} className={`border-t border-border ${it.diff > 0 ? 'bg-green-50/30' : it.diff < 0 ? 'bg-red-50/30' : ''}`}>
                    <td className="px-2 py-1 font-mono">{it.code}</td>
                    <td className="px-2 py-1">{it.name}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.targetUnitPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.currentTotalPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.targetTotalPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.diff)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.materialOriginalTotal)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.materialTargetTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {level3.itemDetails.length > 50 && (
              <div className="text-xs text-muted-foreground p-2 text-center">... 共{level3.itemDetails.length}项，仅显示前50项</div>
            )}
          </div>
        </div>
      )}

      {/* 材料价格调整 */}
      {level3?.priceChanges && (
        <div>
          <h3 className="text-sm font-medium mb-2">材料价格调整（{level3.priceChanges.length}项）</h3>
          <div className="text-xs mb-2 text-muted-foreground">
            基准总价：<span className="font-mono">{fmt(level3.baseTotal)}</span> | 方法：{level3.method}
          </div>
          <div className="overflow-x-auto border border-border rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-1.5 text-left">编码</th>
                  <th className="px-2 py-1.5 text-left">名称</th>
                  <th className="px-2 py-1.5 text-right">原含税价</th>
                  <th className="px-2 py-1.5 text-right">调后含税价</th>
                  <th className="px-2 py-1.5 text-right">差额</th>
                  <th className="px-2 py-1.5 text-right">比例</th>
                </tr>
              </thead>
              <tbody>
                {level3.priceChanges.map((pc, i) => (
                  <tr key={i} className={`border-t border-border ${pc.diff > 0 ? 'bg-green-50/30' : pc.diff < 0 ? 'bg-red-50/30' : ''}`}>
                    <td className="px-2 py-1 font-mono">{pc.code}</td>
                    <td className="px-2 py-1">{pc.name}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(pc.originalPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(pc.adjustedPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(pc.diff)}</td>
                    <td className="px-2 py-1 text-right font-mono">{((pc.diffPercent ?? 0) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
