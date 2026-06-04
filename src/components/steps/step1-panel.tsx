'use client';

import { useState, useCallback } from 'react';

interface ExtractedItem {
  category: string;
  item: string;
  content: string;
  impact: string;
  note: string;
}

interface Step1PanelProps {
  onComplete: () => void;
}

const CATEGORIES = [
  '投标报价要求',
  '工期要求',
  '质量要求',
  '付款条件',
  '保证金与保险',
  '变更与索赔',
  '违约与争议',
  '其他商务条款',
];

const IMPACT_COLORS: Record<string, string> = {
  '高': 'bg-rose-50 text-rose-600',
  '中': 'bg-amber-50 text-amber-600',
  '低': 'bg-slate-50 text-slate-500',
};

export default function Step1Panel({ onComplete }: Step1PanelProps) {
  const [fileText, setFileText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [extractedData, setExtractedData] = useState<ExtractedItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('全部');

  // AI提取
  const handleExtract = useCallback(async () => {
    if (!fileText.trim()) return;
    setExtracting(true);
    setStreamText('');
    setExtractedData([]);

    try {
      const response = await fetch('/api/step1/extract-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileText }),
      });

      if (!response.ok) throw new Error('请求失败');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取流');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullText += parsed.content;
                setStreamText(fullText);
              }
            } catch {
              // ignore parse errors in stream
            }
          }
        }
      }

      // 解析最终结果
      try {
        const jsonMatch = fullText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          setExtractedData(data);
        }
      } catch {
        // 如果解析失败，保持streamText显示
      }
    } catch (error) {
      console.error('Extract error:', error);
    } finally {
      setExtracting(false);
    }
  }, [fileText]);

  // 导出Excel
  const handleExport = useCallback(() => {
    if (extractedData.length === 0) return;

    // 生成CSV内容（后续替换为ExcelJS导出）
    const headers = ['分类', '条款名称', '条款内容', '影响程度', '备注'];
    const rows = extractedData.map((item) => [
      item.category,
      item.item,
      item.content,
      item.impact,
      item.note,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.map((c) => `"${(c || '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '表1_招标文件商务条款提取表.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [extractedData]);

  const filteredData =
    activeCategory === '全部'
      ? extractedData
      : extractedData.filter((d) => d.category === activeCategory);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 步骤说明 */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h2 className="text-lg font-semibold text-slate-800">步骤1：分析招标文件</h2>
        <p className="text-sm text-slate-500 mt-2">
          上传招标文件文本，AI自动提取8大分类的商务条款信息，人工校对后导出。
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {CATEGORIES.map((cat) => (
            <span key={cat} className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded">
              {cat}
            </span>
          ))}
        </div>
      </div>

      {/* 输入区域 */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          招标文件内容
        </label>
        <textarea
          value={fileText}
          onChange={(e) => setFileText(e.target.value)}
          placeholder="将招标文件的文本内容粘贴到此处..."
          className="w-full h-48 p-3 border border-slate-200 rounded-md text-sm resize-y focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={handleExtract}
            disabled={extracting || !fileText.trim()}
            className="px-5 py-2 bg-amber-500 text-white text-sm font-medium rounded-md hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {extracting ? 'AI提取中...' : 'AI提取商务条款'}
          </button>
          <span className="text-xs text-slate-400">
            {fileText.length > 0 ? `${fileText.length} 字` : '请先粘贴招标文件内容'}
          </span>
        </div>
      </div>

      {/* AI流式输出 */}
      {streamText && extractedData.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-700 mb-2">AI输出</h3>
          <pre className="text-xs text-slate-600 whitespace-pre-wrap max-h-60 overflow-auto font-data">
            {streamText}
          </pre>
        </div>
      )}

      {/* 提取结果 */}
      {extractedData.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200">
          <div className="flex items-center justify-between p-5 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-medium text-slate-700">
                提取结果（共 {extractedData.length} 条）
              </h3>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm rounded-md hover:bg-slate-700 transition-colors"
              >
                导出CSV
              </button>
              <button
                onClick={onComplete}
                className="px-4 py-1.5 bg-emerald-500 text-white text-sm rounded-md hover:bg-emerald-600 transition-colors"
              >
                确认完成
              </button>
            </div>
          </div>

          {/* 分类筛选 */}
          <div className="px-5 py-3 border-b border-slate-100 flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveCategory('全部')}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                activeCategory === '全部'
                  ? 'bg-amber-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              全部 ({extractedData.length})
            </button>
            {CATEGORIES.map((cat) => {
              const count = extractedData.filter((d) => d.category === cat).length;
              if (count === 0) return null;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors ${
                    activeCategory === cat
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>

          {/* 数据表格 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-4 py-2.5 font-medium text-slate-600 w-32">分类</th>
                  <th className="px-4 py-2.5 font-medium text-slate-600 w-40">条款名称</th>
                  <th className="px-4 py-2.5 font-medium text-slate-600">条款内容</th>
                  <th className="px-4 py-2.5 font-medium text-slate-600 w-20">影响</th>
                  <th className="px-4 py-2.5 font-medium text-slate-600 w-32">备注</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item, idx) => (
                  <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-600">{item.category}</td>
                    <td className="px-4 py-2.5 text-slate-800 font-medium">{item.item}</td>
                    <td className="px-4 py-2.5 text-slate-600 max-w-md">{item.content}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          IMPACT_COLORS[item.impact] || IMPACT_COLORS['低']
                        }`}
                      >
                        {item.impact}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{item.note}</td>
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
