import { NextRequest, NextResponse } from 'next/server';
import { pathToFileURL } from 'url';
import * as XLSX from 'xlsx';
import { PDFParse } from 'pdf-parse';
import { getPath as getPdfWorkerPath } from 'pdf-parse/worker';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import { getAnalysisSheets, getMainRows } from '@/lib/bidding/excel-sheets';
import type { CellValue } from '@/lib/formula-engine/types';

export const runtime = 'nodejs';

interface BidItemInput {
  row: number;
  category: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface LimitItem {
  row: number;
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
  limitPriceSource: 'pdf' | 'excel' | 'summary' | 'none';
  limitQuantity: number;
  limitName: string;
  quantityDiff: number;
  nameMatched: boolean;
  deviationRate: number;
  deviationLevel: string;
  isScreeningItem: boolean;
  itemReviewPrice?: number;
  screeningRank?: number;
  screeningBasis?: string;
  isAbnormalBidItem?: boolean;
}

function toNum(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  if (v instanceof Error) return 0;
  return 0;
}

function normalizeCode(code: string): string {
  return String(code || '').replace(/\s+/g, '').trim();
}

function normalizeText(text: string): string {
  return String(text || '').replace(/\s+/g, '').trim();
}

function normalizePdfText(text: string): string {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function extractCategory(sheetName: string): string {
  const match = sheetName.match(/【(.+)】/);
  return match?.[1]?.trim() || sheetName;
}

function getDeviationLevel(rate: number): string {
  if (rate >= 0.20) return '控制价明显偏高';
  if (rate >= 0.10) return '控制价偏高';
  if (rate >= -0.10) return '基本接近';
  if (rate >= -0.20) return '控制价偏低';
  return '控制价明显偏低/疑似已压价';
}

async function parseBidItemsFromPricingExcel(fileBase64: string): Promise<BidItemInput[]> {
  const buffer = Buffer.from(fileBase64, 'base64');
  const workbook = await readExcelToWorkbook(new Uint8Array(buffer).buffer);
  const { workbook: calcWb } = calculateWorkbook(workbook);
  const items: BidItemInput[] = [];

  for (const cat of getAnalysisSheets(calcWb)) {
    const sheet = cat.data;
    for (const row of getMainRows(sheet)) {
      const code = normalizeCode(String(sheet.get(`${row},2`)?.value ?? ''));
      const name = String(sheet.get(`${row},3`)?.value ?? '').trim();
      const quantity = toNum(sheet.get(`${row},5`)?.value);
      const unitPrice = toNum(sheet.get(`${row},6`)?.value);
      const totalPrice = toNum(sheet.get(`${row},7`)?.value);
      if (!code || !name) continue;
      items.push({
        row,
        category: cat.category,
        code,
        name,
        unit: String(sheet.get(`${row},4`)?.value ?? '').trim(),
        quantity,
        unitPrice,
        totalPrice,
      });
    }
  }

  return items;
}

function parseLimitBillExcel(fileBase64: string): LimitItem[] {
  const buffer = Buffer.from(fileBase64, 'base64');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: false });
  const items: LimitItem[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (!/分部分项工程.*清单计价表/.test(sheetName)) continue;

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false });
    const category = extractCategory(sheetName);

    rows.forEach((row, index) => {
      const serial = toNum(row[0]);
      const code = normalizeCode(String(row[1] ?? ''));
      const name = String(row[2] ?? '').trim();
      const unit = String(row[5] ?? '').trim();
      const quantity = toNum(row[6]);
      const maxUnitPrice = toNum(row[7]);
      const maxTotalPrice = toNum(row[8]);

      if (serial > 0 && code && name && quantity > 0 && (maxUnitPrice > 0 || maxTotalPrice > 0)) {
        items.push({
          row: index + 1,
          category,
          code,
          name,
          unit,
          quantity,
          maxUnitPrice: maxUnitPrice > 0 ? maxUnitPrice : maxTotalPrice / quantity,
          maxTotalPrice: maxTotalPrice > 0 ? maxTotalPrice : maxUnitPrice * quantity,
          source: 'excel',
        });
      }
    });
  }

  return items;
}

function extractLimitTotalFromText(text: string): number {
  const summaryIndex = text.indexOf('汇总表');
  const searchText = summaryIndex >= 0 ? text.slice(summaryIndex, summaryIndex + 2500) : text;
  const patterns = [
    /合计\s*=\s*1\s*\+\s*2\s*\+\s*3\s*\+\s*4\s*([0-9][0-9,]*(?:\.[0-9]+)?)/,
    /合\s*计\s*([0-9][0-9,]*(?:\.[0-9]+)?)/,
    /最高投标限价[\s\S]{0,300}?([0-9][0-9,]*(?:\.[0-9]+)?)/,
  ];

  for (const pattern of patterns) {
    const match = searchText.match(pattern) || text.match(pattern);
    const value = toNum(match?.[1]);
    if (value > 10000) return value;
  }

  return 0;
}

function nearlyEqual(a: number, b: number, toleranceRate = 0.01): boolean {
  if (a === 0 && b === 0) return true;
  const tolerance = Math.max(0.05, Math.abs(b) * toleranceRate);
  return Math.abs(a - b) <= tolerance;
}

function parsePdfBlockByMath(block: string, quantityHint = 0): { quantity: number; maxUnitPrice: number; maxTotalPrice: number } | null {
  const numbers = Array.from(block.matchAll(/[0-9][0-9,]*(?:\.[0-9]+)?/g)).map((match) => toNum(match[0]));

  for (let i = 0; i <= numbers.length - 3; i++) {
    const quantity = numbers[i];
    const maxUnitPrice = numbers[i + 1];
    const maxTotalPrice = numbers[i + 2];
    if (quantity <= 0 || maxUnitPrice <= 0 || maxTotalPrice <= 0) continue;
    if (quantityHint > 0 && !nearlyEqual(quantity, quantityHint, 0.005)) continue;
    if (nearlyEqual(quantity * maxUnitPrice, maxTotalPrice, 0.02)) {
      return { quantity, maxUnitPrice, maxTotalPrice };
    }
  }

  return null;
}

function parseLimitPdfItemsWithHints(text: string, hints: LimitItem[]): LimitItem[] {
  if (!hints.length) return [];

  const normalizedText = normalizePdfText(text);
  const sortedHints = hints
    .map((hint) => ({ ...hint, code: normalizeCode(hint.code) }))
    .filter((hint) => hint.code)
    .sort((a, b) => normalizedText.indexOf(a.code) - normalizedText.indexOf(b.code));

  const items: LimitItem[] = [];
  for (const hint of sortedHints) {
    const start = normalizedText.indexOf(hint.code);
    if (start < 0) continue;

    let end = normalizedText.length;
    for (const next of sortedHints) {
      if (next.code === hint.code) continue;
      const nextIndex = normalizedText.indexOf(next.code, start + hint.code.length);
      if (nextIndex > start && nextIndex < end) end = nextIndex;
    }

    const pageBreak = normalizedText.indexOf('本页小计', start);
    if (pageBreak > start && pageBreak < end) end = pageBreak;

    const block = normalizedText.slice(start, Math.min(end, start + 1800));
    const parsed = parsePdfBlockByMath(block, hint.quantity);
    if (!parsed) continue;

    items.push({
      ...hint,
      quantity: parsed.quantity,
      maxUnitPrice: parsed.maxUnitPrice,
      maxTotalPrice: parsed.maxTotalPrice,
      source: 'pdf',
    });
  }

  return items;
}

function parseLimitPdfItems(text: string): LimitItem[] {
  const lines = normalizePdfText(text).split('\n').map((line) => line.trim()).filter(Boolean);
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
    const categoryMatch = line.match(/^工程名称：(.+)/);
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

async function parseLimitPdf(fileBase64: string, hints: LimitItem[] = []): Promise<{ total: number; items: LimitItem[] }> {
  const buffer = Buffer.from(fileBase64, 'base64');
  PDFParse.setWorker(pathToFileURL(getPdfWorkerPath()).href);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    const text = result.text;
    const hintedItems = parseLimitPdfItemsWithHints(text, hints);
    return {
      total: extractLimitTotalFromText(text),
      items: hintedItems.length > 0 ? hintedItems : parseLimitPdfItems(text),
    };
  } finally {
    await parser.destroy();
  }
}

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

function getScreeningCount(totalItems: number): number {
  return Math.max(1, Math.ceil(totalItems * 0.3));
}

function applyBidReviewScreening<T extends {
  code: string;
  maxTotalPrice: number;
  maxUnitPrice: number;
  quantity: number;
  ourUnitPrice: number;
  isScreeningItem: boolean;
}>(items: T[]): T[] {
  const sorted = [...items]
    .map((item, index) => ({
      item,
      index,
      itemReviewPrice: item.maxTotalPrice > 0 ? item.maxTotalPrice : item.maxUnitPrice * item.quantity,
    }))
    .sort((a, b) => b.itemReviewPrice - a.itemReviewPrice);
  const screeningCount = getScreeningCount(items.length);
  const screeningIndexByCode = new Map(sorted.slice(0, screeningCount).map((entry, index) => [normalizeCode(entry.item.code), index + 1]));

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
        ? `按评标规则B项：子目评审价排序前30%（第${screeningRank}/${items.length}项）`
        : '未进入子目评审价排序前30%',
      isAbnormalBidItem: Boolean(screeningRank && relativeDeviation > 0.3),
      isScreeningItem: Boolean(screeningRank),
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      bidItems: inputBidItems,
      table7FileBase64,
      limitBillFileBase64,
      limitPdfBase64,
      maxPriceTotal: inputMaxPriceTotal,
    } = body as {
      bidItems?: BidItemInput[];
      table7FileBase64?: string;
      limitBillFileBase64?: string;
      limitPdfBase64?: string;
      maxPriceTotal?: number;
    };

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
    const limitBillItems = limitBillFileBase64 ? parseLimitBillExcel(limitBillFileBase64) : [];

    for (const item of limitBillItems) {
      limitByCode.set(normalizeCode(item.code), item);
    }

    if (limitPdfBase64) {
      const limitPdf = await parseLimitPdf(limitPdfBase64, limitBillItems);
      if (limitPdf.total > 0) maxPriceTotal = limitPdf.total;
      for (const item of limitPdf.items) {
        // PDF contains the real control comprehensive unit price, so it wins over table 3.
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

    const screenedCompareItems = applyBidReviewScreening(compareItems);

    return NextResponse.json({
      success: true,
      compareItems: screenedCompareItems,
      items: screenedCompareItems,
      stats: {
        totalItems: screenedCompareItems.length,
        limitItems: limitByCode.size,
        pdfItems: screenedCompareItems.filter((item) => item.limitPriceSource === 'pdf').length,
        excelItems: screenedCompareItems.filter((item) => item.limitPriceSource === 'excel').length,
        summaryItems: screenedCompareItems.filter((item) => item.limitPriceSource === 'summary').length,
        unmatchedOurCount: unmatchedOurItems.length,
        unmatchedLimitCount: unmatchedLimitItems.length,
        screeningRule: '评标规则B项：子目评审价排序前30%，相对偏差绝对值>30%为异常报价项',
        screeningItems: screenedCompareItems.filter((item) => item.isScreeningItem).length,
        abnormalBidItems: screenedCompareItems.filter((item) => item.isAbnormalBidItem).length,
      },
      maxPriceTotal,
      unmatchedOurItems,
      unmatchedLimitItems,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
