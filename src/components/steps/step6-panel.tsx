'use client';

import { useState, useCallback, useEffect, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { useAppState, type AdjustedBidItem, type PriceChange } from '@/lib/app-state';
import { FileSelector } from '@/components/file-selector';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

function findAmount(source: Record<string, number>, labels: string[]): number {
  for (const label of labels) {
    if (source[label] != null) return source[label];
  }
  const found = Object.entries(source).find(([key]) => labels.some((label) => key.includes(label)));
  return found?.[1] || 0;
}

function buildAdjustedTotalRows(
  items: AdjustedBidItem[],
  finalSummaryRows: Array<{ content: string; amount: number }> = [],
  limitSummary: Record<string, number> = {},
) {
  const finalSummary = Object.fromEntries(finalSummaryRows.map((row) => [row.content, row.amount]));
  const limitByCategory = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.maxTotalPrice;
    return acc;
  }, {});
  const adjustedByCategory = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.adjustedTotalPrice;
    return acc;
  }, {});
  const categories = Array.from(new Set([...Object.keys(limitByCategory), ...Object.keys(adjustedByCategory)]));
  const rate = (limit: number, adjusted: number) => limit > 0 ? (limit - adjusted) / limit : null;
  const row = (code: string, name: string, limit: number, adjusted: number): [string, string, number, number, number | null] => [
    code,
    name,
    limit,
    adjusted,
    rate(limit, adjusted),
  ];
  const limitPart = findAmount(limitSummary, ['建设项目分部分项工程项目费'])
    || Object.values(limitByCategory).reduce((sum, value) => sum + value, 0);
  const adjustedPart = findAmount(finalSummary, ['建设项目分部分项工程项目费'])
    || Object.values(adjustedByCategory).reduce((sum, value) => sum + value, 0);

  return [
    row('1', '建设项目分部分项工程项目费', limitPart, adjustedPart),
    row('1.1', '单项工程', limitPart, adjustedPart),
    ...categories.map((category, index) => row(`1.1.${index + 1}`, category, limitByCategory[category] || 0, adjustedByCategory[category] || 0)),
    row('', '', 0, 0),
    row('2', '措施项目费', findAmount(limitSummary, ['措施项目费']), findAmount(finalSummary, ['措施项目费'])),
    row('2.1', '其中：安全文明施工费', findAmount(limitSummary, ['其中：安全文明施工费', '安全文明施工费']), findAmount(finalSummary, ['其中：安全文明施工费', '安全文明施工费'])),
    row('2.2', '其他措施项目费', findAmount(limitSummary, ['其他措施项目费']), findAmount(finalSummary, ['其他措施项目费'])),
    row('', '', 0, 0),
    row('3', '其他项目费', findAmount(limitSummary, ['其他项目费']), findAmount(finalSummary, ['其他项目费'])),
    row('3.1', '暂列金额', findAmount(limitSummary, ['暂列金额']), findAmount(finalSummary, ['暂列金额'])),
    row('3.2', '专业工程暂估价（含税）', findAmount(limitSummary, ['专业工程暂估价（含税）']), findAmount(finalSummary, ['专业工程暂估价（含税）'])),
    row('3.3', '计日工', findAmount(limitSummary, ['计日工']), findAmount(finalSummary, ['计日工'])),
    row('3.4', '总承包服务费', findAmount(limitSummary, ['总承包服务费']), findAmount(finalSummary, ['总承包服务费'])),
    row('', '', 0, 0),
    row('4', '增值税', findAmount(limitSummary, ['增值税']), findAmount(finalSummary, ['增值税'])),
    row('合计=1+2+3+4', '合计=1+2+3+4', findAmount(limitSummary, ['合计=1+2+3+4', '合计']), findAmount(finalSummary, ['合计=1+2+3+4', '合计'])),
  ];
}

function formatTargetDiscountRange(item: AdjustedBidItem): string {
  if (item.targetDiscountRateRange) {
    return `${(item.targetDiscountRateRange[0] * 100).toFixed(2)}% ~ ${(item.targetDiscountRateRange[1] * 100).toFixed(2)}%`;
  }
  const fallback = item.maxUnitPrice > 0 ? (1 - item.targetUnitPrice / item.maxUnitPrice) : 0;
  return `${(fallback * 100).toFixed(2)}% ~ ${(fallback * 100).toFixed(2)}%`;
}

type ResourceColumnKey = 'code' | 'name' | 'status' | 'originalPrice' | 'adjustedPrice' | 'fixed' | 'diff' | 'diffPercent';
type ResourceFilter = { query: string; selected: string[] | null; sort: 'asc' | 'desc' | null };
type ResourceFilterState = Partial<Record<ResourceColumnKey, ResourceFilter>>;
type DetailColumnKey = 'category' | 'code' | 'name' | 'isScreeningItem' | 'quantity' | 'maxUnitPrice' | 'maxTotalPrice' | 'targetUnitPrice' | 'adjustedUnitPrice' | 'adjustedTotalPrice' | 'discountRate' | 'targetDiscountRange';
type DetailFilter = { query: string; selected: string[] | null; sort: 'asc' | 'desc' | null };
type DetailFilterState = Partial<Record<DetailColumnKey, DetailFilter>>;

const RESOURCE_COLUMNS: Array<{ key: ResourceColumnKey; label: string; align?: 'left' | 'right' | 'center'; width: number }> = [
  { key: 'code', label: '编码', align: 'left', width: 120 },
  { key: 'name', label: '名称', align: 'left', width: 220 },
  { key: 'status', label: '自动调价状态', align: 'left', width: 190 },
  { key: 'originalPrice', label: '原含税市场价', align: 'right', width: 130 },
  { key: 'adjustedPrice', label: '调后含税市场价', align: 'right', width: 140 },
  { key: 'fixed', label: '是否固定', align: 'center', width: 100 },
  { key: 'diff', label: '差额', align: 'right', width: 110 },
  { key: 'diffPercent', label: '调价比率', align: 'right', width: 110 },
];

const DETAIL_COLUMNS: Array<{ key: DetailColumnKey; label: string; align?: 'left' | 'right' | 'center'; width: number }> = [
  { key: 'category', label: '分部', align: 'left', width: 120 },
  { key: 'code', label: '编码', align: 'left', width: 130 },
  { key: 'name', label: '名称', align: 'left', width: 220 },
  { key: 'isScreeningItem', label: '甄别', align: 'center', width: 90 },
  { key: 'quantity', label: '工程量', align: 'right', width: 110 },
  { key: 'maxUnitPrice', label: '限价单价', align: 'right', width: 110 },
  { key: 'maxTotalPrice', label: '限价合价', align: 'right', width: 120 },
  { key: 'targetUnitPrice', label: '目标单价', align: 'right', width: 110 },
  { key: 'adjustedUnitPrice', label: '调价后单价', align: 'right', width: 120 },
  { key: 'adjustedTotalPrice', label: '调价后合价', align: 'right', width: 130 },
  { key: 'discountRate', label: '下浮率', align: 'right', width: 100 },
  { key: 'targetDiscountRange', label: '目标下浮率范围', align: 'right', width: 150 },
];

function getResourceCellValue(row: PriceChange, key: ResourceColumnKey): string {
  if (key === 'status') return row.isAdjustable ? '自动调价' : row.reviewReason || '仅显示/人工复核';
  if (key === 'fixed') return row.fixed ? '是' : '否';
  if (key === 'originalPrice') return String(row.originalPrice ?? 0);
  if (key === 'adjustedPrice') return String(row.adjustedPrice ?? 0);
  if (key === 'diff') return String(row.diff ?? 0);
  if (key === 'diffPercent') return String(row.diffPercent ?? 0);
  return String(row[key] ?? '');
}

function compareResourceValues(a: PriceChange, b: PriceChange, key: ResourceColumnKey) {
  const av = getResourceCellValue(a, key);
  const bv = getResourceCellValue(b, key);
  const an = Number(av);
  const bn = Number(bv);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return av.localeCompare(bv, 'zh-CN');
}

function getDetailCellValue(row: AdjustedBidItem, key: DetailColumnKey): string {
  if (key === 'isScreeningItem') return row.isScreeningItem ? '是' : '否';
  if (key === 'discountRate') return `${(row.discountRate * 100).toFixed(2)}%`;
  if (key === 'targetDiscountRange') return formatTargetDiscountRange(row);
  return String(row[key] ?? '');
}

function compareDetailValues(a: AdjustedBidItem, b: AdjustedBidItem, key: DetailColumnKey) {
  if (['quantity', 'maxUnitPrice', 'maxTotalPrice', 'targetUnitPrice', 'adjustedUnitPrice', 'adjustedTotalPrice', 'discountRate'].includes(key)) {
    return (Number(a[key as keyof AdjustedBidItem]) || 0) - (Number(b[key as keyof AdjustedBidItem]) || 0);
  }
  return getDetailCellValue(a, key).localeCompare(getDetailCellValue(b, key), 'zh-CN');
}

function isDisplayableResourceRow(row: PriceChange): boolean {
  const text = `${row.code ?? ''}${row.name ?? ''}${row.reviewReason ?? ''}`.replace(/\s+/g, '');
  if (!text) return false;
  return !/合计|小计|汇总|总计|累计|材料费合计|人工费合计|机械费合计/.test(text);
}

export function Step6Panel() {
  const { state, updateState, getSelectedFile } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultTab, setResultTab] = useState<'summary' | 'details' | 'resources'>('summary');
  const [resourceFilters, setResourceFilters] = useState<ResourceFilterState>({});
  const [draftResourceFilters, setDraftResourceFilters] = useState<ResourceFilterState>({});
  const [openResourceFilter, setOpenResourceFilter] = useState<ResourceColumnKey | null>(null);
  const [detailFilters, setDetailFilters] = useState<DetailFilterState>({});
  const [draftDetailFilters, setDraftDetailFilters] = useState<DetailFilterState>({});
  const [openDetailFilter, setOpenDetailFilter] = useState<DetailColumnKey | null>(null);
  const [resourceColumnWidths, setResourceColumnWidths] = useState<Record<ResourceColumnKey, number>>(() => (
    Object.fromEntries(RESOURCE_COLUMNS.map((column) => [column.key, column.width])) as Record<ResourceColumnKey, number>
  ));
  const [detailColumnWidths, setDetailColumnWidths] = useState<Record<DetailColumnKey, number>>(() => (
    Object.fromEntries(DETAIL_COLUMNS.map((column) => [column.key, column.width])) as Record<DetailColumnKey, number>
  ));

  const step5Data = state.step5Data;
  const step6Data = state.step6Data;
  const selectedStep2File = getSelectedFile(2);
  const selectedOverrideFile = getSelectedFile(6);
  const selectedFile = selectedOverrideFile ?? selectedStep2File;

  useEffect(() => {
    if (!openResourceFilter && !openDetailFilter) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-resource-filter-root="true"]')) return;
      if (target?.closest('[data-detail-filter-root="true"]')) return;
      setOpenResourceFilter(null);
      setOpenDetailFilter(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openResourceFilter, openDetailFilter]);

  const handleMaterialPricing = useCallback(async () => {
    if (!selectedFile) {
      setError('请先在步骤2上传清单组价表，或在步骤6选择一个Excel文件');
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
          fileBase64: selectedFile.base64,
          balancedItems: step5Data.level2.items,
          targetProjectTotal: step5Data.level1.targetTotal,
          tolerance: 200,
          lockedPriceChanges: step6Data?.level3?.priceChanges
            ?.map((change) => ({
              row: change.row,
              priceCol: change.priceCol,
              code: change.code,
              adjustedPrice: change.adjustedPrice,
              fixed: Boolean(change.fixed),
            })) ?? [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({ step6Data: data });
        setResultTab('resources');
      } else {
        setError(data.error || '工料机调价失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [selectedFile, step5Data, step6Data, updateState]);

  const updatePriceChange = useCallback((index: number, patch: Partial<PriceChange>) => {
    if (!step6Data?.level3?.priceChanges) return;
    const priceChanges = step6Data.level3.priceChanges.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...patch };
      next.diff = Number((next.adjustedPrice - next.originalPrice).toFixed(2));
      next.diffPercent = next.originalPrice !== 0
        ? Number(((next.adjustedPrice - next.originalPrice) / next.originalPrice).toFixed(4))
        : 0;
      return next;
    });
    updateState({
      step6Data: {
        ...step6Data,
        level3: {
          ...step6Data.level3,
          priceChanges,
        },
      },
    });
  }, [step6Data, updateState]);

  const handleExport = useCallback(async () => {
    if (!step6Data?.level3?.priceChanges) return;
    const changes = step6Data.level3.priceChanges;
    const adjustedItems = step6Data.level3.adjustedItems || [];
    const totalRows = buildAdjustedTotalRows(adjustedItems, step6Data.finalSummary || [], state.step3LimitSummary || {});
    const result = await exportToExcel(
      [
        {
          name: '调价后总价',
          headers: ['序号', '汇总内容', '限价金额', '调价后金额', '下浮率'],
          rows: totalRows,
        },
        {
          name: '调价后清单',
          headers: ['分部', '编码', '名称', '是否单价甄别项', '工程量', '限价单价', '限价合价', '目标单价', '调价后单价', '调价后合价', '下浮率', '目标下浮率范围'],
          rows: adjustedItems.map((item) => [
            item.category, item.code, item.name, item.isScreeningItem ? '是' : '否', item.quantity, item.maxUnitPrice, item.maxTotalPrice,
            item.targetUnitPrice, item.adjustedUnitPrice, item.adjustedTotalPrice, item.discountRate, formatTargetDiscountRange(item),
          ]),
        },
        {
          name: '工料机调价',
          headers: ['编码', '名称', '自动调价状态', '原含税市场价', '调后含税市场价', '是否固定', '差额', '调价比率'],
          rows: changes.map((c) => [c.code, c.name, c.isAdjustable ? '自动调价' : c.reviewReason || '仅显示/人工复核', c.originalPrice, c.adjustedPrice, c.fixed ? '是' : '否', c.diff, c.diffPercent ?? 0]),
        },
      ],
      '工料机调价配平结果.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [step6Data, state.step3LimitSummary]);

  const validation = step6Data?.validation;
  const level3 = step6Data?.level3;
  const adjustedItems = level3?.adjustedItems || [];
  const filteredAdjustedItems = useMemo(() => {
    const rows = adjustedItems.filter((row) => DETAIL_COLUMNS.every(({ key }) => {
      const filter = detailFilters[key];
      if (!filter) return true;
      const value = getDetailCellValue(row, key);
      if (filter.query && !value.toLowerCase().includes(filter.query.toLowerCase())) return false;
      if (filter.selected && !filter.selected.includes(value)) return false;
      return true;
    }));
    const sortColumn = DETAIL_COLUMNS.find(({ key }) => detailFilters[key]?.sort);
    if (sortColumn) {
      const sort = detailFilters[sortColumn.key]?.sort;
      rows.sort((a, b) => compareDetailValues(a, b, sortColumn.key) * (sort === 'desc' ? -1 : 1));
    }
    return rows;
  }, [adjustedItems, detailFilters]);
  const resourceRows = useMemo(
    () => (level3?.priceChanges || []).filter(isDisplayableResourceRow),
    [level3?.priceChanges],
  );
  const filteredResourceRows = useMemo(() => {
    const rows = resourceRows
      .map((row, originalIndex) => ({ row, originalIndex }))
      .filter(({ row }) => RESOURCE_COLUMNS.every(({ key }) => {
        const filter = resourceFilters[key];
        if (!filter) return true;
        const value = getResourceCellValue(row, key);
        if (filter.query && !value.toLowerCase().includes(filter.query.toLowerCase())) return false;
        if (filter.selected && !filter.selected.includes(value)) return false;
        return true;
      }));
    const sortColumn = RESOURCE_COLUMNS.find(({ key }) => resourceFilters[key]?.sort);
    if (sortColumn) {
      const sort = resourceFilters[sortColumn.key]?.sort;
      rows.sort((a, b) => compareResourceValues(a.row, b.row, sortColumn.key) * (sort === 'desc' ? -1 : 1));
    }
    return rows;
  }, [resourceFilters, resourceRows]);
  const adjustedTotalRows = step6Data
    ? buildAdjustedTotalRows(adjustedItems, step6Data.finalSummary || [], state.step3LimitSummary || {})
    : [];

  const clearResourceFilter = useCallback((key: ResourceColumnKey) => {
    setResourceFilters((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setDraftResourceFilters((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const clearDetailFilter = useCallback((key: DetailColumnKey) => {
    setDetailFilters((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setDraftDetailFilters((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const updateDraftResourceFilter = useCallback((key: ResourceColumnKey, patch: Partial<ResourceFilter>) => {
    setDraftResourceFilters((current) => ({
      ...current,
      [key]: {
        query: current[key]?.query ?? resourceFilters[key]?.query ?? '',
        selected: current[key]?.selected ?? resourceFilters[key]?.selected ?? null,
        sort: current[key]?.sort ?? resourceFilters[key]?.sort ?? null,
        ...patch,
      },
    }));
  }, [resourceFilters]);

  const updateDraftDetailFilter = useCallback((key: DetailColumnKey, patch: Partial<DetailFilter>) => {
    setDraftDetailFilters((current) => ({
      ...current,
      [key]: {
        query: current[key]?.query ?? detailFilters[key]?.query ?? '',
        selected: current[key]?.selected ?? detailFilters[key]?.selected ?? null,
        sort: current[key]?.sort ?? detailFilters[key]?.sort ?? null,
        ...patch,
      },
    }));
  }, [detailFilters]);

  const toggleResourceFilter = useCallback((key: ResourceColumnKey) => {
    if (openResourceFilter === key) {
      setOpenResourceFilter(null);
      return;
    }
    setDraftResourceFilters((current) => ({
      ...current,
      [key]: {
        query: resourceFilters[key]?.query ?? '',
        selected: resourceFilters[key]?.selected ?? null,
        sort: resourceFilters[key]?.sort ?? null,
      },
    }));
    setOpenResourceFilter(key);
  }, [openResourceFilter, resourceFilters]);

  const toggleDetailFilter = useCallback((key: DetailColumnKey) => {
    if (openDetailFilter === key) {
      setOpenDetailFilter(null);
      return;
    }
    setDraftDetailFilters((current) => ({
      ...current,
      [key]: {
        query: detailFilters[key]?.query ?? '',
        selected: detailFilters[key]?.selected ?? null,
        sort: detailFilters[key]?.sort ?? null,
      },
    }));
    setOpenDetailFilter(key);
  }, [openDetailFilter, detailFilters]);

  const confirmResourceFilter = useCallback((key: ResourceColumnKey, allValues: string[]) => {
    const draft = draftResourceFilters[key] ?? resourceFilters[key] ?? { query: '', selected: null, sort: null };
    const selected = draft.selected && draft.selected.length === allValues.length ? null : draft.selected;
    const normalized: ResourceFilter = {
      query: draft.query?.trim() ?? '',
      selected,
      sort: draft.sort ?? null,
    };

    setResourceFilters((current) => {
      const next = { ...current };
      if (!normalized.query && !normalized.selected && !normalized.sort) {
        delete next[key];
      } else {
        next[key] = normalized;
      }
      return next;
    });
    setOpenResourceFilter(null);
  }, [draftResourceFilters, resourceFilters]);

  const confirmDetailFilter = useCallback((key: DetailColumnKey, allValues: string[]) => {
    const draft = draftDetailFilters[key] ?? detailFilters[key] ?? { query: '', selected: null, sort: null };
    const selected = draft.selected && draft.selected.length === allValues.length ? null : draft.selected;
    const normalized: DetailFilter = {
      query: draft.query?.trim() ?? '',
      selected,
      sort: draft.sort ?? null,
    };

    setDetailFilters((current) => {
      const next = { ...current };
      if (!normalized.query && !normalized.selected && !normalized.sort) {
        delete next[key];
      } else {
        next[key] = normalized;
      }
      return next;
    });
    setOpenDetailFilter(null);
  }, [draftDetailFilters, detailFilters]);

  const setAllFixed = useCallback((fixed: boolean) => {
    if (!step6Data?.level3?.priceChanges) return;
    updateState({
      step6Data: {
        ...step6Data,
        level3: {
          ...step6Data.level3,
          priceChanges: step6Data.level3.priceChanges.map((item) => ({ ...item, fixed })),
        },
      },
    });
  }, [step6Data, updateState]);

  const startResourceColumnResize = useCallback((key: ResourceColumnKey, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = resourceColumnWidths[key] ?? RESOURCE_COLUMNS.find((column) => column.key === key)?.width ?? 120;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(70, startWidth + moveEvent.clientX - startX);
      setResourceColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [resourceColumnWidths]);

  const startDetailColumnResize = useCallback((key: DetailColumnKey, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = detailColumnWidths[key] ?? DETAIL_COLUMNS.find((column) => column.key === key)?.width ?? 120;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(70, startWidth + moveEvent.clientX - startX);
      setDetailColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [detailColumnWidths]);

  const renderResourceFilterHeader = (column: typeof RESOURCE_COLUMNS[number]) => {
    const filter = resourceFilters[column.key];
    const draftFilter = draftResourceFilters[column.key] ?? filter;
    const values = Array.from(new Set(resourceRows.map((row) => getResourceCellValue(row, column.key))))
      .filter((value) => value !== '')
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const selected = draftFilter?.selected ?? values;
    const query = draftFilter?.query ?? '';
    const visibleValues = values.filter((value) => !query || value.toLowerCase().includes(query.toLowerCase()));
    const active = Boolean(filter?.query || filter?.selected || filter?.sort);

    return (
      <th
        key={column.key}
        className={`relative px-2 py-1.5 ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}
        style={{ width: resourceColumnWidths[column.key], minWidth: resourceColumnWidths[column.key] }}
      >
        <div className={`flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : 'justify-start'}`}>
          <span className={active ? 'text-primary font-semibold' : ''}>{column.label}</span>
          <button
            type="button"
            aria-label={`${column.label}筛选排序`}
            onClick={() => toggleResourceFilter(column.key)}
            className={`inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background text-[10px] shadow-sm hover:bg-muted ${active ? 'border-primary text-primary' : 'text-muted-foreground'}`}
          >
            {filter?.sort === 'asc' ? '↑' : filter?.sort === 'desc' ? '↓' : '▼'}
          </button>
        </div>
        {openResourceFilter === column.key && (
          <div
            data-resource-filter-root="true"
            className={`absolute z-20 mt-1 flex min-h-56 min-w-64 resize flex-col overflow-auto rounded border border-border bg-background p-2 text-left shadow-lg ${column.align === 'right' ? 'right-2' : 'left-2'}`}
            style={{ width: 280, height: 340 }}
          >
            <div className="mb-2 flex gap-1">
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftResourceFilter(column.key, { sort: 'asc' })}>升序</button>
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftResourceFilter(column.key, { sort: 'desc' })}>降序</button>
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftResourceFilter(column.key, { sort: null })}>清排序</button>
            </div>
            <input
              value={query}
              onChange={(event) => updateDraftResourceFilter(column.key, { query: event.target.value })}
              placeholder="输入文字筛选"
              className="mb-2 w-full rounded border border-border px-2 py-1 text-xs"
            />
            <div className="mb-2 flex gap-1">
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftResourceFilter(column.key, { selected: values })}>全选</button>
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftResourceFilter(column.key, { selected: [] })}>取消全选</button>
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => clearResourceFilter(column.key)}>清除</button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
              {visibleValues.map((value) => (
                <label key={value} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.includes(value)}
                    onChange={(event) => {
                      const nextSelected = event.target.checked
                        ? Array.from(new Set([...selected, value]))
                        : selected.filter((item) => item !== value);
                      updateDraftResourceFilter(column.key, { selected: nextSelected });
                    }}
                  />
                  <span className="truncate" title={value}>{value}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => clearResourceFilter(column.key)}>清空筛选</button>
              <button type="button" className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground" onClick={() => confirmResourceFilter(column.key, values)}>确定</button>
            </div>
          </div>
        )}
        <span
          role="separator"
          aria-label={`${column.label}列宽调整`}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50"
          onMouseDown={(event) => startResourceColumnResize(column.key, event)}
        />
      </th>
    );
  };

  const renderDetailFilterHeader = (column: typeof DETAIL_COLUMNS[number]) => {
    const filter = detailFilters[column.key];
    const draftFilter = draftDetailFilters[column.key] ?? filter;
    const values = Array.from(new Set(adjustedItems.map((row) => getDetailCellValue(row, column.key))))
      .filter((value) => value !== '')
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const selected = draftFilter?.selected ?? values;
    const query = draftFilter?.query ?? '';
    const visibleValues = values.filter((value) => !query || value.toLowerCase().includes(query.toLowerCase()));
    const active = Boolean(filter?.query || filter?.selected || filter?.sort);

    return (
      <th
        key={column.key}
        className={`relative px-2 py-1.5 ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}
        style={{ width: detailColumnWidths[column.key], minWidth: detailColumnWidths[column.key] }}
      >
        <div className={`flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : 'justify-start'}`}>
          <span className={active ? 'text-primary font-semibold' : ''}>{column.label}</span>
          <button
            type="button"
            aria-label={`${column.label}筛选排序`}
            onClick={() => toggleDetailFilter(column.key)}
            className={`inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background text-[10px] shadow-sm hover:bg-muted ${active ? 'border-primary text-primary' : 'text-muted-foreground'}`}
          >
            {filter?.sort === 'asc' ? '↑' : filter?.sort === 'desc' ? '↓' : '▼'}
          </button>
        </div>
        {openDetailFilter === column.key && (
          <div
            data-detail-filter-root="true"
            className={`absolute z-20 mt-1 flex min-h-56 min-w-64 resize flex-col overflow-auto rounded border border-border bg-background p-2 text-left shadow-lg ${column.align === 'right' ? 'right-2' : 'left-2'}`}
            style={{ width: 280, height: 340 }}
          >
            <div className="mb-2 flex gap-1">
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftDetailFilter(column.key, { sort: 'asc' })}>升序</button>
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftDetailFilter(column.key, { sort: 'desc' })}>降序</button>
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftDetailFilter(column.key, { sort: null })}>清排序</button>
            </div>
            <input
              value={query}
              onChange={(event) => updateDraftDetailFilter(column.key, { query: event.target.value })}
              placeholder="输入文字筛选"
              className="mb-2 w-full rounded border border-border px-2 py-1 text-xs"
            />
            <div className="mb-2 flex gap-1">
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftDetailFilter(column.key, { selected: values })}>全选</button>
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => updateDraftDetailFilter(column.key, { selected: [] })}>取消全选</button>
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => clearDetailFilter(column.key)}>清除</button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
              {visibleValues.map((value) => (
                <label key={value} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.includes(value)}
                    onChange={(event) => {
                      const nextSelected = event.target.checked
                        ? Array.from(new Set([...selected, value]))
                        : selected.filter((item) => item !== value);
                      updateDraftDetailFilter(column.key, { selected: nextSelected });
                    }}
                  />
                  <span className="truncate" title={value}>{value}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
              <button type="button" className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => clearDetailFilter(column.key)}>清空筛选</button>
              <button type="button" className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground" onClick={() => confirmDetailFilter(column.key, values)}>确定</button>
            </div>
          </div>
        )}
        <span
          role="separator"
          aria-label={`${column.label}列宽调整`}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50"
          onMouseDown={(event) => startDetailColumnResize(column.key, event)}
        />
      </th>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤6：工料机调价配平</h2>
        {step6Data && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出Excel
          </button>
        )}
      </div>

      <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded">
        步骤6默认使用步骤2上传的清单组价表作为公式工作簿基础，再结合步骤5的清单目标价格调整工料机汇总表中的人工、材料、机械含税市场价，并由公式引擎重算整本工作簿。
      </div>

      {selectedStep2File && (
        <div className="text-xs rounded border border-border p-2">
          当前步骤2清单组价表：<span className="font-medium">{selectedStep2File.name}</span>
          {selectedOverrideFile && <span className="text-muted-foreground">；步骤6已选择覆盖文件：{selectedOverrideFile.name}</span>}
        </div>
      )}

      {/* 可选覆盖文件选择 */}
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
        {loading ? '迭代计算中...' : '执行工料机调价配平'}
      </button>

      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {/* 验证结果 */}
      {validation && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">迭代验证</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>收敛：<span className={validation.converged ? 'text-green-600 font-bold' : 'text-red-600'}>{validation.converged ? '是' : '否'}</span></div>
            <div>迭代次数：<span className="font-mono">{validation.iterations}</span></div>
            <div>目标清单合价：<span className="font-mono">{fmt(validation.targetTotal)}</span></div>
            <div>实际清单合价：<span className="font-mono">{fmt(validation.actualTotal)}</span></div>
            <div>清单差值：<span className="font-mono">{fmt(validation.diff)}</span>元</div>
            {validation.targetProjectTotal !== undefined && (
              <div>目标投标总价：<span className="font-mono">{fmt(validation.targetProjectTotal)}</span></div>
            )}
            {validation.projectTotal !== undefined && (
              <div>公式重算完整造价：<span className="font-mono">{fmt(validation.projectTotal)}</span></div>
            )}
            {validation.projectDiff !== undefined && (
              <div>
                完整总价差：
                <span className={`font-mono ${validation.projectDiff <= 0 && Math.abs(validation.projectDiff) <= (validation.tolerance ?? 200) ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}`}>
                  {' '}{fmt(validation.projectDiff)}元
                </span>
              </div>
            )}
            <div>目标总价窗口：<span className="font-mono">低于目标 0 ~ {fmt(validation.tolerance ?? 200)} 元</span></div>
            {validation.toleranceRule && (
              <div className="col-span-2 text-muted-foreground">验收规则：{validation.toleranceRule}</div>
            )}
            <div>统一缩放因子：<span className="font-mono">{validation.bestScaleFactor === 1 ? '未启用' : validation.bestScaleFactor?.toFixed(6)}</span></div>
            {validation.rangeCompliantCount !== undefined && (
              <div>范围合规清单：<span className="font-mono">{validation.rangeCompliantCount}</span>项</div>
            )}
            {validation.rangeViolationCount !== undefined && (
              <div>范围违规清单：<span className="font-mono">{validation.rangeViolationCount}</span>项</div>
            )}
            {validation.itemTotalAbsDiff !== undefined && (
              <div>清单总偏差：<span className="font-mono">{fmt(validation.itemTotalAbsDiff)}</span>元</div>
            )}
            {validation.selectedReason && (
              <div className="col-span-2 text-muted-foreground">选择依据：{validation.selectedReason}</div>
            )}
          </div>
        </div>
      )}

      {level3 && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setResultTab('summary')}
              className={`text-xs px-3 py-1.5 rounded ${resultTab === 'summary' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              调价配平后清单总价
            </button>
            <button
              onClick={() => setResultTab('details')}
              className={`text-xs px-3 py-1.5 rounded ${resultTab === 'details' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              调价配平后清单明细（{filteredAdjustedItems.length}/{adjustedItems.length}项）
            </button>
            <button
              onClick={() => setResultTab('resources')}
              className={`text-xs px-3 py-1.5 rounded ${resultTab === 'resources' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              工料机价格调整（{filteredResourceRows.length}/{resourceRows.length}项）
            </button>
          </div>

          {resultTab === 'summary' ? (
            <div className="space-y-4">
              <div className="border border-border rounded overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-sm font-medium">调价配平后清单总价</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="px-2 py-1.5 text-left">序号</th>
                        <th className="px-2 py-1.5 text-left">汇总内容</th>
                        <th className="px-2 py-1.5 text-right">限价金额</th>
                        <th className="px-2 py-1.5 text-right">调价后金额</th>
                        <th className="px-2 py-1.5 text-right">下浮率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjustedTotalRows.map((row, index) => (
                        <tr key={index} className="border-t border-border">
                          <td className="px-2 py-1">{row[0]}</td>
                          <td className="px-2 py-1">{row[1]}</td>
                          <td className="px-2 py-1 text-right font-mono">{row[0] && row[2] > 0 ? fmt(row[2]) : '-'}</td>
                          <td className="px-2 py-1 text-right font-mono">{row[0] && row[3] > 0 ? fmt(row[3]) : '-'}</td>
                          <td className="px-2 py-1 text-right font-mono">
                            {row[0] && row[4] != null ? `${(row[4] * 100).toFixed(2)}%` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : resultTab === 'details' ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button type="button" onClick={() => setDetailFilters({})} className="rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80">
                  清除全部筛选
                </button>
              </div>
              <div className="border border-border rounded overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-sm font-medium">调价配平后清单明细</div>
                <div className="overflow-x-auto">
                  <table
                    className="text-xs"
                    style={{
                      tableLayout: 'fixed',
                      width: DETAIL_COLUMNS.reduce((sum, column) => sum + (detailColumnWidths[column.key] ?? column.width), 0),
                    }}
                  >
                    <colgroup>
                      {DETAIL_COLUMNS.map((column) => (
                        <col key={column.key} style={{ width: detailColumnWidths[column.key] ?? column.width }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="bg-muted/50">
                        {DETAIL_COLUMNS.map(renderDetailFilterHeader)}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAdjustedItems.length > 0 ? (
                        filteredAdjustedItems.map((item) => (
                          <tr
                            key={`${item.category}-${item.row}`}
                            className={`border-t border-border ${item.rangeCompliant === false ? 'bg-yellow-50' : ''}`}
                            title={item.rangeCompliant === false ? '下浮率未在目标下浮率范围内' : undefined}
                          >
                            <td className="px-2 py-1 whitespace-normal break-words">{item.category}</td>
                            <td className="px-2 py-1 font-mono whitespace-normal break-words">{item.code}</td>
                            <td className="px-2 py-1 whitespace-normal break-words">{item.name}</td>
                            <td className="px-2 py-1 text-center">{item.isScreeningItem ? '是' : '否'}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(item.quantity)}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(item.maxUnitPrice)}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(item.maxTotalPrice)}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(item.targetUnitPrice)}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(item.adjustedUnitPrice)}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(item.adjustedTotalPrice)}</td>
                            <td className="px-2 py-1 text-right font-mono">{(item.discountRate * 100).toFixed(2)}%</td>
                            <td className="px-2 py-1 text-right font-mono whitespace-normal break-words">{formatTargetDiscountRange(item)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t border-border">
                          <td colSpan={DETAIL_COLUMNS.length} className="px-3 py-6 text-center text-muted-foreground">
                            没有符合当前筛选条件的清单明细。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-xs mb-2 text-muted-foreground">
                基准清单合价：<span className="font-mono">{fmt(level3.baseTotal)}</span>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">是否固定：</span>
                <button type="button" onClick={() => setAllFixed(true)} className="rounded bg-muted px-2 py-1 hover:bg-muted/80">
                  全选固定
                </button>
                <button type="button" onClick={() => setAllFixed(false)} className="rounded bg-muted px-2 py-1 hover:bg-muted/80">
                  全不选固定
                </button>
                <button type="button" onClick={() => setResourceFilters({})} className="rounded bg-muted px-2 py-1 hover:bg-muted/80">
                  清除全部筛选
                </button>
              </div>
              <div className="overflow-x-auto border border-border rounded">
                <table
                  className="text-xs"
                  style={{
                    tableLayout: 'fixed',
                    width: RESOURCE_COLUMNS.reduce((sum, column) => sum + (resourceColumnWidths[column.key] ?? column.width), 0),
                  }}
                >
                  <colgroup>
                    {RESOURCE_COLUMNS.map((column) => (
                      <col key={column.key} style={{ width: resourceColumnWidths[column.key] ?? column.width }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-muted/50">
                      {RESOURCE_COLUMNS.map(renderResourceFilterHeader)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResourceRows.length > 0 ? (
                      filteredResourceRows.map(({ row: pc, originalIndex }) => (
                        <tr key={`${pc.code}-${pc.row}-${originalIndex}`} className="border-t border-border">
                          <td className="px-2 py-1 font-mono">{pc.code}</td>
                          <td className="px-2 py-1">{pc.name}</td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {pc.isAdjustable ? '自动调价' : pc.reviewReason || '仅显示/人工复核'}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">{fmt(pc.originalPrice)}</td>
                          <td className="px-2 py-1 text-right font-mono">
                            <input
                              type="number"
                              step="0.01"
                              value={Number.isFinite(pc.adjustedPrice) ? pc.adjustedPrice : 0}
                              onFocus={(event) => event.currentTarget.select()}
                              onClick={(event) => event.currentTarget.select()}
                              onChange={(event) => updatePriceChange(originalIndex, { adjustedPrice: Number(event.target.value) || 0 })}
                              className="w-24 rounded border border-border bg-background px-1 py-0.5 text-right font-mono"
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(pc.fixed)}
                              onChange={(event) => updatePriceChange(originalIndex, { fixed: event.target.checked })}
                            />
                          </td>
                          <td className="px-2 py-1 text-right font-mono">{fmt(pc.diff)}</td>
                          <td className="px-2 py-1 text-right font-mono">{((pc.diffPercent ?? 0) * 100).toFixed(1)}%</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t border-border">
                        <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                          暂未生成工料机价格调整数据。请检查步骤2文件是否有“工料机汇总表”，以及清单是否能匹配到可调的人工、材料、机械资源。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
