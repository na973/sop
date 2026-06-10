import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import type { CellValue, CellData, WorkbookData } from '@/lib/formula-engine/types';
import ExcelJS from 'exceljs';

/** 安全取数 */
function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (v instanceof Error) return 0;
  return typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);
}

/** 深拷贝工作簿数据 */
function cloneWorkbook(wb: WorkbookData): WorkbookData {
  const cloned: WorkbookData = new Map();
  for (const [sheetName, sheetData] of wb) {
    const newSheet = new Map<string, CellData>();
    for (const [key, cellData] of sheetData) {
      newSheet.set(key, { ...cellData });
    }
    cloned.set(sheetName, newSheet);
  }
  return cloned;
}

/** 步骤7：调价导出 — 将步骤6调整后的价格写入Excel并返回文件 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { table7FileBase64, balancedItems, priceChanges } = body as {
      table7FileBase64?: string;
      balancedItems?: Array<{
        row: number; category: string; code: string; name: string;
        quantity: number; targetUnitPrice: number; targetTotalPrice: number;
      }>;
      priceChanges?: Array<{ code: string; adjustedPrice: number }>;
    };

    if (!balancedItems?.length) {
      return NextResponse.json({ success: false, error: '请提供：balancedItems(配平结果)' }, { status: 400 });
    }
    if (!priceChanges?.length) {
      return NextResponse.json({ success: false, error: '请先完成步骤6材料调价并提供priceChanges' }, { status: 400 });
    }

    // 1. 读取原始Excel
    let arrayBuffer: ArrayBuffer;
    if (table7FileBase64) {
      const buffer = Buffer.from(table7FileBase64, 'base64');
      arrayBuffer = new Uint8Array(buffer).buffer;
    } else {
      return NextResponse.json({ success: false, error: '请提供表7文件base64' }, { status: 400 });
    }

    // 2. 用ExcelJS读取原始工作簿（保留格式）
    const excelWb = new ExcelJS.Workbook();
    await excelWb.xlsx.load(arrayBuffer);

    // 3. 用公式引擎计算
    const workbook = await readExcelToWorkbook(arrayBuffer);
    const currentWb = cloneWorkbook(workbook);

    // 4. 应用步骤6计算出的逐项材料价格调整
    applyPriceChanges(currentWb, priceChanges);

    // 5. 重新计算
    const { workbook: calcWb } = calculateWorkbook(currentWb);

    // 6. 将计算结果写入ExcelJS工作簿
    writeCalcResultsToExcel(excelWb, calcWb);

    // 7. 导出为Buffer
    const outBuffer = await excelWb.xlsx.writeBuffer();

    // 8. 返回Base64编码的Excel文件
    const base64 = Buffer.from(outBuffer).toString('base64');

    // 读取最终汇总数据
    const summarySheet = calcWb.get('汇总表');
    const finalTotal = toNum(summarySheet?.get('19,3')?.value);

    return NextResponse.json({
      success: true,
      fileBase64: base64,
      fileName: '调价后报价表.xlsx',
      finalTotal,
      summary: extractFinalSummary(calcWb),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

function applyPriceChanges(
  workbook: WorkbookData,
  priceChanges: Array<{ code: string; adjustedPrice: number }>,
) {
  const resSheet = workbook.get('工料机汇总表');
  if (!resSheet) return;

  const priceByCode = new Map(priceChanges.map((change) => [change.code, change.adjustedPrice]));
  for (const [key, cellData] of resSheet) {
    const [r, c] = key.split(',').map(Number);
    if (c !== 6 || r <= 1) continue;

    const code = String(resSheet.get(`${r},2`)?.value ?? '').trim();
    const adjustedPrice = priceByCode.get(code);
    if (adjustedPrice !== undefined) {
      cellData.value = adjustedPrice;
    }
  }
}

/** 将公式引擎的计算结果写入ExcelJS工作簿 */
function writeCalcResultsToExcel(
  excelWb: ExcelJS.Workbook,
  calcWb: WorkbookData,
) {
  for (const [sheetName, sheetData] of calcWb) {
    const ws = excelWb.getWorksheet(sheetName);
    if (!ws) continue;

    for (const [key, cellData] of sheetData) {
      const [r, c] = key.split(',').map(Number);
      const cell = ws.getCell(r, c);

      // 只更新数值，保留公式（公式不变，只是值更新）
      if (cellData.isFormula && cellData.value !== undefined && cellData.value !== null) {
        // 公式单元格：更新value（ExcelJS中公式单元格的value是计算结果）
        const numVal = toNum(cellData.value);
        if (!isNaN(numVal)) {
          try {
            // 保留公式，更新缓存值
            if (typeof cell.value === 'object' && cell.value !== null && 'formula' in (cell.value as object)) {
              // ExcelJS Formula类型，更新result
              (cell.value as { formula: string; result?: unknown }).result = numVal;
            }
          } catch {
            // 忽略单个单元格写入错误
          }
        }
      } else if (!cellData.isFormula && cellData.value !== undefined && cellData.value !== null) {
        // 数据单元格（如修改后的工料机价格）：直接更新值
        const val = cellData.value;
        if (typeof val === 'number') {
          cell.value = val;
        }
      }
    }
  }
}

/** 提取最终汇总数据 */
function extractFinalSummary(calcWb: WorkbookData) {
  const sheet = calcWb.get('汇总表');
  if (!sheet) return null;
  const rows: Array<{ key: string; content: string; amount: number }> = [];
  for (const [key, cell] of sheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === 2 && r > 1) {
      const cVal = toNum(sheet.get(`${r},3`)?.value);
      rows.push({ key: String(sheet.get(`${r},1`)?.value ?? ''), content: String(cell.value ?? ''), amount: cVal });
    }
  }
  return rows;
}
