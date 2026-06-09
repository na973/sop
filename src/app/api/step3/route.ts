import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';

export const runtime = 'nodejs';

/** 动态导入pdf-parse，避免构建时问题 */
async function parsePdfText(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('pdf-parse');
    const fn = mod.default || mod;
    const data = await fn(buffer);
    return data.text || '';
  } catch {
    return '';
  }
}

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
  source?: 'pdf' | 'excel' | 'summary';
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

/** 解析表3 Excel限价清单 */
function parseLimitBillExcel(fileBase64: string): LimitItem[] {
  const buffer = Buffer.from(fileBase64, 'base64');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const items: LimitItem[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (!sheetName.includes('分部分项') && !sheetName.includes('清单计价')) continue;
    const ws = workbook.Sheets[sheetName];
    if (!ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const category = sheetName.includes('道路') ? '道路工程' : sheetName.includes('桥梁') ? '桥梁工程' : sheetName.includes('排水') ? '排水工程' : '';

    for (let r = range.s.r; r <= range.e.r; r++) {
      const codeCell = ws[XLSX.utils.encode_cell({ r, c: 0 })] || ws[XLSX.utils.encode_cell({ r, c: 1 })];
      const nameCell = ws[XLSX.utils.encode_cell({ r, c: 2 })] || ws[XLSX.utils.encode_cell({ r, c: 3 })];
      const qtyCell = ws[XLSX.utils.encode_cell({ r, c: 4 })] || ws[XLSX.utils.encode_cell({ r, c: 5 })];
      const priceCell = ws[XLSX.utils.encode_cell({ r, c: 6 })] || ws[XLSX.utils.encode_cell({ r, c: 7 })];
      const totalCell = ws[XLSX.utils.encode_cell({ r, c: 8 })] || ws[XLSX.utils.encode_cell({ r, c: 9 })];
      if (!codeCell || !priceCell) continue;
      const code = normalizeCode(String(codeCell.v || ''));
      if (!/^\d{9,}/.test(code)) continue;
      const maxUnitPrice = toNum(priceCell.v);
      const maxTotalPrice = toNum(totalCell?.v);
      if (maxUnitPrice <= 0) continue;
      items.push({
        row: r + 1,
        category,
        code,
        name: String(nameCell?.v || '').trim(),
        unit: '',
        quantity: toNum(qtyCell?.v),
        maxUnitPrice,
        maxTotalPrice,
        source: 'excel',
      });
    }
  }
  return items;
}

/** 解析最高投标限价PDF */
async function parseLimitPdf(fileBase64: string): Promise<LimitPdfParseResult> {
  const buffer = Buffer.from(fileBase64, 'base64');
  const text = normalizePdfText(await parsePdfText(buffer));
  const items: LimitItem[] = [];

  // 提取合计金额
  let total = 0;
  const totalPatterns = [
    /最高投标限价[合计总]*[金额]*[：:\s]*([0-9,]+\.?\d*)/,
    /限价合计[：:\s]*([0-9,]+\.?\d*)/,
    /投标总价[：:\s]*([0-9,]+\.?\d*)/,
    /合计[：:\s]*([0-9,]+\.?\d*)/,
  ];
  for (const p of totalPatterns) {
    const m = text.match(p);
    if (m) { total = toNum(m[1]); if (total > 0) break; }
  }

  // 提取分部分项限价明细
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let currentCategory = '';
  for (const line of lines) {
    if (line.includes('道路工程')) currentCategory = '道路工程';
    else if (line.includes('桥梁工程')) currentCategory = '桥梁工程';
    else if (line.includes('排水工程')) currentCategory = '排水工程';

    const codeMatch = line.match(/(\d{9,})\s+(.+?)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/);
    if (codeMatch) {
      items.push({
        row: items.length + 1,
        category: currentCategory,
        code: normalizeCode(codeMatch[1]),
        name: codeMatch[2].trim(),
        unit: '',
        quantity: toNum(codeMatch[3]),
        maxUnitPrice: toNum(codeMatch[4]),
        maxTotalPrice: toNum(codeMatch[3]) * toNum(codeMatch[4]),
        source: 'pdf',
      });
    }
  }

  return { total, items };
}

function getDeviationLevel(rate: number): string {
  const abs = Math.abs(rate);
  if (abs >= 0.20) return rate > 0 ? '明显偏高' : '明显偏低';
  if (abs >= 0.10) return rate > 0 ? '偏高' : '偏低';
  return '基本接近';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bidItems, limitBillFileBase64, limitPdfBase64, maxPriceTotal: inputMaxPriceTotal, table7FileBase64, filePath } = body as {
      bidItems?: BidItemInput[];
      limitBillFileBase64?: string;
      limitPdfBase64?: string;
      maxPriceTotal?: number;
      table7FileBase64?: string;
      filePath?: string;
    };

    if (!bidItems?.length) {
      return NextResponse.json({ success: false, error: '请先完成步骤2清单组价，生成我方清单数据' }, { status: 400 });
    }

    let limitItems: LimitItem[] = [];
    let maxPriceTotal = inputMaxPriceTotal || 0;
    let limitPriceSource = 'none';

    // Mode 1: Upload limit bill Excel + limit PDF (full-featured)
    if (limitBillFileBase64) {
      limitItems = parseLimitBillExcel(limitBillFileBase64);
      if (limitItems.length === 0) {
        return NextResponse.json({ success: false, error: '表3中未识别到限价清单，请确认工作表格式' }, { status: 400 });
      }
      limitPriceSource = 'excel';

      if (limitPdfBase64) {
        const limitPdf = await parseLimitPdf(limitPdfBase64);
        if (limitPdf.total > 0) maxPriceTotal = limitPdf.total;
        for (const item of limitPdf.items) {
          limitItems.push(item);
        }
        limitPriceSource = 'excel+pdf';
      }
    }
    // Mode 2: Fallback - use table7 file + maxPriceTotal (simpler workflow)
    else if (table7FileBase64 || filePath) {
      let arrayBuffer: ArrayBuffer;
      if (filePath) {
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
        arrayBuffer = new Uint8Array(await fs.readFile(absPath)).buffer;
      } else {
        arrayBuffer = Uint8Array.from(atob(table7FileBase64!), (c) => c.charCodeAt(0)).buffer;
      }

      const workbook = await readExcelToWorkbook(arrayBuffer);
      const { workbook: calcWb } = calculateWorkbook(workbook);
      const summarySheet = calcWb.get('汇总表');
      if (summarySheet) {
        const getCellVal = (key: string) => {
          const cell = summarySheet.get(key);
          return cell?.value != null ? toNum(cell.value) : 0;
        };
        if (maxPriceTotal <= 0) {
          maxPriceTotal = getCellVal('4,3') + getCellVal('5,3') + getCellVal('6,3');
        }
        // Build limit items from summary sheet category totals
        const categories = [
          { category: '道路工程', c4Row: 4 },
          { category: '桥梁工程', c4Row: 5 },
          { category: '排水工程', c4Row: 6 },
        ];
        for (const cat of categories) {
          const catMaxTotal = getCellVal(`${cat.c4Row},3`);
          if (catMaxTotal > 0) {
            const catOurTotal = bidItems
              .filter((item) => item.category === cat.category)
              .reduce((sum, item) => sum + toNum(item.totalPrice), 0);
            const ratio = catOurTotal > 0 ? catMaxTotal / catOurTotal : 1;
            for (const item of bidItems.filter((i) => i.category === cat.category)) {
              limitItems.push({
                row: item.row,
                category: cat.category,
                code: normalizeCode(item.code),
                name: item.name,
                unit: item.unit || '',
                quantity: toNum(item.quantity),
                maxUnitPrice: toNum(item.unitPrice) * ratio,
                maxTotalPrice: toNum(item.totalPrice) * ratio,
                source: 'summary',
              });
            }
          }
        }
      }
      limitPriceSource = 'summary';
    }
    else if (maxPriceTotal > 0) {
      // Mode 3: Only maxPriceTotal provided, no file - use uniform ratio
      const ourTotal = bidItems.reduce((sum, item) => sum + toNum(item.totalPrice), 0);
      const ratio = ourTotal > 0 ? maxPriceTotal / ourTotal : 1;
      for (const item of bidItems) {
        limitItems.push({
          row: item.row,
          category: item.category,
          code: normalizeCode(item.code),
          name: item.name,
          unit: item.unit || '',
          quantity: toNum(item.quantity),
          maxUnitPrice: toNum(item.unitPrice) * ratio,
          maxTotalPrice: toNum(item.totalPrice) * ratio,
          source: 'summary' as const,
        });
      }
      limitPriceSource = 'manual_input';
    }
    else {
      return NextResponse.json({ success: false, error: '请上传限价文件、报价文件或手动输入限价金额' }, { status: 400 });
    }

    if (maxPriceTotal <= 0) {
      return NextResponse.json({ success: false, error: '无法确定最高限价合计，请上传限价PDF或手动输入限价金额' }, { status: 400 });
    }

    const limitByCode = new Map<string, LimitItem>();
    for (const item of limitItems) {
      limitByCode.set(normalizeCode(item.code), item);
    }

    const compareItems = [];
    const unmatchedOurItems: string[] = [];
    for (const our of bidItems) {
      const limit = limitByCode.get(normalizeCode(our.code));
      if (!limit) {
        unmatchedOurItems.push(`${our.category} ${our.code} ${our.name}`);
        const ourUnitPrice = toNum(our.unitPrice);
        compareItems.push({
          row: our.row,
          category: our.category,
          code: normalizeCode(our.code),
          name: our.name,
          unit: our.unit || '',
          quantity: toNum(our.quantity),
          ourUnitPrice,
          ourTotalPrice: toNum(our.totalPrice),
          maxUnitPrice: ourUnitPrice,
          maxTotalPrice: toNum(our.totalPrice),
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
        limitPriceSource: limit.source || limitPriceSource,
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
      limitPriceSource,
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
