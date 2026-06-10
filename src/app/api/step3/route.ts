import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/* ────────────────────────── types ────────────────────────── */

interface BidItemInput {
  row: number;
  category: string;
  code: string;
  name: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface LimitItem {
  row?: number;
  category: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  maxUnitPrice: number;
  maxTotalPrice: number;
  source: 'pdf' | 'excel' | 'summary';
}

interface CompareItemResult {
  row: number;
  category: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  ourUnitPrice: number;
  ourTotalPrice: number;
  maxUnitPrice: number;
  maxTotalPrice: number;
  limitPriceSource: string;
  limitQuantity: number;
  limitName: string;
  quantityDiff: number;
  nameMatched: boolean;
  deviationRate: number;
  deviationLevel: string;
  isScreeningItem: boolean;
  screeningRank?: number;
  screeningBasis?: string;
  isAbnormalBidItem?: boolean;
  itemReviewPrice?: number;
}

/* ────────────────────────── helpers ────────────────────────── */

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function normalizeCode(code: string): string {
  return String(code).replace(/[\s\-]/g, '');
}

function normalizeText(t: string): string {
  return t.replace(/\s+/g, '');
}

function getDeviationLevel(rate: number): string {
  const abs = Math.abs(rate);
  if (abs > 0.20) return rate > 0 ? '明显偏高' : '明显偏低';
  if (abs > 0.10) return rate > 0 ? '偏高' : '偏低';
  return '基本接近';
}

/* ────────────────────────── Excel parsers ────────────────────────── */

async function parseBidItemsFromPricingExcel(fileBase64: string): Promise<BidItemInput[]> {
  const buffer = Buffer.from(fileBase64, 'base64');
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);
  const items: BidItemInput[] = [];

  for (const sheet of wb.worksheets) {
    const name = sheet.name;
    if (!name.includes('综合单价分析表')) continue;
    const category = name.includes('道路') ? '道路工程' : name.includes('桥梁') ? '桥梁工程' : name.includes('排水') ? '排水工程' : name;

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const code = String(row.getCell(2).value ?? '').trim();
      if (!code || !/^\d{9,12}$/.test(normalizeCode(code))) continue;
      items.push({
        row: r,
        category,
        code: normalizeCode(code),
        name: String(row.getCell(3).value ?? '').trim(),
        unit: String(row.getCell(4).value ?? '').trim(),
        quantity: toNum(row.getCell(5).value),
        unitPrice: toNum(row.getCell(6).value),
        totalPrice: toNum(row.getCell(7).value),
      });
    }
  }
  return items;
}

function parseLimitBillExcel(fileBase64: string): LimitItem[] {
  const buffer = Buffer.from(fileBase64, 'base64');
  const items: LimitItem[] = [];
  const wb = new ExcelJS.Workbook();
  // Sync read for simplicity in route handler
  try {
    // ExcelJS doesn't support sync read, but this runs in a sync context
    // We'll handle async in the route
  } catch { /* */ }
  return items;
}

async function parseLimitBillExcelAsync(fileBase64: string): Promise<LimitItem[]> {
  const buffer = Buffer.from(fileBase64, 'base64');
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);
  const items: LimitItem[] = [];

  for (const sheet of wb.worksheets) {
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const code = String(row.getCell(2).value ?? '').trim();
      if (!code || !/^\d{9,12}$/.test(normalizeCode(code))) continue;
      items.push({
        row: r,
        category: sheet.name,
        code: normalizeCode(code),
        name: String(row.getCell(3).value ?? '').trim(),
        unit: String(row.getCell(4).value ?? '').trim(),
        quantity: toNum(row.getCell(5).value),
        maxUnitPrice: toNum(row.getCell(6).value),
        maxTotalPrice: toNum(row.getCell(7).value),
        source: 'excel',
      });
    }
  }
  return items;
}

/* ────────────────────────── PDF parser ────────────────────────── */

function normalizePdfText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function extractLimitTotalFromText(text: string): number {
  const patterns = [
    /合\s*计[：:\s]*([0-9][0-9,]*(?:\.[0-9]+)?)/,
    /最[高抵]限价[：:\s]*([0-9][0-9,]*(?:\.[0-9]+)?)/,
    /投标限价[：:\s]*([0-9][0-9,]*(?:\.[0-9]+)?)/,
    /控制价[：:\s]*([0-9][0-9,]*(?:\.[0-9]+)?)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return toNum(m[1]);
  }
  return 0;
}

function parsePdfBlockByMath(block: string): { quantity: number; maxUnitPrice: number; maxTotalPrice: number } | null {
  const nums = block.match(/[0-9][0-9,]*\.\d+/g)?.map((s) => toNum(s)) ?? [];
  if (nums.length < 3) return null;
  const last3 = nums.slice(-3);
  const [a, b, c] = last3;
  if (a > 0 && b > 0 && c > 0 && Math.abs(a * b - c) < c * 0.05) {
    return { quantity: a, maxUnitPrice: b, maxTotalPrice: c };
  }
  if (a > 0 && b > 0 && Math.abs(a * b - c) < c * 0.1) {
    return { quantity: a, maxUnitPrice: b, maxTotalPrice: c };
  }
  return null;
}

function parseLimitPdfItems(text: string): LimitItem[] {
  const lines = normalizePdfText(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const items: LimitItem[] = [];
  let currentCategory = '';
  let currentBlock: string[] = [];

  const flush = () => {
    if (currentBlock.length === 0) return;
    const block = currentBlock.join(' ');
    currentBlock = [];

    const head = block.match(/^(\d+)\s+(\d{9,12})\s+(.+?)\s/);
    if (!head) return;

    const tail = block.match(/([^\s\d]+)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s+[0-9][0-9,]*(?:\.[0-9]+)?)?\s*$/i);
    if (!tail) return;

    const mathParsed = parsePdfBlockByMath(block);
    const quantity = mathParsed?.quantity ?? toNum(tail[2]);
    const maxUnitPrice = mathParsed?.maxUnitPrice ?? toNum(tail[3]);
    const maxTotalPrice = mathParsed?.maxTotalPrice ?? toNum(tail[4]);
    if (quantity <= 0 || maxUnitPrice <= 0 || maxTotalPrice <= 0) return;

    items.push({
      row: toNum(head[1]),
      category: currentCategory,
      code: normalizeCode(head[2]),
      name: head[3].trim(),
      unit: tail[1],
      quantity,
      maxUnitPrice,
      maxTotalPrice,
      source: 'pdf',
    });
  };

  for (const line of lines) {
    const categoryMatch = line.match(/工程名称[：:]\s*(.+)/);
    if (categoryMatch) currentCategory = categoryMatch[1].trim();

    if (/^\d+\s+\d{9,12}\s+/.test(line)) {
      flush();
      currentBlock = [line];
      continue;
    }

    if (/^(本页小计|合\s*计|-- \d+ of \d+ --)/.test(line)) {
      flush();
      continue;
    }

    if (currentBlock.length > 0) currentBlock.push(line);
  }

  flush();
  return items;
}

async function parseLimitPdf(fileBase64: string): Promise<{ total: number; items: LimitItem[] }> {
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item: unknown) => (item as { str?: string }).str ?? '').join(' ');
      pages.push(text);
    }

    const fullText = pages.join('\n');
    return {
      total: extractLimitTotalFromText(fullText),
      items: parseLimitPdfItems(fullText),
    };
  } catch (e) {
    console.error('[Step3] PDF parse error:', e instanceof Error ? e.message : String(e));
    return { total: 0, items: [] };
  }
}

/* ────────────────────────── summary fallback ────────────────────────── */

function buildSummaryLimitItems(bidItems: BidItemInput[], maxPriceTotal: number): LimitItem[] {
  const ourTotal = bidItems.reduce((sum, item) => sum + toNum(item.totalPrice), 0);
  const ratio = ourTotal > 0 ? maxPriceTotal / ourTotal : 1;
  return bidItems.map((item) => ({
    row: item.row,
    category: item.category,
    code: normalizeCode(item.code),
    name: item.name,
    unit: item.unit || '',
    quantity: toNum(item.quantity),
    maxUnitPrice: toNum(item.unitPrice) * ratio,
    maxTotalPrice: toNum(item.totalPrice) * ratio,
    source: 'summary' as const,
  }));
}

/* ────────────────────────── screening ────────────────────────── */

function getScreeningCount(totalItems: number, screeningRatio: number): number {
  return Math.max(1, Math.ceil(totalItems * screeningRatio));
}

function applyBidReviewScreening<T extends {
  code: string;
  maxTotalPrice: number;
  maxUnitPrice: number;
  quantity: number;
  ourUnitPrice: number;
  isScreeningItem: boolean;
}>(items: T[], screeningRatio: number): T[] {
  const sorted = [...items]
    .map((item, index) => ({
      item,
      index,
      itemReviewPrice: item.maxTotalPrice > 0 ? item.maxTotalPrice : item.maxUnitPrice * item.quantity,
    }))
    .sort((a, b) => b.itemReviewPrice - a.itemReviewPrice);
  const screeningCount = getScreeningCount(items.length, screeningRatio);
  const screeningIndexByCode = new Map(sorted.slice(0, screeningCount).map((entry, index) => [normalizeCode(entry.item.code), index + 1]));
  const pctLabel = Math.round(screeningRatio * 100);

  return items.map((item) => {
    const itemReviewPrice = item.maxTotalPrice > 0 ? item.maxTotalPrice : item.maxUnitPrice * item.quantity;
    const screeningRank = screeningIndexByCode.get(normalizeCode(item.code));
    const averageUnitPrice = item.maxUnitPrice;
    const relativeDeviation = averageUnitPrice > 0 ? Math.abs(item.ourUnitPrice - averageUnitPrice) / averageUnitPrice : 0;
    return {
      ...item,
      itemReviewPrice,
      screeningRank,
      screeningBasis: screeningRank
        ? `按评标规则B项：子目评审价排序前${pctLabel}%（第${screeningRank}/${items.length}项）`
        : `未进入子目评审价排序前${pctLabel}%`,
      isAbnormalBidItem: Boolean(screeningRank && relativeDeviation > 0.3),
      isScreeningItem: Boolean(screeningRank),
    };
  });
}

/* ────────────────────────── POST handler ────────────────────────── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      bidItems: inputBidItems,
      table7FileBase64,
      limitBillFileBase64,
      limitPdfBase64,
      maxPriceTotal: inputMaxPriceTotal,
      screeningRatio = 0.3,
    } = body as {
      bidItems?: BidItemInput[];
      table7FileBase64?: string;
      limitBillFileBase64?: string;
      limitPdfBase64?: string;
      maxPriceTotal?: number;
      screeningRatio?: number;
    };

    const effectiveRatio = Math.max(0.01, Math.min(1, toNum(screeningRatio) || 0.3));

    const bidItems = inputBidItems?.length
      ? inputBidItems
      : table7FileBase64
        ? await parseBidItemsFromPricingExcel(table7FileBase64)
        : [];

    if (!bidItems.length) {
      return NextResponse.json({ success: false, error: '请提供我方清单数据：先完成步骤2，或在步骤3上传清单组价表' }, { status: 400 });
    }

    let maxPriceTotal = inputMaxPriceTotal || 0;
    const limitByCode = new Map<string, LimitItem>();
    const limitBillItems = limitBillFileBase64 ? await parseLimitBillExcelAsync(limitBillFileBase64) : [];

    for (const item of limitBillItems) {
      limitByCode.set(normalizeCode(item.code), item);
    }

    if (limitPdfBase64) {
      const limitPdf = await parseLimitPdf(limitPdfBase64);
      if (limitPdf.total > 0) maxPriceTotal = limitPdf.total;
      for (const item of limitPdf.items) {
        limitByCode.set(normalizeCode(item.code), item);
      }
    }

    if (limitByCode.size === 0) {
      if (maxPriceTotal <= 0) {
        return NextResponse.json({ success: false, error: '请上传限价PDF/表3，或手动输入最高投标限价合计' }, { status: 400 });
      }
      for (const item of buildSummaryLimitItems(bidItems, maxPriceTotal)) {
        limitByCode.set(normalizeCode(item.code), item);
      }
    }

    if (maxPriceTotal <= 0) {
      maxPriceTotal = Array.from(limitByCode.values()).reduce((sum, item) => sum + toNum(item.maxTotalPrice), 0);
    }

    const compareItems: CompareItemResult[] = [];
    const unmatchedOurItems: string[] = [];
    for (const our of bidItems) {
      const limit = limitByCode.get(normalizeCode(our.code));
      const ourUnitPrice = toNum(our.unitPrice);
      const ourTotalPrice = toNum(our.totalPrice);

      if (!limit) {
        unmatchedOurItems.push(`${our.category} ${our.code} ${our.name}`);
        compareItems.push({
          row: our.row,
          category: our.category,
          code: normalizeCode(our.code),
          name: our.name,
          unit: our.unit || '',
          quantity: toNum(our.quantity),
          ourUnitPrice,
          ourTotalPrice,
          maxUnitPrice: ourUnitPrice,
          maxTotalPrice: ourTotalPrice,
          limitPriceSource: 'none',
          limitQuantity: toNum(our.quantity),
          limitName: our.name,
          quantityDiff: 0,
          nameMatched: true,
          deviationRate: 0,
          deviationLevel: '无限价数据',
          isScreeningItem: false,
        });
        continue;
      }

      const deviationRate = ourUnitPrice > 0 ? (limit.maxUnitPrice - ourUnitPrice) / ourUnitPrice : 0;
      compareItems.push({
        row: our.row,
        category: our.category || limit.category,
        code: normalizeCode(our.code),
        name: our.name,
        unit: our.unit || limit.unit,
        quantity: toNum(our.quantity),
        ourUnitPrice,
        ourTotalPrice,
        maxUnitPrice: limit.maxUnitPrice,
        maxTotalPrice: limit.maxTotalPrice,
        limitPriceSource: limit.source,
        limitQuantity: limit.quantity,
        limitName: limit.name,
        quantityDiff: toNum(our.quantity) - limit.quantity,
        nameMatched: normalizeText(our.name) === normalizeText(limit.name),
        deviationRate,
        deviationLevel: getDeviationLevel(deviationRate),
        isScreeningItem: Math.abs(deviationRate) >= 0.15,
      });
    }

    const ourCodes = new Set(bidItems.map((item) => normalizeCode(item.code)));
    const unmatchedLimitItems = Array.from(limitByCode.values())
      .filter((item) => !ourCodes.has(normalizeCode(item.code)))
      .map((item) => `${item.category} ${item.code} ${item.name}`);

    const screenedCompareItems = applyBidReviewScreening(compareItems, effectiveRatio);

    return NextResponse.json({
      success: true,
      compareItems: screenedCompareItems,
      items: screenedCompareItems,
      maxPriceTotal,
      screeningRatio: effectiveRatio,
      stats: {
        totalItems: screenedCompareItems.length,
        limitItems: limitByCode.size,
        pdfItems: screenedCompareItems.filter((item) => item.limitPriceSource === 'pdf').length,
        excelItems: screenedCompareItems.filter((item) => item.limitPriceSource === 'excel').length,
        summaryItems: screenedCompareItems.filter((item) => item.limitPriceSource === 'summary').length,
        unmatchedOurCount: unmatchedOurItems.length,
        unmatchedLimitCount: unmatchedLimitItems.length,
        screeningRule: `评标规则B项：子目评审价排序前${Math.round(effectiveRatio * 100)}%，相对偏差绝对值>30%为异常报价项`,
        screeningItems: screenedCompareItems.filter((item) => item.isScreeningItem).length,
        abnormalBidItems: screenedCompareItems.filter((item) => item.isAbnormalBidItem).length,
      },
      unmatchedOurItems,
      unmatchedLimitItems,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
