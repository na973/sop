'use client';

import { useState, useCallback } from 'react';
import { useAppState } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

export function Step1Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [textInput, setTextInput] = useState('');

  const step1Data = state.step1Data;

  const handleExtract = useCallback(async () => {
    const selectedFile = state.fileLibrary.find(
      (f) => f.id === state.selectedFileIds[1],
    );

    if (!textInput && !selectedFile) {
      setError('请上传招标文件或直接输入文本内容');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let content = textInput;

      // 如果选择了PDF文件，先解析PDF
      if (selectedFile?.type === 'pdf') {
        const parseRes = await fetch('/api/step1/parse-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileBase64: selectedFile.base64 }),
        });
        const parseData = await parseRes.json();
        if (!parseData.success) {
          setError(parseData.error || 'PDF解析失败');
          setLoading(false);
          return;
        }
        content = parseData.text || '';
        if (!content.trim()) {
          setError('PDF解析结果为空，请直接输入文本内容');
          setLoading(false);
          return;
        }
      } else if (selectedFile?.type === 'text') {
        const bytes = Uint8Array.from(atob(selectedFile.base64), (char) => char.charCodeAt(0));
        content = new TextDecoder('utf-8').decode(bytes);
      }

      // AI提取
      const res = await fetch('/api/step1/extract-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || `请求失败 (${res.status})`);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError('无法读取流式响应');
        setLoading(false);
        return;
      }

      let fullText = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // SSE format: data: {...}
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullText += data.content;
              }
            } catch {
              // skip non-JSON lines
            }
          }
        }
      }

      // 尝试解析JSON
      try {
        // 从返回文本中提取JSON
        const jsonMatch = fullText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const items = JSON.parse(jsonMatch[0]);
          const categories = [
            '项目基本信息',
            '投标保证金',
            '投标有效期',
            '报价要求',
            '价格调整',
            '支付条款',
            '工期要求',
            '其他商务条款',
          ];
          const structuredItems = categories.map((cat, idx) => {
            const catItems = items.filter((it: Record<string, string>) => it.category === cat);
            if (catItems.length === 0) return { category: cat, items: [{ label: '未提取到', value: '' }] };
            return {
              category: cat,
              items: catItems.map((it: Record<string, string>) => ({
                label: it.label || it.item || '',
                value: it.value || it.content || '',
              })),
            };
          });
          updateState({ step1Data: { items: structuredItems } });
        } else {
          setError('AI返回格式无法解析，请重试');
        }
      } catch {
        setError('AI返回结果解析失败，请重试');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [textInput, state.fileLibrary, state.selectedFileIds, updateState]);

  const handleExport = useCallback(async () => {
    if (!step1Data) return;
    const sheets = step1Data.items.map((cat) => ({
      name: cat.category.slice(0, 31),
      headers: ['条款', '内容'],
      rows: cat.items.map((it) => [it.label, it.value]),
    }));
    const result = await exportToExcel(sheets, '招标文件分析结果.xlsx');
    downloadBase64File(result.base64, result.fileName);
  }, [step1Data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤1：分析招标文件</h2>
        {step1Data && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出Excel
          </button>
        )}
      </div>

      {/* PDF文件上传 */}
      <div>
        <label className="text-sm font-medium text-muted-foreground">上传招标文件(PDF)</label>
        <FileSelector step={1} accept=".pdf,.txt" onFileSelected={() => setTextInput('')} />
      </div>

      {/* 文本输入 */}
      <div>
        <label className="text-sm font-medium text-muted-foreground">或直接输入招标文件文本内容</label>
        <textarea
          className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground resize-y"
          rows={6}
          placeholder="将招标文件的商务条款文本粘贴到此处..."
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
        />
      </div>

      {/* 执行按钮 */}
      <button
        onClick={handleExtract}
        disabled={loading}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? 'AI提取中...' : 'AI提取商务条款'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {/* 结果展示 */}
      {step1Data && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">提取结果</h3>
          {step1Data.items.map((cat, idx) => (
            <div key={idx} className="border border-border rounded">
              <div className="bg-muted/50 px-3 py-1.5 text-sm font-medium">{cat.category}</div>
              <table className="w-full text-xs">
                <tbody>
                  {cat.items.map((item, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-1.5 text-muted-foreground w-32">{item.label}</td>
                      <td className="px-3 py-1.5">{item.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
