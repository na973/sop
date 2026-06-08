import type { CellValue } from '@/lib/formula-engine/types';

type SheetData = Map<string, { value: CellValue | undefined; isFormula: boolean; formula?: string }>;
type WorkbookLike = Map<string, SheetData>;

const ANALYSIS_SHEET_RE = /^综合单价分析表【(.+)】$/;

export function getAnalysisSheets(workbook: WorkbookLike): Array<{ sheet: string; category: string; data: SheetData }> {
  const sheets: Array<{ sheet: string; category: string; data: SheetData }> = [];

  for (const [sheet, data] of workbook) {
    const match = sheet.match(ANALYSIS_SHEET_RE);
    if (!match) continue;

    sheets.push({
      sheet,
      category: match[1].trim(),
      data,
    });
  }

  return sheets;
}

export function getMainRows(sheet: SheetData): number[] {
  const rows: number[] = [];

  for (const [key, cell] of sheet) {
    const [r, c] = key.split(',').map(Number);
    if (c === 1 && typeof cell.value === 'number' && cell.value > 0) {
      rows.push(r);
    }
  }

  return rows.sort((a, b) => a - b);
}

export function getSheetMaxRow(sheet: SheetData): number {
  let maxRow = 0;

  for (const key of sheet.keys()) {
    const [r] = key.split(',').map(Number);
    if (r > maxRow) maxRow = r;
  }

  return maxRow;
}

export function getNextMainRowOrEnd(sheet: SheetData, mainRow: number, allMainRows: number[]): number {
  const nextMainRow = allMainRows.find((row) => row > mainRow);
  return nextMainRow ?? getSheetMaxRow(sheet) + 1;
}

export function getAnalysisSheetName(category: string): string {
  return `综合单价分析表【${category}】`;
}
