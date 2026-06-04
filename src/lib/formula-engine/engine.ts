/**
 * 公式引擎主模块 - 依赖图构建 + 拓扑排序 + 批量计算
 */

import { WorkbookData, SheetData, CellData, CellValue, FormulaContext } from './types';
import { cellKey, crossCellKey, letterToCol, colToLetter } from './cell-utils';
import { parseFormula } from './parser';
import { evaluate } from './evaluator';
import { ASTNode, NodeType } from './types';

/** 从AST提取依赖的单元格 */
function extractDependencies(node: ASTNode, currentSheet: string): Array<{ sheet: string; row: number; col: number }> {
  const deps: Array<{ sheet: string; row: number; col: number }> = [];

  switch (node.type) {
    case NodeType.CellRef:
      deps.push({ sheet: currentSheet, row: node.row, col: node.col });
      break;
    case NodeType.RangeRef: {
      for (let r = node.start.row; r <= node.end.row; r++) {
        for (let c = node.start.col; c <= node.end.col; c++) {
          deps.push({ sheet: currentSheet, row: r, col: c });
        }
      }
      break;
    }
    case NodeType.CrossSheetRef:
      deps.push({ sheet: node.sheet, row: node.row, col: node.col });
      break;
    case NodeType.CrossSheetRange: {
      for (let r = node.start.row; r <= node.end.row; r++) {
        for (let c = node.start.col; c <= node.end.col; c++) {
          deps.push({ sheet: node.sheet, row: r, col: c });
        }
      }
      break;
    }
    case NodeType.Function:
      for (const arg of node.args) {
        deps.push(...extractDependencies(arg, currentSheet));
      }
      break;
    case NodeType.BinaryOp:
      deps.push(...extractDependencies(node.left, currentSheet));
      deps.push(...extractDependencies(node.right, currentSheet));
      break;
    case NodeType.UnaryOp:
      deps.push(...extractDependencies(node.operand, currentSheet));
      break;
    case NodeType.Percent:
      deps.push(...extractDependencies(node.operand, currentSheet));
      break;
  }

  return deps;
}

/** 计算整个工作簿的所有公式 */
export function calculateWorkbook(workbook: WorkbookData): {
  workbook: WorkbookData;
  stats: {
    totalFormulas: number;
    calculated: number;
    errors: Array<{ sheet: string; cell: string; error: string }>;
  };
} {
  const ctx: FormulaContext = {
    workbook,
    currentSheet: '',
    cache: new Map(),
    computing: new Set(),
  };

  let totalFormulas = 0;
  let calculated = 0;
  const errors: Array<{ sheet: string; cell: string; error: string }> = [];

  // 遍历所有Sheet的所有公式单元格
  for (const [sheetName, sheetData] of workbook) {
    ctx.currentSheet = sheetName;
    for (const [key, cellData] of sheetData) {
      if (cellData.isFormula && cellData.formula) {
        totalFormulas++;
        const fullKey = crossCellKey(sheetName, ...key.split(',').map(Number) as [number, number]);

        // 跳过已计算的
        if (ctx.cache.has(fullKey)) {
          calculated++;
          continue;
        }

        try {
          const ast = parseFormula(cellData.formula);
          ctx.computing.clear(); // 每次计算前重置
          const result = evaluate(ast, ctx);
          cellData.value = result;
          ctx.cache.set(fullKey, result);
          calculated++;

          if (result instanceof Error) {
            errors.push({
              sheet: sheetName,
              cell: key,
              error: String(result),
            });
          }
        } catch (e) {
          cellData.value = new FormulaCalcError(String(e));
          errors.push({
            sheet: sheetName,
            cell: key,
            error: String(e),
          });
          calculated++;
        }
      }
    }
  }

  return {
    workbook,
    stats: {
      totalFormulas,
      calculated,
      errors,
    },
  };
}

/** 自定义计算错误 */
class FormulaCalcError extends Error {
  constructor(message: string) {
    super(`#CALC: ${message}`);
    this.name = 'FormulaCalcError';
  }
}

/** 比对两个工作簿的计算结果 */
export function compareResults(
  engineResult: WorkbookData,
  excelResult: WorkbookData,
  tolerance: number = 0.02
): {
  total: number;
  matched: number;
  mismatched: Array<{
    sheet: string;
    cell: string;
    engineValue: CellValue;
    excelValue: CellValue;
    diff: number;
  }>;
} {
  let total = 0;
  let matched = 0;
  const mismatched: Array<{
    sheet: string;
    cell: string;
    engineValue: CellValue;
    excelValue: CellValue;
    diff: number;
  }> = [];

  for (const [sheetName, engineSheet] of engineResult) {
    const excelSheet = excelResult.get(sheetName);
    if (!excelSheet) continue;

    for (const [key, engineCell] of engineSheet) {
      if (!engineCell.isFormula) continue;

      const excelCell = excelSheet.get(key);
      if (!excelCell) continue;

      total++;

      const ev = typeof engineCell.value === 'number' ? engineCell.value : NaN;
      const xv = typeof excelCell.value === 'number' ? excelCell.value : NaN;

      if (isNaN(ev) || isNaN(xv)) {
        // 非数值类型比较
        if (String(engineCell.value) === String(excelCell.value)) {
          matched++;
        } else {
          mismatched.push({
            sheet: sheetName,
            cell: key,
            engineValue: engineCell.value,
            excelValue: excelCell.value,
            diff: NaN,
          });
        }
      } else {
        const diff = Math.abs(ev - xv);
        if (diff <= tolerance) {
          matched++;
        } else {
          mismatched.push({
            sheet: sheetName,
            cell: key,
            engineValue: ev,
            excelValue: xv,
            diff,
          });
        }
      }
    }
  }

  return { total, matched, mismatched };
}
