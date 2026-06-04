/**
 * Excel文件读取器 - 使用ExcelJS读取公式，SheetJS读取缓存值
 * ExcelJS能正确读取公式文本，SheetJS能读取缓存计算值
 */

import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { WorkbookData, SheetData, CellData, CellValue } from './types';
import { cellKey } from './cell-utils';

/** 读取Excel文件，返回含公式的WorkbookData（用于引擎计算） */
export async function readExcelToWorkbook(buffer: ArrayBuffer): Promise<WorkbookData> {
  const workbook: WorkbookData = new Map();

  // 使用ExcelJS读取公式
  const ejWb = new ExcelJS.Workbook();
  await ejWb.xlsx.load(buffer);

  for (const ws of ejWb.worksheets) {
    const sheetName = ws.name;
    const sheetData: SheetData = new Map();

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const key = cellKey(rowNumber, colNumber);
        let cellData: CellData;

        // 检查是否为公式单元格 - 两种情况：
        // 1. cell.type === Formula（标准公式单元格）
        // 2. cell.type !== Formula 但 cell.value 是 {formula: "..."}（共享公式/从属公式）
        const isFormulaCell = cell.type === ExcelJS.ValueType.Formula;
        const valueObj = !isFormulaCell && typeof cell.value === 'object' && cell.value !== null ? cell.value as unknown as Record<string, unknown> : null;
        const isSharedFormula = valueObj !== null && typeof valueObj.formula === 'string';

        if (isFormulaCell || isSharedFormula) {
          // 公式单元格
          const formulaText = isFormulaCell
            ? (cell.formula || '')
            : (valueObj!.formula as string);
          cellData = {
            raw: formulaText,
            isFormula: true,
            formula: formulaText,
            value: undefined as unknown as CellValue,
          };
          // ExcelJS的formula不含开头的=号，需要补上
          if (cellData.formula && !cellData.formula.startsWith('=')) {
            cellData.formula = '=' + cellData.formula;
          }
          if (cellData.raw && !String(cellData.raw).startsWith('=')) {
            cellData.raw = '=' + cellData.raw;
          }
        } else {
          // 常量单元格
          let value: CellValue = null;
          if (cell.value !== null && cell.value !== undefined) {
            if (typeof cell.value === 'object' && 'richText' in (cell.value as object)) {
              // RichText -> string
              value = (cell.value as { richText: Array<{ text: string }> }).richText
                .map((r) => r.text)
                .join('');
            } else if (typeof cell.value === 'object' && 'result' in (cell.value as object)) {
              // Formula result (shouldn't reach here but just in case)
              value = (cell.value as { result: CellValue }).result;
            } else if (
              typeof cell.value === 'number' ||
              typeof cell.value === 'string' ||
              typeof cell.value === 'boolean'
            ) {
              value = cell.value;
            } else {
              value = String(cell.value);
            }
          }
          cellData = {
            raw: value,
            isFormula: false,
            value,
          };
        }

        sheetData.set(key, cellData);
      });
    });

    workbook.set(sheetName, sheetData);
  }

  return workbook;
}

/** 读取Excel文件并获取计算后的值（用于验证比对） */
export function readExcelCalculatedValues(buffer: ArrayBuffer): WorkbookData {
  const wb = XLSX.read(buffer, { type: 'array', cellFormula: true, cellNF: true });
  const workbook: WorkbookData = new Map();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const sheetData: SheetData = new Map();

    if (!ws['!ref']) {
      workbook.set(sheetName, sheetData);
      continue;
    }

    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;

        const key = cellKey(r + 1, c + 1);
        let value: CellValue = null;

        if (cell.v !== undefined && cell.v !== null) {
          value = cell.v;
        } else if (cell.w) {
          const num = Number(cell.w.replace(/,/g, ''));
          value = isNaN(num) ? cell.w : num;
        }

        const cellData: CellData = {
          raw: cell.f || value,
          isFormula: !!cell.f,
          formula: cell.f || undefined,
          value,
        };

        sheetData.set(key, cellData);
      }
    }

    workbook.set(sheetName, sheetData);
  }

  return workbook;
}

/** 获取Sheet的行列范围 */
export function getSheetRange(sheetData: SheetData): { maxRow: number; maxCol: number } {
  let maxRow = 0;
  let maxCol = 0;
  for (const key of sheetData.keys()) {
    const [r, c] = key.split(',').map(Number);
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  }
  return { maxRow, maxCol };
}
