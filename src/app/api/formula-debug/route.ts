import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readExcelToWorkbook, calculateWorkbook } from '@/lib/formula-engine';

export const dynamic = 'force-dynamic';

/** 调试公式引擎 - 查看特定Sheet的特定单元格值 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sheet = searchParams.get('sheet') || '汇总表';
    const maxRow = parseInt(searchParams.get('maxRow') || '20', 10);

    const filePath = join(process.cwd(), 'public', 'test-data', 'table7.xlsx');
    const buffer = readFileSync(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const workbook = await readExcelToWorkbook(arrayBuffer);
    const { workbook: result } = calculateWorkbook(workbook);

    const sheetData = result.get(sheet);
    if (!sheetData) {
      return NextResponse.json({ error: `Sheet "${sheet}" not found`, available: [...result.keys()] });
    }

    const cells: Record<string, { raw: unknown; value: unknown; isFormula: boolean; formula?: string }> = {};
    for (const [key, cell] of sheetData) {
      const [r, c] = key.split(',').map(Number);
      if (r <= maxRow) {
        cells[key] = {
          raw: cell.raw,
          value: cell.value,
          isFormula: cell.isFormula,
          formula: cell.formula,
        };
      }
    }

    return NextResponse.json({ sheet, maxRow, cells });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
