'use client';

import { useState, useRef } from 'react';
import { useAppState } from '@/lib/app-state';

interface ExtractedItem {
  category: string;
  content: string;
  requirement: string;
  impact: string;
}

export default function Step1Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PDF上传解析
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('请上传PDF文件');
      return;
    }

    setPdfLoading(true);
    setError(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      const res = await fetch('/api/step1/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: base64 }),
      });

      const data = await res.json() as { success: boolean; text?: string; error?: string; pages?: number };
      if (!data.success) throw new Error(data.error || 'PDF解析失败');

      setContent(data.text || '');
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExtract = async (streaming: boolean = true) => {
    if (!content.trim()) {
      setError('请输入招标文件内容或上传PDF文件');
      return;
    }

    setLoading(true);
    setError(null);
    setItems([]);

    try {
      if (streaming) {
        const res = await fetch('/api/step1/extract-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data) as { items?: ExtractedItem[] };
              if (parsed.items) setItems(parsed.items);
            } catch { /* skip */ }
          }
        }
      } else {
        const res = await fetch('/api/step1/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const data = await res.json() as { success: boolean; items?: ExtractedItem[]; error?: string };
        if (!data.success) throw new Error(data.error || '提取失败');
        setItems(data.items || []);
      }

      updateState({ step1Completed: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleItemChange = (index: number, field: keyof ExtractedItem, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  // 分类列表
  const categories = [...new Set(items.map((i) => i.category))];

  return (
    <div className="h-full flex flex-col">
      {/* 操作区 */}
      <div className="flex items-center gap-4 p-4 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap">步骤1：分析招标文件</h2>
        <button
          onClick={() => handleExtract(true)}
          disabled={loading || !content.trim()}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? '提取中...' : 'AI提取(流式)'}
        </button>
        <button
          onClick={() => handleExtract(false)}
          disabled={loading || !content.trim()}
          className="px-3 py-1 text-xs bg-slate-600 text-white rounded hover:bg-slate-700 disabled:opacity-50"
        >
          AI提取(非流式)
        </button>
      </div>

      {/* 输入区：PDF上传 + 文本 */}
      <div className="px-4 pt-3 space-y-3">
        {/* PDF上传 */}
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handlePdfUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={pdfLoading}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {pdfLoading ? '解析中...' : '上传PDF招标文件'}
          </button>
          <span className="text-xs text-slate-400">支持PDF文件，自动提取文本内容</span>
        </div>

        {/* 文本区 */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="上传PDF后自动填入文本，也可直接粘贴招标文件商务条款内容..."
          className="w-full h-32 p-3 text-sm border border-slate-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      {error && <div className="mx-4 mt-2 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {/* 提取结果表格 */}
      <div className="flex-1 overflow-auto px-4 pb-4 mt-2">
        {categories.map((cat) => (
          <div key={cat} className="mb-4">
            <h3 className="text-xs font-semibold text-slate-700 mb-2 px-1">{cat}</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1 w-16">分类</th>
                  <th className="border border-slate-300 px-2 py-1">条款内容</th>
                  <th className="border border-slate-300 px-2 py-1">要求</th>
                  <th className="border border-slate-300 px-2 py-1">对报价影响</th>
                </tr>
              </thead>
              <tbody>
                {items
                  .map((item, i) => ({ item, originalIndex: i }))
                  .filter(({ item }) => item.category === cat)
                  .map(({ item, originalIndex }) => (
                    <tr key={originalIndex} className={originalIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="border border-slate-300 px-2 py-1 text-slate-500">{item.category}</td>
                      <td className="border border-slate-300 px-2 py-1">
                        <input
                          type="text"
                          value={item.content}
                          onChange={(e) => handleItemChange(originalIndex, 'content', e.target.value)}
                          className="w-full text-xs bg-transparent focus:outline-none focus:bg-amber-50 px-1"
                        />
                      </td>
                      <td className="border border-slate-300 px-2 py-1">
                        <input
                          type="text"
                          value={item.requirement}
                          onChange={(e) => handleItemChange(originalIndex, 'requirement', e.target.value)}
                          className="w-full text-xs bg-transparent focus:outline-none focus:bg-amber-50 px-1"
                        />
                      </td>
                      <td className="border border-slate-300 px-2 py-1">
                        <input
                          type="text"
                          value={item.impact}
                          onChange={(e) => handleItemChange(originalIndex, 'impact', e.target.value)}
                          className="w-full text-xs bg-transparent focus:outline-none focus:bg-amber-50 px-1"
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}

        {!items.length && !loading && (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
            上传PDF或粘贴招标文件内容后，点击"AI提取"自动分析商务条款
          </div>
        )}
      </div>
    </div>
  );
}
