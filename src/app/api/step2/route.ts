import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import type { CellValue } from '@/lib/formula-engine/types';
import { getAnalysisSheets, getMainRows, getNextMainRowOrEnd } from '@/lib/bidding/excel-sheets';

/** 步骤2：清单组价 — 读取Excel + 公式引擎计算 + 提取结构化数据 */
export async function POST(request: NextRequest) {
  try {
    let arrayBuffer: ArrayBuffer;

    // 支持两种方式：formData上传文件 / JSON传入fileBase64
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ success: false, error: '请上传清单组价表Excel文件' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      arrayBuffer = new Uint8Array(buffer).buffer;
    } else {
      const body = await request.json();
      const { fileBase64 } = body as { fileBase64?: string };
      if (fileBase64) {
        const buffer = Buffer.from(fileBase64, 'base64');
        arrayBuffer = new Uint8Array(buffer).buffer;
      } else {
        return NextResponse.json({ success: false, error: '请上传文件或提供fileBase64' }, { status: 400 });
      }
    }

    // 1. 读取Excel
    const workbook = await readExcelToWorkbook(arrayBuffer);

    // 2. 公式引擎计算
    const { workbook: calcWb, stats } = calculateWorkbook(workbook);

    // 3. 提取汇总表数据
    const summarySheet = calcWb.get('汇总表');
    const summary = extractSummary(summarySheet);

    // 4. 提取清单条目
    const bidItems = extractBidItems(calcWb);

    // 5. 提取工料机汇总
    const resourceSummary = extractResourceSummary(calcWb);

    return NextResponse.json({
      success: true,
      calculationTime: `${stats.calculated} formulas calculated`,
      stats: {
        totalFormulas: stats.totalFormulas,
        calculated: stats.calculated,
        errorCount: stats.errors.length,
        firstErrors: stats.errors.slice(0, 5),
      },
      summary,
      bidItems,
      resourceSummary,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** 提取汇总表 — 返回 {key: amount} 格式 */
function extractSummary(sheet: Map<string, { value: CellValue | undefined; isFormula: boolean; formula?: string }> | undefined): Record<string, number> {
  if (!sheet) return {};
  const result: Record<string, number> = {};
  for (const [key, cell] of sheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === 2 && r > 1) { // B列 = 汇总内容
      const cVal = toNum(sheet.get(`${r},3`)?.value); // C列 = 金额
      const content = String(cell.value ?? '').trim();
      if (content) result[content] = cVal;
    }
  }
  return result;
}

/** 提取三条综合单价分析表的清单条目 */
function extractBidItems(calcWb: Map<string, Map<string, { value: CellValue | undefined; isFormula: boolean; formula?: string }>>) {
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
      const code = String(sheet.get(`${mainRow},2`)?.value ?? '');
      const name = String(sheet.get(`${mainRow},3`)?.value ?? '');
      const unit = String(sheet.get(`${mainRow},4`)?.value ?? '');
      const quantity = toNum(sheet.get(`${mainRow},5`)?.value);
      const unitPrice = toNum(sheet.get(`${mainRow},6`)?.value);
      const totalPrice = toNum(sheet.get(`${mainRow},7`)?.value);

      // 提取工料机子项
      const resources = extractResources(sheet, mainRow, mainRows);

      bidItems.push({ row: mainRow, category: cat.category, code, name, unit, quantity, unitPrice, totalPrice, resources });
    }
  }

  return bidItems;
}

/** 提取主条目行下的工料机子项
 *  表2结构：每个主条目下方有"组价内容"行，然后是工料机行
 *  列：H(8)=编码, I(9)=名称, J(10)=消耗量, K(11)=单价, L(12)=合价
 *  但实际表7中：I(9)=单价(从工料机汇总表INDEX), J(10)=合价, K(11)=占比
 *  这里用表2结构
 */
function extractResources(
  sheet: Map<string, { value: CellValue | undefined; isFormula: boolean; formula?: string }>,
  mainRow: number,
  allMainRows: number[],
): Array<{ row: number; code: string; name: string; type: string; consumption: number; unitPrice: number; totalPrice: number }> {
  const resources: Array<{ row: number; code: string; name: string; type: string; consumption: number; unitPrice: number; totalPrice: number }> = [];

  // 找下一个主条目行作为边界
  const nextMainRow = getNextMainRowOrEnd(sheet, mainRow, allMainRows);

  // 从主条目行+2开始（跳过标题行和"组价内容"行），到下一个主条目之前
  for (let r = mainRow + 1; r < nextMainRow; r++) {
    const hCode = String(sheet.get(`${r},8`)?.value ?? '');  // H列=编码
    const iName = String(sheet.get(`${r},9`)?.value ?? '');  // I列=名称

    // 跳过"组价内容"等标题行和空行
    if (!hCode || hCode === 'null' || hCode === '组价内容' || hCode === '编码') continue;
    if (hCode === 'undefined' && iName === 'undefined') continue;

    const consumption = toNum(sheet.get(`${r},10`)?.value);   // J列=消耗量
    const unitPrice = toNum(sheet.get(`${r},11`)?.value);     // K列=单价
    const totalPrice = toNum(sheet.get(`${r},12`)?.value);    // L列=合价

    resources.push({
      row: r,
      code: hCode,
      name: iName,
      type: getResourceType(hCode),
      consumption,
      unitPrice,
      totalPrice,
    });
  }

  return resources;
}

/** 提取工料机汇总表 */
function extractResourceSummary(calcWb: Map<string, Map<string, { value: CellValue | undefined; isFormula: boolean; formula?: string }>>) {
  const sheet = calcWb.get('工料机汇总表');
  if (!sheet) return [];

  const items: Array<{ row: number; code: string; name: string; unit: string; quantity: number; price: number; totalPrice: number }> = [];

  for (const [key, cell] of sheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === 1 && r > 1 && cell.value !== null && cell.value !== undefined) {
      const code = String(cell.value);
      const name = String(sheet.get(`${r},2`)?.value ?? '');
      const unit = String(sheet.get(`${r},3`)?.value ?? '');
      const quantity = toNum(sheet.get(`${r},4`)?.value);
      const price = toNum(sheet.get(`${r},5`)?.value);
      const totalPrice = toNum(sheet.get(`${r},6`)?.value);

      if (code && code !== 'null') {
        items.push({ row: r, code, name, unit, quantity, price, totalPrice });
      }
    }
  }

  return items;
}

function getResourceType(code: string): string {
  if (!code) return '未知';
  const c = code.charAt(0);
  if (c === 'R' || c === 'r') return '人工';
  if (c === 'C' || c === 'c' || code.startsWith('0') || code.startsWith('1')) return '材料';
  if (c === 'J' || c === 'j') return '机械';
  return '材料';
}

function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  if (v instanceof Error) return 0;
  return 0;
}
