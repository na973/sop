'use client';

import { useState, useCallback } from 'react';
import { useAppState } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File } from '@/lib/export-utils';

export function Step7Panel() {
  const { state, updateState, getSelectedFile } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const step5Data = state.step5Data;
  const step6Data = state.step6Data;
  const selectedFile = getSelectedFile(7);

  const handleExport = useCallback(async () => {
    if (!selectedFile) {
      setError('请先上传或选择Excel文件');
      return;
    }
    if (!step5Data?.level2?.items || step5Data.level2.items.length === 0) {
      setError('请先在步骤5中执行清单调价配平');
      return;
    }
    if (!step6Data?.level3?.priceChanges?.length) {
      setError('请先在步骤6中执行材料调价配平，生成priceChanges');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      const priceChanges = step6Data.level3.priceChanges;
      const res = await fetch('/api/step7', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table7FileBase64: selectedFile.base64,
          balancedItems: step5Data.level2.items,
          priceChanges,
        }),
      });
      const data = await res.json();
      if (data.success && data.fileBase64) {
        downloadBase64File(data.fileBase64, data.fileName || '调价导出结果.xlsx');
        updateState({ step7FileBase64: data.fileBase64, step7FileName: data.fileName || '调价导出结果.xlsx' });
        setSuccess(true);
      } else {
        setError(data.error || '导出失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [selectedFile, step5Data, step6Data, updateState]);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">步骤7：调价导出</h2>

      {/* 文件选择 */}
      <FileSelector step={7} accept=".xlsx,.xls" />

      {!step5Data?.level2?.items && (
        <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded">
          提示：请先在步骤5中执行清单调价配平以获取调价数据
        </div>
      )}

      <div className="border border-border rounded p-4 space-y-3">
        <h3 className="text-sm font-medium">导出说明</h3>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          <li>将步骤5的清单配平结果和步骤6的材料调价结果写回Excel</li>
          <li>修改工料机汇总表F列价格 → 公式引擎重算所有Sheet</li>
          <li>生成新的Excel文件供下载</li>
        </ul>
      </div>

      <button
        onClick={handleExport}
        disabled={loading || !selectedFile || !step5Data?.level2?.items || !step6Data?.level3?.priceChanges?.length}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '生成Excel中...' : '导出调价后Excel文件'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}
      {success && <div className="text-xs text-green-600 p-2 bg-green-50 rounded">文件已成功导出并下载</div>}
    </div>
  );
}
