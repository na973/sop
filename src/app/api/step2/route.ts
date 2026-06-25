import { NextRequest, NextResponse } from 'next/server';
import { readExcelCalculatedValues, readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import type { CellValue } from '@/lib/formula-engine/types';
import { getAnalysisSheets, getMainRows, getNextMainRowOrEnd } from '@/lib/bidding/excel-sheets';
import { buildFormulaWorkbook } from '@/lib/bidding/formula-workbook-export';

type FormulaCell = { value: CellValue | undefined; isFormula: boolean; formula?: string };
type SheetData = Map<string, FormulaCell>;
type CalcWorkbook = Map<string, SheetData>;

export async function POST(request: NextRequest) {
  try {
    let arrayBuffer: ArrayBuffer;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ success: false, error: '请上传清单组价表 Excel 文件' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      arrayBuffer = new Uint8Array(buffer).buffer;
    } else {
      const body = await request.json();
      const { fileBase64 } = body as { fileBase64?: string };
      if (!fileBase64) {
        return NextResponse.json({ success: false, error: '请上传文件或提供 fileBase64' }, { status: 400 });
      }
      const buffer = Buffer.from(fileBase64, 'base64');
      arrayBuffer = new Uint8Array(buffer).buffer;
    }

    // 先补公式，再读取公式版工作簿，让页面显示与导出文件保持同一套计算口径。
    const formulaWorkbook = await buildFormulaWorkbook(arrayBuffer);
    const calculatedBuffer = formulaWorkbook.buffer.buffer.slice(
      formulaWorkbook.buffer.byteOffset,
      formulaWorkbook.buffer.byteOffset + formulaWorkbook.buffer.byteLength,
    ) as ArrayBuffer;
    const calcWb = readExcelCalculatedValues(calculatedBuffer);
    const formulaEngineInput = await readExcelToWorkbook(calculatedBuffer);
    const { workbook: formulaEngineWb, stats: formulaEngineStats } = calculateWorkbook(formulaEngineInput);
    const summarySheet = calcWb.get('汇总表');
    const formulaEngineSummary = extractSummary(formulaEngineWb.get('汇总表'));
    const summary = chooseReliableSummary(formulaEngineSummary, formulaWorkbook.summary);

    return NextResponse.json({
      success: true,
      calculationTime: 'formula cached results loaded',
      formulaExportStats: formulaWorkbook.stats,
      stats: {
        totalFormulas: formulaEngineStats.totalFormulas,
        calculated: formulaEngineStats.calculated,
        errorCount: formulaEngineStats.errors.length,
        firstErrors: formulaEngineStats.errors.slice(0, 5),
      },
      summary: Object.keys(summary).length > 0 ? summary : extractSummary(summarySheet),
      safetyCivilizedRatePercent: extractSafetyCivilizedRatePercent(calcWb),
      bidItems: extractBidItems(calcWb),
      resourceSummary: extractResourceSummary(calcWb),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

function extractSummary(sheet: SheetData | undefined): Record<string, number> {
  if (!sheet) return {};
  const result: Record<string, number> = {};

  for (const [key, cell] of sheet) {
    const [r, c] = key.split(',').map(Number);
    if (c !== 2 || r <= 1) continue;

    const content = String(cell.value ?? '').trim();
    if (!content) continue;
    const amount = toNum(sheet.get(`${r},3`)?.value);
    result[content] = amount;
    if (content.includes('合计')) {
      result.合计 = amount;
    }
  }

  return result;
}

function chooseReliableSummary(engineSummary: Record<string, number>, fallbackSummary: Record<string, number>): Record<string, number> {
  if (Object.keys(engineSummary).length === 0) return fallbackSummary;
  if (Object.keys(fallbackSummary).length === 0) return engineSummary;

  const engineTotal = engineSummary.合计;
  const fallbackTotal = fallbackSummary.合计;
  if (!Number.isFinite(engineTotal) || !Number.isFinite(fallbackTotal)) {
    return Number.isFinite(fallbackTotal) ? fallbackSummary : engineSummary;
  }

  return Math.abs(engineTotal - fallbackTotal) > 1000 ? fallbackSummary : engineSummary;
}

function extractBidItems(calcWb: CalcWorkbook) {
  const bidItems: Array<{
    row: number;
    category: string;
    code: string;
    name: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    resources: Array<{ row: number; code: string; name: string; type: string; consumption: number; unitPrice: number; totalPrice: number }>;
  }> = [];

  for (const cat of getAnalysisSheets(calcWb)) {
    const sheet = cat.data;
    const mainRows = getMainRows(sheet);

    for (const mainRow of mainRows) {
      const code = cellText(sheet.get(`${mainRow},2`)?.value);
      const name = cellText(sheet.get(`${mainRow},3`)?.value);
      const unit = cellText(sheet.get(`${mainRow},4`)?.value);
      const quantity = toNum(sheet.get(`${mainRow},5`)?.value);
      const unitPrice = toNum(sheet.get(`${mainRow},6`)?.value);
      const totalPrice = toNum(sheet.get(`${mainRow},7`)?.value);
      const resources = extractResources(sheet, mainRow, mainRows);

      bidItems.push({ row: mainRow, category: cat.category, code, name, unit, quantity, unitPrice, totalPrice, resources });
    }
  }

  return bidItems;
}

function extractResources(
  sheet: SheetData,
  mainRow: number,
  allMainRows: number[],
): Array<{ row: number; code: string; name: string; type: string; consumption: number; unitPrice: number; totalPrice: number }> {
  const resources: Array<{ row: number; code: string; name: string; type: string; consumption: number; unitPrice: number; totalPrice: number }> = [];
  const nextMainRow = getNextMainRowOrEnd(sheet, mainRow, allMainRows);

  for (let r = mainRow + 1; r < nextMainRow; r++) {
    const code = cellText(sheet.get(`${r},4`)?.value);
    const name = cellText(sheet.get(`${r},5`)?.value);
    if (!code || code === '编码' || code === 'undefined' || code === 'null') continue;

    resources.push({
      row: r,
      code,
      name,
      type: getResourceType(code),
      consumption: toNum(sheet.get(`${r},8`)?.value),
      unitPrice: toNum(sheet.get(`${r},9`)?.value),
      totalPrice: toNum(sheet.get(`${r},10`)?.value),
    });
  }

  return resources;
}

function extractResourceSummary(calcWb: CalcWorkbook) {
  const sheet = calcWb.get('工料机汇总表');
  if (!sheet) return [];

  const items: Array<{
    row: number;
    code: string;
    name: string;
    unit: string;
    quantity: number;
    taxInclusivePrice: number;
    taxRate: number;
    price: number;
    totalPrice: number;
  }> = [];

  for (const [key, cell] of sheet) {
    const [r, c] = key.split(',').map(Number);
    // 工料机汇总表：B编码、C名称、D单位、E数量、F含税市场价、G税率、H不含税单价。
    if (c !== 2 || r <= 1 || cell.value === null || cell.value === undefined) continue;

    const code = cellText(cell.value);
    if (!code || code === 'null') continue;
    const quantity = toNum(sheet.get(`${r},5`)?.value);
    const taxInclusivePrice = toNum(sheet.get(`${r},6`)?.value);
    const taxRate = toNum(sheet.get(`${r},7`)?.value);
    const price = toNum(sheet.get(`${r},8`)?.value);

    items.push({
      row: r,
      code,
      name: cellText(sheet.get(`${r},3`)?.value),
      unit: cellText(sheet.get(`${r},4`)?.value),
      quantity,
      taxInclusivePrice,
      taxRate,
      price,
      totalPrice: Math.round(quantity * price * 100) / 100,
    });
  }

  return items;
}

function extractSafetyCivilizedRatePercent(calcWb: CalcWorkbook): number | undefined {
  const sheet = Array.from(calcWb.entries()).find(([name]) => name.includes('安全文明施工项目清单明细表'))?.[1];
  if (!sheet) return undefined;

  const rateColumn = findHeaderColumn(sheet, ['费率'], 7);
  const rate = toNum(sheet.get(`2,${rateColumn}`)?.value);
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function findHeaderColumn(sheet: SheetData, labels: string[], fallback: number): number {
  for (const [key, cell] of sheet) {
    const [row, col] = key.split(',').map(Number);
    if (row > 5) continue;
    const label = cellText(cell.value).replace(/\s+/g, '');
    if (labels.some((name) => label.includes(name))) return col;
  }
  return fallback;
}

function getResourceType(code: string): string {
  if (!code) return '未知';
  const c = code.charAt(0);
  if (c === 'R' || c === 'r') return '人工';
  if (c === 'J' || c === 'j') return '机械';
  if (c === 'C' || c === 'c' || code.startsWith('01') || code.startsWith('02') || code.startsWith('03')) return '材料';
  return '未知';
}

function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null || v instanceof Error) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function cellText(v: CellValue | undefined): string {
  if (v === undefined || v === null || v instanceof Error) return '';
  return String(v).trim();
}
