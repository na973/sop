'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppState, type PriceCompareItem } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

const DEVIATION_COLORS: Record<string, string> = {
  控制价明显偏高: 'text-red-600 bg-red-50',
  控制价偏高: 'text-orange-600 bg-orange-50',
  基本接近: 'text-green-600 bg-green-50',
  控制价偏低: 'text-blue-600 bg-blue-50',
  '控制价明显偏低/疑似已压价': 'text-purple-600 bg-purple-50',
};

function calcRate(limitAmount: number, ourAmount: number): number | '' {
  return ourAmount > 0 ? (limitAmount - ourAmount) / ourAmount : '';
}

function findAmount(source: Record<string, number>, labels: string[]): number {
  for (const label of labels) {
    if (source[label] != null) return source[label];
  }
  const found = Object.entries(source).find(([key]) => labels.some((label) => key.includes(label)));
  return found?.[1] || 0;
}

function buildTotalCompareRows(
  items: PriceCompareItem[],
  summary: Record<string, number>,
  limitSummary: Record<string, number> = {},
) {
  const limitByCategory = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + (item.maxTotalPrice || 0);
    return acc;
  }, {});
  const ourByCategory = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + (item.ourTotalPrice || 0);
    return acc;
  }, {});

  const row = (code: string, name: string, limitAmount: number, ourAmount: number) => [
    code,
    name,
    limitAmount || '',
    ourAmount || '',
    calcRate(limitAmount, ourAmount),
  ];

  const sectionTotal = (names: string[], source: Record<string, number>) => names.reduce((sum, name) => sum + (source[name] || 0), 0);
  const projectNames = Array.from(new Set([...Object.keys(limitByCategory), ...Object.keys(ourByCategory)]));
  const projectRows = projectNames.map((name, index) => row(`1.1.${index + 1}`, name, limitByCategory[name] || 0, ourByCategory[name] || findAmount(summary, [name])));

  const limitProjectTotal = findAmount(limitSummary, ['建设项目分部分项工程项目费']) || sectionTotal(projectNames, limitByCategory);
  const ourProjectTotal = sectionTotal(projectNames, ourByCategory) || findAmount(summary, ['建设项目分部分项工程项目费']);
  const limitTotal = findAmount(limitSummary, ['合计=1+2+3+4', '合计']) || items.reduce((sum, item) => sum + (item.maxTotalPrice || 0), 0);
  const ourTotal = findAmount(summary, ['合计']);

  return [
    row('1', '建设项目分部分项工程项目费', limitProjectTotal, ourProjectTotal),
    row('1.1', '单项工程', limitProjectTotal, ourProjectTotal),
    ...projectRows,
    ['', '', '', '', ''],
    row('2', '措施项目费', findAmount(limitSummary, ['措施项目费']), findAmount(summary, ['措施项目费'])),
    row('2.1', '其中：安全文明施工费', findAmount(limitSummary, ['其中：安全文明施工费', '安全文明施工费']), findAmount(summary, ['其中：安全文明施工费', '安全文明施工费'])),
    row('2.2', '其他措施项目费', findAmount(limitSummary, ['其他措施项目费']), findAmount(summary, ['其他措施项目费'])),
    ['', '', '', '', ''],
    row('3', '其他项目费', findAmount(limitSummary, ['其他项目费']), findAmount(summary, ['其他项目费'])),
    row('3.1', '暂列金额', findAmount(limitSummary, ['暂列金额']), findAmount(summary, ['暂列金额'])),
    row('3.2', '专业工程暂估价（含税）', findAmount(limitSummary, ['专业工程暂估价（含税）']), findAmount(summary, ['专业工程暂估价（含税）'])),
    row('3.3', '计日工', findAmount(limitSummary, ['计日工']), findAmount(summary, ['计日工'])),
    row('3.4', '总承包服务费', findAmount(limitSummary, ['总承包服务费']), findAmount(summary, ['总承包服务费'])),
    ['', '', '', '', ''],
    row('4', '增值税', findAmount(limitSummary, ['增值税']), findAmount(summary, ['增值税'])),
    row('合计=1+2+3+4', '合计=1+2+3+4', limitTotal, ourTotal),
  ];
}

function formatPercent(value: number | '' | null | undefined, decimals = 1): string {
  if (value === '' || value == null || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function Step3Panel() {
  const { state, updateState, getSelectedFile } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [localMaxPrice, setLocalMaxPrice] = useState(state.maxPriceTotal || 38000000);
  const [screeningPercent, setScreeningPercent] = useState(30);
  const [abnormalPercent, setAbnormalPercent] = useState(30);
  const previousThresholds = useRef({ screeningPercent, abnormalPercent });

  const step3Data = state.step3Data;
  const pricingFile = getSelectedFile(3);
  const limitBillFile = getSelectedFile(31);
  const limitPdfFile = getSelectedFile(32);
  const totalRows = step3Data ? buildTotalCompareRows(step3Data, state.step2Data?.summary || {}, state.step3LimitSummary || {}) : [];

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
          screeningRatio: screeningPercent / 100,
          abnormalDeviationRatio: abnormalPercent / 100,
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({
          step3Data: data.compareItems || data.items,
          step3LimitSummary: data.limitSummary || null,
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
  }, [state.step2Data?.bidItems, pricingFile, limitBillFile, limitPdfFile, localMaxPrice, screeningPercent, abnormalPercent, updateState]);

  useEffect(() => {
    const changed = previousThresholds.current.screeningPercent !== screeningPercent
      || previousThresholds.current.abnormalPercent !== abnormalPercent;
    previousThresholds.current = { screeningPercent, abnormalPercent };
    if (!step3Data || !changed) {
      return;
    }
    const timer = window.setTimeout(() => {
      void handleCompare();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [screeningPercent, abnormalPercent, handleCompare, step3Data]);

  const handleExport = useCallback(async () => {
    if (!step3Data) return;
    const rows = step3Data.map((it, index) => [
      index + 1,
      it.category,
      it.code,
      it.name,
      it.feature || '',
      '',
      it.unit,
      it.quantity,
      it.maxUnitPrice,
      it.maxTotalPrice,
      it.ourUnitPrice,
      it.ourTotalPrice,
      it.deviationRate,
      it.deviationLevel,
      it.isScreeningItem ? '是' : '否',
      it.screeningRank ?? '',
      it.abnormalDeviationRate ?? '',
      it.isAbnormalBidItem ? '是' : '否',
    ]);
    const result = await exportToExcel(
      [
        {
          name: '总价对比',
          headers: ['序号', '汇总内容', '最高投标限价金额（元）', '清单组价金额（元）', '控制价偏差率 =（最高投标限价- 我方未下浮价）÷ 我方未下浮价'],
          rows: totalRows,
        },
        {
          name: '清单对比',
          headers: ['序号', '单项工程', '项目编码', '项目名称', '项目特征描述', '工作内容', '计量单位', '工程量', '最高投标限价综合单价', '最高投标限价综合合价', '清单组价综合单价', '清单组价合价', '控制价偏差率', '等级', '是否单价甄别项目', '甄别排名', '异常偏差率', '是否异常报价项'],
          rows,
        },
        {
          name: '差距规则',
          headers: ['序号', '控制价偏差率分档', '等级'],
          rows: [
            ['', '>=+20%', '控制价明显偏高'],
            ['', '+10%~+20%', '控制价偏高'],
            ['', '-10%~+10%', '基本接近'],
            ['', '-20%~-10%', '控制价偏低'],
            ['', '<=-20%', '控制价明显偏低/疑似已压价'],
            ['', `单价甄别前${screeningPercent}%`, `子目评审价排序前${screeningPercent}%`],
            ['', `异常偏差>${abnormalPercent}%`, '异常报价项'],
          ],
        },
      ],
      '表4 最高投标限价与清单组价对比表.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [step3Data, totalRows, screeningPercent, abnormalPercent]);

  const counts = step3Data ? {
    total: step3Data.length,
    screening: step3Data.filter((i) => i.isScreeningItem).length,
    abnormal: step3Data.filter((i) => i.isAbnormalBidItem).length,
    high: step3Data.filter((i) => i.deviationLevel.includes('偏高')).length,
    low: step3Data.filter((i) => i.deviationLevel.includes('偏低')).length,
  } : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤3：限价对比</h2>
        {step3Data && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出表4
          </button>
        )}
      </div>

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
          <label className="text-sm font-medium text-muted-foreground">最高投标限价 PDF（可选，优先读取真实综合单价和汇总金额）</label>
          <FileSelector step={32} accept=".pdf" />
        </div>
      </div>

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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-muted-foreground">单价甄别比例（%）</label>
          <input
            type="number"
            min={1}
            max={100}
            className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground font-mono"
            value={screeningPercent}
            onChange={(e) => setScreeningPercent(Number(e.target.value) || 30)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">异常偏差阈值（%）</label>
          <input
            type="number"
            min={1}
            max={100}
            className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground font-mono"
            value={abnormalPercent}
            onChange={(e) => setAbnormalPercent(Number(e.target.value) || 30)}
          />
        </div>
      </div>

      <button
        onClick={handleCompare}
        disabled={loading || (!state.step2Data?.bidItems?.length && !pricingFile)}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '对比计算中...' : '执行限价对比'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {counts && (
        <div className="grid grid-cols-5 gap-2">
          <StatCard label="总项数" value={counts.total} />
          <StatCard label="甄别项" value={counts.screening} tone="text-destructive" />
          <StatCard label="异常项" value={counts.abnormal} tone="text-red-700" />
          <StatCard label="偏高" value={counts.high} tone="text-orange-600" />
          <StatCard label="偏低" value={counts.low} tone="text-blue-600" />
        </div>
      )}

      {step3Data && (
        <div className="border border-border rounded overflow-hidden">
          <div className="px-3 py-2 bg-muted/40 text-sm font-medium">总价对比</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-1.5 text-left">序号</th>
                  <th className="px-2 py-1.5 text-left">汇总内容</th>
                  <th className="px-2 py-1.5 text-right">最高投标限价金额</th>
                  <th className="px-2 py-1.5 text-right">清单组价金额</th>
                  <th className="px-2 py-1.5 text-right">控制价偏差率</th>
                </tr>
              </thead>
              <tbody>
                {totalRows.map((row, index) => (
                  <tr key={index} className="border-t border-border">
                    <td className="px-2 py-1">{row[0]}</td>
                    <td className="px-2 py-1">{row[1]}</td>
                    <td className="px-2 py-1 text-right font-mono">{typeof row[2] === 'number' ? fmt(row[2]) : '-'}</td>
                    <td className="px-2 py-1 text-right font-mono">{typeof row[3] === 'number' ? fmt(row[3]) : '-'}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatPercent(row[4] as number | '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step3Data && (
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full min-w-max text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-2 py-1.5 text-left">分部</th>
                <th className="px-2 py-1.5 text-left">编码</th>
                <th className="px-2 py-1.5 text-left">名称</th>
                <th className="px-2 py-1.5 text-left">项目特征</th>
                <th className="px-2 py-1.5 text-right">工程量</th>
                <th className="px-2 py-1.5 text-right">我方单价</th>
                <th className="px-2 py-1.5 text-right">我方合价</th>
                <th className="px-2 py-1.5 text-right">限价单价</th>
                <th className="px-2 py-1.5 text-right">限价合价</th>
                <th className="px-2 py-1.5 text-right">单价偏差率</th>
                <th className="px-2 py-1.5 text-center">等级</th>
                <th className="px-2 py-1.5 text-center">甄别</th>
                <th className="px-2 py-1.5 text-right">异常偏差率</th>
                <th className="px-2 py-1.5 text-center">异常</th>
              </tr>
            </thead>
            <tbody>
              {step3Data.map((it, i) => (
                <tr key={i} className={`border-t border-border ${it.isScreeningItem ? 'bg-red-50/50' : ''}`}>
                  <td className="px-2 py-1">{it.category}</td>
                  <td className="px-2 py-1 font-mono">{it.code}</td>
                  <td className="px-2 py-1">{it.name}</td>
                  <td className="max-w-80 whitespace-pre-wrap break-words px-2 py-1 text-muted-foreground">{it.feature || ''}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.quantity)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.ourUnitPrice)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.ourTotalPrice)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.maxUnitPrice)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.maxTotalPrice)}</td>
                  <td className="px-2 py-1 text-right font-mono">{formatPercent(it.deviationRate)}</td>
                  <td className="px-2 py-1 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${DEVIATION_COLORS[it.deviationLevel] || ''}`}>
                      {it.deviationLevel}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-center">{it.isScreeningItem ? `是${it.screeningRank ? `(${it.screeningRank})` : ''}` : '否'}</td>
                  <td className="px-2 py-1 text-right font-mono">{formatPercent(it.abnormalDeviationRate)}</td>
                  <td className="px-2 py-1 text-center">{it.isAbnormalBidItem ? <span className="text-destructive font-bold">是</span> : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border border-border rounded p-2 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono font-medium ${tone}`}>{value}</div>
    </div>
  );
}
