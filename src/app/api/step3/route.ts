import { NextRequest, NextResponse } from 'next/server';
import { pathToFileURL } from 'url';
import * as XLSX from 'xlsx';
import { PDFParse } from 'pdf-parse';
import { getPath as getPdfWorkerPath } from 'pdf-parse/worker';

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
  source?: 'pdf' | 'excel';
}

interface LimitPdfParseResult {
  total: number;
  items: LimitItem[];
}

function toNum(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
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

function getDeviationLevel(rate: number): string {
  if (rate >= 0.20) return '控制价明显偏高';
  if (rate >= 0.10) return '控制价偏高';
  if (rate >= -0.10) return '基本接近';
  if (rate >= -0.20) return '控制价偏低';
  return '控制价明显偏低/疑似已压价';
}

function extractCategory(sheetName: string): string {
  const match = sheetName.match(/【(.+)】/);
  return match?.[1]?.trim() || sheetName;
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

    const row = toNum(head[1]);
    const code = normalizeCode(head[2]);
    const name = head[3].trim();
    const tail = block.match(/([^\s\d]+)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s+[0-9][0-9,]*(?:\.[0-9]+)?)?\s*$/i);
    if (!tail) return;

    const unit = tail[1];
    const quantity = toNum(tail[2]);
    const maxUnitPrice = toNum(tail[3]);
    const maxTotalPrice = toNum(tail[4]);

    if (row > 0 && code && name && quantity > 0 && maxUnitPrice > 0 && maxTotalPrice > 0) {
      items.push({
        row,
        category: currentCategory,
        code,
        name,
        unit,
        quantity,
        maxUnitPrice,
        maxTotalPrice,
        source: 'pdf',
      });
    }
  };

  for (const line of lines) {
    const categoryMatch = line.match(/^工程名称：(.+)/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
    }

    if (/^\d+\s+\d{9,12}\s+/.test(line)) {
      flush();
      currentBlock = [line];
      continue;
    }

    if (/^(本页小计|合\s*计|-- \d+ of \d+ --)/.test(line)) {
      flush();
      continue;
    }

    if (currentBlock.length > 0) {
      currentBlock.push(line);
    }
  }

  flush();
  return items;
}

async function parseLimitPdf(fileBase64: string): Promise<LimitPdfParseResult> {
  const buffer = Buffer.from(fileBase64, 'base64');
  PDFParse.setWorker(pathToFileURL(getPdfWorkerPath()).href);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    const text = result.text;
    return {
      total: extractLimitTotalFromText(text),
      items: parseLimitPdfItems(text),
    };
  } finally {
    await parser.destroy();
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bidItems, limitBillFileBase64, limitPdfBase64 } = body as {
      bidItems?: BidItemInput[];
      limitBillFileBase64?: string;
      limitPdfBase64?: string;
    };

    if (!bidItems?.length) {
      return NextResponse.json({ success: false, error: '请先完成步骤2清单组价，生成我方清单数据' }, { status: 400 });
    }
    if (!limitBillFileBase64) {
      return NextResponse.json({ success: false, error: '请上传表3 分部分项工程量清单计价表' }, { status: 400 });
    }
    if (!limitPdfBase64) {
      return NextResponse.json({ success: false, error: '请上传最高投标限价PDF文件' }, { status: 400 });
    }

    const limitItems = parseLimitBillExcel(limitBillFileBase64);
    if (limitItems.length === 0) {
      return NextResponse.json({ success: false, error: '表3中未识别到限价清单，请确认工作表为“C.6 分部分项工程项目清单计价表【工程名】”格式' }, { status: 400 });
    }

    const limitPdf = await parseLimitPdf(limitPdfBase64);
    const maxPriceTotal = limitPdf.total;
    if (maxPriceTotal <= 0) {
      return NextResponse.json({ success: false, error: '未能从最高投标限价PDF中提取合计金额，请检查PDF是否包含汇总表合计' }, { status: 400 });
    }

    const limitByCode = new Map<string, LimitItem>();
    for (const item of limitItems) {
      limitByCode.set(normalizeCode(item.code), item);
    }
    for (const item of limitPdf.items) {
      limitByCode.set(normalizeCode(item.code), item);
    }

    const compareItems = [];
    const unmatchedOurItems: string[] = [];
    for (const our of bidItems) {
      const limit = limitByCode.get(normalizeCode(our.code));
      if (!limit) {
        unmatchedOurItems.push(`${our.category} ${our.code} ${our.name}`);
        continue;
      }

      const ourUnitPrice = toNum(our.unitPrice);
      const ourTotalPrice = toNum(our.totalPrice);
      const maxUnitPrice = limit.maxUnitPrice;
      const maxTotalPrice = limit.maxTotalPrice;
      const deviationRate = ourUnitPrice > 0 ? (maxUnitPrice - ourUnitPrice) / ourUnitPrice : 0;

      compareItems.push({
        row: our.row,
        category: our.category || limit.category,
        code: normalizeCode(our.code),
        name: our.name,
        unit: our.unit || limit.unit,
        quantity: toNum(our.quantity),
        ourUnitPrice,
        ourTotalPrice,
        maxUnitPrice,
        maxTotalPrice,
        limitPriceSource: limit.source || 'excel',
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
    const unmatchedLimitItems = limitItems
      .filter((item) => !ourCodes.has(normalizeCode(item.code)))
      .map((item) => `${item.category} ${item.code} ${item.name}`);

    const stats = {
      totalItems: compareItems.length,
      limitItems: limitItems.length,
      pdfLimitItems: limitPdf.items.length,
      excelFallbackItems: compareItems.filter((i) => i.limitPriceSource === 'excel').length,
      unmatchedOurCount: unmatchedOurItems.length,
      unmatchedLimitCount: unmatchedLimitItems.length,
      screeningItems: compareItems.filter((i) => i.isScreeningItem).length,
      highDeviation: compareItems.filter((i) => Math.abs(i.deviationRate) >= 0.20).length,
      mediumDeviation: compareItems.filter((i) => Math.abs(i.deviationRate) >= 0.10 && Math.abs(i.deviationRate) < 0.20).length,
      lowDeviation: compareItems.filter((i) => Math.abs(i.deviationRate) < 0.10).length,
      averageDeviation: compareItems.length > 0
        ? compareItems.reduce((sum, i) => sum + i.deviationRate, 0) / compareItems.length
        : 0,
    };

    return NextResponse.json({
      success: true,
      compareItems,
      stats,
      maxPriceTotal,
      unmatchedOurItems,
      unmatchedLimitItems,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
