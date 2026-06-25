/**
 * 公式计算器 - 对AST求值
 * 实现12个核心函数 + 基础运算
 */

import {
  ASTNode,
  NodeType,
  CellValue,
  FormulaContext,
  WorkbookData,
  SheetData,
  CellData,
} from './types';
import { cellKey, crossCellKey, letterToCol } from './cell-utils';
import { parseFormula } from './parser';

/** 公式错误值，继承自 Error 以兼容 CellValue 类型 */
class FormulaError extends Error {
  constructor(public type: string, message: string) {
    super(`#${type}! ${message}`);
    this.name = `FormulaError`;
  }
  toString(): string {
    return `#${this.type}!`;
  }
}

const REF_ERROR = new FormulaError('REF', 'Invalid reference');
const VALUE_ERROR = new FormulaError('VALUE', 'Wrong value type');
const DIV_ERROR = new FormulaError('DIV/0', 'Division by zero');
const NA_ERROR = new FormulaError('N/A', 'Not available');
const CIRC_ERROR = new FormulaError('CIRC', 'Circular reference');

/** 判断是否为公式错误值 */
function isError(v: CellValue): v is Error {
  return v instanceof Error;
}

/** 转数字 */
function toNumber(v: CellValue): number {
  if (v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isError(v)) return NaN;
  return parseExcelNumber(v);
}

function parseExcelNumber(value: string): number {
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return 0;
  if (normalized.endsWith('%')) {
    const percent = Number(normalized.slice(0, -1));
    return Number.isFinite(percent) ? percent / 100 : NaN;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

/** 转字符串 */
function toString(v: CellValue): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (isError(v)) return v.toString();
  return String(v);
}

/** 获取Sheet中单元格的值 */
function getCellValue(sheetData: SheetData, row: number, col: number): CellValue {
  const cell = sheetData.get(cellKey(row, col));
  if (!cell) return null;
  return cell.value;
}

/** 获取Sheet中实际的最大行号 */
function getSheetMaxRow(sheetData: SheetData): number {
  let maxRow = 0;
  for (const key of sheetData.keys()) {
    const row = parseInt(key.split(',')[0], 10);
    if (row > maxRow) maxRow = row;
  }
  return maxRow;
}

/** 规范化范围：处理整列引用（row=0）等情况 */
function normalizeRange(sheetData: SheetData | undefined, startRow: number, startCol: number, endRow: number, endCol: number): { startRow: number; startCol: number; endRow: number; endCol: number } {
  if (!sheetData) return { startRow, startCol, endRow, endCol };
  const maxRow = getSheetMaxRow(sheetData);
  return {
    startRow: startRow === 0 ? 1 : startRow,
    startCol,
    endRow: endRow === 0 ? maxRow : endRow,
    endCol,
  };
}

/** 获取范围内的值（平铺为一维数组） */
function getRangeValues(sheetData: SheetData, startRow: number, startCol: number, endRow: number, endCol: number): CellValue[] {
  const norm = normalizeRange(sheetData, startRow, startCol, endRow, endCol);
  const values: CellValue[] = [];
  for (let r = norm.startRow; r <= norm.endRow; r++) {
    for (let c = norm.startCol; c <= norm.endCol; c++) {
      values.push(getCellValue(sheetData, r, c));
    }
  }
  return values;
}

/** 获取范围内的二维数组 */
function getRangeMatrix(sheetData: SheetData, startRow: number, startCol: number, endRow: number, endCol: number): CellValue[][] {
  const norm = normalizeRange(sheetData, startRow, startCol, endRow, endCol);
  const matrix: CellValue[][] = [];
  for (let r = norm.startRow; r <= norm.endRow; r++) {
    const row: CellValue[] = [];
    for (let c = norm.startCol; c <= norm.endCol; c++) {
      row.push(getCellValue(sheetData, r, c));
    }
    matrix.push(row);
  }
  return matrix;
}

/** 主计算函数 */
export function evaluate(node: ASTNode, ctx: FormulaContext): CellValue {
  switch (node.type) {
    case NodeType.Number:
      return node.value;

    case NodeType.String:
      return node.value;

    case NodeType.Boolean:
      return node.value;

    case NodeType.CellRef:
      return resolveCellRef(ctx, node.row, node.col);

    case NodeType.RangeRef:
      // 裸范围引用不应出现在顶层，返回第一个单元格
      return resolveRangeFirst(ctx, node.start.row, node.start.col, node.end.row, node.end.col);

    case NodeType.CrossSheetRef:
      return resolveCrossSheetCell(ctx, node.sheet, node.row, node.col);

    case NodeType.CrossSheetRange:
      // 裸范围引用不应出现在顶层，返回第一个单元格
      return resolveCrossSheetRangeFirst(ctx, node.sheet, node.start.row, node.start.col, node.end.row, node.end.col);

    case NodeType.Function:
      return evaluateFunction(node.name, node.args, ctx);

    case NodeType.BinaryOp:
      return evaluateBinaryOp(node.op, node.left, node.right, ctx);

    case NodeType.UnaryOp:
      return evaluateUnaryOp(node.op, node.operand, ctx);

    case NodeType.Percent:
      return toNumber(evaluate(node.operand, ctx)) / 100;

    default:
      return VALUE_ERROR;
  }
}

/** 解析范围，返回第一个单元格的值 */
function resolveRangeFirst(ctx: FormulaContext, startRow: number, startCol: number, endRow: number, endCol: number): CellValue {
  const sheet = ctx.workbook.get(ctx.currentSheet);
  if (!sheet) return REF_ERROR;
  return resolveCellRef(ctx, startRow, startCol);
}

/** 解析跨Sheet范围，返回第一个单元格的值 */
function resolveCrossSheetRangeFirst(ctx: FormulaContext, sheetName: string, startRow: number, startCol: number, endRow: number, endCol: number): CellValue {
  return resolveCrossSheetCell(ctx, sheetName, startRow, startCol);
}

function resolveCellRef(ctx: FormulaContext, row: number, col: number): CellValue {
  const key = cellKey(row, col);
  const fullKey = crossCellKey(ctx.currentSheet, row, col);

  // 检查循环引用
  if (ctx.computing.has(fullKey)) {
    return CIRC_ERROR;
  }

  // 查缓存
  const cached = ctx.cache.get(fullKey);
  if (cached !== undefined) return cached;

  const sheet = ctx.workbook.get(ctx.currentSheet);
  if (!sheet) return REF_ERROR;

  const cell = sheet.get(key);
  if (!cell) return null;

  // 如果是公式且缓存未命中，需要（重新）计算
  // 注意：不使用 cell.value === undefined 判断，因为 calculateWorkbook 重算时
  // 公式单元格的value可能还是上次的旧值（被设为null标记或残留旧值）
  if (cell.isFormula) {
    ctx.computing.add(fullKey);
    try {
      const ast = parseFormula(cell.formula!);
      cell.value = evaluate(ast, ctx);
      if (isError(cell.value) && cell.cachedValue !== undefined && cell.cachedValue !== null) {
        cell.value = cell.cachedValue;
      }
    } catch (e) {
      cell.value = cell.cachedValue !== undefined && cell.cachedValue !== null
        ? cell.cachedValue
        : new FormulaError('ERROR', String(e));
    }
    ctx.computing.delete(fullKey);
    ctx.cache.set(fullKey, cell.value);
  }

  return cell.value;
}

function resolveRange(ctx: FormulaContext, startRow: number, startCol: number, endRow: number, endCol: number): CellValue[] {
  const sheet = ctx.workbook.get(ctx.currentSheet);
  if (!sheet) return [];
  const norm = normalizeRange(sheet, startRow, startCol, endRow, endCol);
  const values: CellValue[] = [];
  for (let r = norm.startRow; r <= norm.endRow; r++) {
    for (let c = norm.startCol; c <= norm.endCol; c++) {
      values.push(resolveCellRef(ctx, r, c));
    }
  }
  return values;
}

function resolveCrossSheetCell(ctx: FormulaContext, sheetName: string, row: number, col: number): CellValue {
  const key = cellKey(row, col);
  const fullKey = crossCellKey(sheetName, row, col);

  if (ctx.computing.has(fullKey)) return CIRC_ERROR;

  const cached = ctx.cache.get(fullKey);
  if (cached !== undefined) return cached;

  const sheet = ctx.workbook.get(sheetName);
  if (!sheet) return REF_ERROR;

  const cell = sheet.get(key);
  if (!cell) return null;

  if (cell.isFormula) {
    ctx.computing.add(fullKey);
    const oldSheet = ctx.currentSheet;
    ctx.currentSheet = sheetName;
    try {
      const ast = parseFormula(cell.formula!);
      cell.value = evaluate(ast, ctx);
      if (isError(cell.value) && cell.cachedValue !== undefined && cell.cachedValue !== null) {
        cell.value = cell.cachedValue;
      }
    } catch (e) {
      cell.value = cell.cachedValue !== undefined && cell.cachedValue !== null
        ? cell.cachedValue
        : new FormulaError('ERROR', String(e));
    }
    ctx.currentSheet = oldSheet;
    ctx.computing.delete(fullKey);
    ctx.cache.set(fullKey, cell.value);
  }

  return cell.value;
}

function resolveCrossSheetRange(ctx: FormulaContext, sheetName: string, startRow: number, startCol: number, endRow: number, endCol: number): CellValue[] {
  const sheet = ctx.workbook.get(sheetName);
  if (!sheet) return [];
  const norm = normalizeRange(sheet, startRow, startCol, endRow, endCol);
  const oldSheet = ctx.currentSheet;
  ctx.currentSheet = sheetName;
  const values: CellValue[] = [];
  for (let r = norm.startRow; r <= norm.endRow; r++) {
    for (let c = norm.startCol; c <= norm.endCol; c++) {
      values.push(resolveCellRef(ctx, r, c));
    }
  }
  ctx.currentSheet = oldSheet;
  return values;
}

// ---- 二元运算 ----

function evaluateBinaryOp(op: string, left: ASTNode, right: ASTNode, ctx: FormulaContext): CellValue {
  // 字符串连接
  if (op === '&') {
    return toString(evaluate(left, ctx)) + toString(evaluate(right, ctx));
  }

  const lv = evaluate(left, ctx);
  const rv = evaluate(right, ctx);

  if (isError(lv)) return lv;
  if (isError(rv)) return rv;

  // 比较
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    return compareValues(op, lv, rv);
  }

  // 算术
  const ln = toNumber(lv);
  const rn = toNumber(rv);

  if (isNaN(ln) || isNaN(rn)) return VALUE_ERROR;

  switch (op) {
    case '+': return ln + rn;
    case '-': return ln - rn;
    case '*': return ln * rn;
    case '/': return rn === 0 ? DIV_ERROR : ln / rn;
    case '^': return Math.pow(ln, rn);
    default: return VALUE_ERROR;
  }
}

function compareValues(op: string, lv: CellValue, rv: CellValue): boolean {
  // 优先数值比较
  const ln = typeof lv === 'number' ? lv : (lv !== null && lv !== '' ? Number(lv) : NaN);
  const rn = typeof rv === 'number' ? rv : (rv !== null && rv !== '' ? Number(rv) : NaN);

  if (!isNaN(ln) && !isNaN(rn)) {
    return compare(op, ln, rn);
  }

  // 字符串比较（不区分大小写）
  const ls = toString(lv).toLowerCase();
  const rs = toString(rv).toLowerCase();
  return compare(op, ls, rs);
}

function compare<T>(op: string, a: T, b: T): boolean {
  switch (op) {
    case '=': return a === b;
    case '<>': return a !== b;
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    default: return false;
  }
}

function evaluateUnaryOp(op: string, operand: ASTNode, ctx: FormulaContext): CellValue {
  const v = evaluate(operand, ctx);
  if (isError(v)) return v;
  const n = toNumber(v);
  if (isNaN(n)) return VALUE_ERROR;
  return op === '-' ? -n : n;
}

// ---- 函数实现 ----

/** 解析函数参数为范围或数组 */
function resolveArgValues(node: ASTNode, ctx: FormulaContext): CellValue[] {
  if (node.type === NodeType.RangeRef) {
    return resolveRange(ctx, node.start.row, node.start.col, node.end.row, node.end.col);
  }
  if (node.type === NodeType.CrossSheetRange) {
    return resolveCrossSheetRange(ctx, node.sheet, node.start.row, node.start.col, node.end.row, node.end.col);
  }
  // 单值
  const v = evaluate(node, ctx);
  return [v];
}

/** 解析函数参数为二维矩阵 */
function resolveArgMatrix(node: ASTNode, ctx: FormulaContext): CellValue[][] {
  if (node.type === NodeType.RangeRef) {
    const sheet = ctx.workbook.get(ctx.currentSheet);
    if (!sheet) return [[]];
    const norm = normalizeRange(sheet, node.start.row, node.start.col, node.end.row, node.end.col);
    const matrix: CellValue[][] = [];
    for (let r = norm.startRow; r <= norm.endRow; r++) {
      const row: CellValue[] = [];
      for (let c = norm.startCol; c <= norm.endCol; c++) {
        row.push(resolveCellRef(ctx, r, c));
      }
      matrix.push(row);
    }
    return matrix;
  }
  if (node.type === NodeType.CrossSheetRange) {
    const sheet = ctx.workbook.get(node.sheet);
    if (!sheet) return [[]];
    const norm = normalizeRange(sheet, node.start.row, node.start.col, node.end.row, node.end.col);
    const oldSheet = ctx.currentSheet;
    ctx.currentSheet = node.sheet;
    const matrix: CellValue[][] = [];
    for (let r = norm.startRow; r <= norm.endRow; r++) {
      const row: CellValue[] = [];
      for (let c = norm.startCol; c <= norm.endCol; c++) {
        row.push(resolveCellRef(ctx, r, c));
      }
      matrix.push(row);
    }
    ctx.currentSheet = oldSheet;
    return matrix;
  }
  const v = evaluate(node, ctx);
  return [[v]];
}

function evaluateFunction(name: string, args: ASTNode[], ctx: FormulaContext): CellValue {
  switch (name) {
    case 'SUM':
      return fnSum(args, ctx);
    case 'ROUND':
      return fnRound(args, ctx);
    case 'IF':
      return fnIf(args, ctx);
    case 'IFERROR':
      return fnIfError(args, ctx);
    case 'INDEX':
      return fnIndex(args, ctx);
    case 'MATCH':
      return fnMatch(args, ctx);
    case 'SUMIF':
      return fnSumIf(args, ctx);
    case 'SUMPRODUCT':
      return fnSumProduct(args, ctx);
    case 'OR':
      return fnOr(args, ctx);
    case 'AND':
      return fnAnd(args, ctx);
    case 'FIND':
      return fnFind(args, ctx);
    case 'LEFT':
      return fnLeft(args, ctx);
    case 'TRIM':
      return fnTrim(args, ctx);
    case 'MID':
      return fnMid(args, ctx);
    case 'RIGHT':
      return fnRight(args, ctx);
    case 'LEN':
      return fnLen(args, ctx);
    case 'ABS':
      return fnAbs(args, ctx);
    case 'INT':
      return fnInt(args, ctx);
    case 'MOD':
      return fnMod(args, ctx);
    case 'MIN':
      return fnMin(args, ctx);
    case 'MAX':
      return fnMax(args, ctx);
    case 'COUNT':
      return fnCount(args, ctx);
    case 'COUNTA':
      return fnCountA(args, ctx);
    case 'AVERAGE':
      return fnAverage(args, ctx);
    case 'VALUE':
      return fnValue(args, ctx);
    case 'NOT':
      return fnNot(args, ctx);
    case 'ISBLANK':
      return fnIsBlank(args, ctx);
    case 'IFS':
      return fnIfs(args, ctx);
    case 'XLOOKUP':
      return fnXLookup(args, ctx);
    default:
      return new FormulaError('NAME', `Unknown function: ${name}`);
  }
}

// ---- 函数实现 ----

function fnSum(args: ASTNode[], ctx: FormulaContext): CellValue {
  let total = 0;
  for (const arg of args) {
    const vals = resolveArgValues(arg, ctx);
    for (const v of vals) {
      if (isError(v)) return v;
      const n = toNumber(v);
      if (!isNaN(n)) total += n;
    }
  }
  return total;
}

function fnRound(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const num = toNumber(evaluate(args[0], ctx));
  const digits = args.length > 1 ? toNumber(evaluate(args[1], ctx)) : 0;
  if (isNaN(num) || isNaN(digits)) return VALUE_ERROR;
  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

function fnIf(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 2) return VALUE_ERROR;
  const cond = evaluate(args[0], ctx);
  if (isError(cond)) return cond;
  const isTrue = cond === true || (typeof cond === 'number' && cond !== 0) || (typeof cond === 'string' && cond !== '');
  if (isTrue) {
    return evaluate(args[1], ctx);
  }
  return args.length > 2 ? evaluate(args[2], ctx) : false;
}

function fnIfError(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 2) return VALUE_ERROR;
  const val = evaluate(args[0], ctx);
  if (isError(val)) return evaluate(args[1], ctx);
  return val;
}

function fnIndex(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 2) return VALUE_ERROR;
  const matrix = resolveArgMatrix(args[0], ctx);
  const rowNum = toNumber(evaluate(args[1], ctx));
  const colNum = args.length > 2 ? toNumber(evaluate(args[2], ctx)) : 1;
  if (isNaN(rowNum) || isNaN(colNum)) return VALUE_ERROR;

  // INDEX with 0 means entire column/row - not fully supported, return single cell
  const r = rowNum === 0 ? 0 : rowNum - 1;
  const c = colNum === 0 ? 0 : colNum - 1;

  if (r < 0 || r >= matrix.length) return REF_ERROR;
  if (c < 0 || c >= matrix[r].length) return REF_ERROR;
  return matrix[r][c];
}

/** Excel通配符匹配：*匹配0+字符，?匹配1个字符，~转义 */
function excelWildcardMatch(pattern: string, text: string): boolean {
  // 将Excel通配符模式转为正则表达式
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && i + 1 < pattern.length) {
      // 转义下一个字符（~* → 字面*, ~? → 字面?）
      regex += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    } else if (ch === '*') {
      regex += '.*';
    } else if (ch === '?') {
      regex += '.';
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  try {
    return new RegExp('^' + regex + '$', 'i').test(text);
  } catch {
    return false;
  }
}

function fnMatch(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 2) return VALUE_ERROR;
  const lookupVal = evaluate(args[0], ctx);
  const vals = resolveArgValues(args[1], ctx);
  const matchType = args.length > 2 ? toNumber(evaluate(args[2], ctx)) : 1;

  if (matchType === 0) {
    // 精确匹配（支持Excel通配符：*匹配0+字符，?匹配1个字符）
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (typeof lookupVal === 'string' && typeof v === 'string') {
        if (excelWildcardMatch(lookupVal, v)) return i + 1;
      } else if (v === lookupVal) {
        return i + 1;
      }
    }
    return NA_ERROR;
  }

  // matchType = 1 (默认): 找到<=查找值的最大项 (需升序排列)
  // matchType = -1: 找到>=查找值的最小项
  const target = toNumber(lookupVal);
  if (isNaN(target)) return NA_ERROR;

  let bestIdx = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < vals.length; i++) {
    const v = toNumber(vals[i]);
    if (isNaN(v)) continue;
    if (matchType === 1 && v <= target && v > bestVal) {
      bestVal = v;
      bestIdx = i;
    } else if (matchType === -1 && v >= target && (bestIdx === -1 || v < bestVal)) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? bestIdx + 1 : NA_ERROR;
}

function fnSumIf(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 2) return VALUE_ERROR;
  const rangeVals = resolveArgValues(args[0], ctx);
  const criteria = evaluate(args[1], ctx);

  let sumRangeVals: CellValue[];
  if (args.length > 2) {
    sumRangeVals = resolveArgValues(args[2], ctx);
  } else {
    sumRangeVals = rangeVals;
  }

  let total = 0;
  for (let i = 0; i < rangeVals.length; i++) {
    if (matchesCriteria(rangeVals[i], criteria)) {
      const sv = i < sumRangeVals.length ? sumRangeVals[i] : 0;
      const n = toNumber(sv);
      if (!isNaN(n)) total += n;
    }
  }
  return total;
}

/** 对节点进行数组求值，用于 SUMPRODUCT 等需要数组运算的函数 */
function evaluateArray(node: ASTNode, ctx: FormulaContext): CellValue[] {
  // 直接的范围引用
  if (node.type === NodeType.RangeRef) {
    return resolveRange(ctx, node.start.row, node.start.col, node.end.row, node.end.col);
  }
  if (node.type === NodeType.CrossSheetRange) {
    return resolveCrossSheetRange(ctx, node.sheet, node.start.row, node.start.col, node.end.row, node.end.col);
  }
  // 一元操作（如 --）：对操作数逐元素应用
  if (node.type === NodeType.UnaryOp) {
    const operandVals = evaluateArray(node.operand, ctx);
    if (operandVals.length > 1 || (node.operand.type === NodeType.RangeRef || node.operand.type === NodeType.CrossSheetRange || node.operand.type === NodeType.BinaryOp)) {
      return operandVals.map(v => {
        if (isError(v)) return v;
        const n = toNumber(v);
        if (isNaN(n)) return node.op === '-' ? VALUE_ERROR : v;
        return node.op === '-' ? -n : n;
      });
    }
    // 单值
    const v = evaluate(node, ctx);
    return [v];
  }
  // 二元操作（如 range=1）：对左右操作数逐元素比较
  if (node.type === NodeType.BinaryOp) {
    const leftVals = evaluateArray(node.left, ctx);
    const rightVals = evaluateArray(node.right, ctx);
    // 如果左右都是单值，直接计算
    if (leftVals.length === 1 && rightVals.length === 1) {
      return [evaluate(node, ctx)];
    }
    // 数组运算：以较长的数组为准
    const len = Math.max(leftVals.length, rightVals.length);
    const result: CellValue[] = [];
    for (let i = 0; i < len; i++) {
      const lv = i < leftVals.length ? leftVals[i] : leftVals[leftVals.length - 1];
      const rv = i < rightVals.length ? rightVals[i] : rightVals[rightVals.length - 1];
      // 字符串连接
      if (node.op === '&') {
        result.push(toString(lv) + toString(rv));
        continue;
      }
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        result.push(compareValues(node.op, lv, rv));
        continue;
      }
      const ln = toNumber(lv);
      const rn = toNumber(rv);
      if (isNaN(ln) || isNaN(rn)) { result.push(VALUE_ERROR); continue; }
      switch (node.op) {
        case '+': result.push(ln + rn); break;
        case '-': result.push(ln - rn); break;
        case '*': result.push(ln * rn); break;
        case '/': result.push(rn === 0 ? DIV_ERROR : ln / rn); break;
        case '^': result.push(Math.pow(ln, rn)); break;
        default: result.push(VALUE_ERROR);
      }
    }
    return result;
  }
  // 函数调用：逐元素应用
  if (node.type === NodeType.Function) {
    // 对于一些返回数组的函数，直接评估
    const v = evaluate(node, ctx);
    return [v];
  }
  // 其他情况：标量求值
  return [evaluate(node, ctx)];
}

function fnSumProduct(args: ASTNode[], ctx: FormulaContext): CellValue {
  const arrays: number[][] = [];
  for (const arg of args) {
    // 使用 evaluateArray 而非 resolveArgValues，支持 -- 和数组运算
    const vals = evaluateArray(arg, ctx);
    const nums = vals.map(v => {
      const n = toNumber(v);
      return isNaN(n) ? 0 : n;
    });
    arrays.push(nums);
  }

  if (arrays.length === 0) return 0;
  const len = arrays[0].length;
  let total = 0;
  for (let i = 0; i < len; i++) {
    let product = 1;
    for (const arr of arrays) {
      product *= i < arr.length ? arr[i] : 0;
    }
    total += product;
  }
  return total;
}

function fnOr(args: ASTNode[], ctx: FormulaContext): CellValue {
  for (const arg of args) {
    const v = evaluate(arg, ctx);
    if (v === true || (typeof v === 'number' && v !== 0)) return true;
    // 也检查范围内的值
    if (arg.type === NodeType.RangeRef || arg.type === NodeType.CrossSheetRange) {
      const vals = resolveArgValues(arg, ctx);
      for (const rv of vals) {
        if (rv === true || (typeof rv === 'number' && rv !== 0)) return true;
      }
    }
  }
  return false;
}

function fnAnd(args: ASTNode[], ctx: FormulaContext): CellValue {
  for (const arg of args) {
    const v = evaluate(arg, ctx);
    if (v === false || v === 0 || v === null) return false;
  }
  return true;
}

function fnFind(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 2) return VALUE_ERROR;
  const findText = toString(evaluate(args[0], ctx));
  const withinText = toString(evaluate(args[1], ctx));
  const startNum = args.length > 2 ? toNumber(evaluate(args[2], ctx)) : 1;
  if (!findText) return VALUE_ERROR;
  const idx = withinText.indexOf(findText, startNum - 1);
  return idx >= 0 ? idx + 1 : VALUE_ERROR;
}

function fnLeft(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const text = toString(evaluate(args[0], ctx));
  const numChars = args.length > 1 ? toNumber(evaluate(args[1], ctx)) : 1;
  if (isNaN(numChars)) return VALUE_ERROR;
  return text.slice(0, numChars);
}

function fnTrim(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const text = toString(evaluate(args[0], ctx));
  // Excel TRIM also removes inner extra spaces
  return text.replace(/\s+/g, ' ').trim();
}

function fnMid(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 3) return VALUE_ERROR;
  const text = toString(evaluate(args[0], ctx));
  const startNum = toNumber(evaluate(args[1], ctx));
  const numChars = toNumber(evaluate(args[2], ctx));
  if (isNaN(startNum) || isNaN(numChars)) return VALUE_ERROR;
  return text.slice(startNum - 1, startNum - 1 + numChars);
}

function fnRight(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const text = toString(evaluate(args[0], ctx));
  const numChars = args.length > 1 ? toNumber(evaluate(args[1], ctx)) : 1;
  if (isNaN(numChars)) return VALUE_ERROR;
  return text.slice(-numChars);
}

function fnLen(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  return toString(evaluate(args[0], ctx)).length;
}

function fnAbs(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const n = toNumber(evaluate(args[0], ctx));
  if (isNaN(n)) return VALUE_ERROR;
  return Math.abs(n);
}

function fnInt(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const n = toNumber(evaluate(args[0], ctx));
  if (isNaN(n)) return VALUE_ERROR;
  return Math.floor(n);
}

function fnMod(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 2) return VALUE_ERROR;
  const n = toNumber(evaluate(args[0], ctx));
  const d = toNumber(evaluate(args[1], ctx));
  if (isNaN(n) || isNaN(d) || d === 0) return DIV_ERROR;
  return n - d * Math.floor(n / d); // Excel-style MOD
}

function fnMin(args: ASTNode[], ctx: FormulaContext): CellValue {
  let min = Infinity;
  for (const arg of args) {
    const vals = resolveArgValues(arg, ctx);
    for (const v of vals) {
      const n = toNumber(v);
      if (!isNaN(n) && n < min) min = n;
    }
  }
  return min === Infinity ? 0 : min;
}

function fnMax(args: ASTNode[], ctx: FormulaContext): CellValue {
  let max = -Infinity;
  for (const arg of args) {
    const vals = resolveArgValues(arg, ctx);
    for (const v of vals) {
      const n = toNumber(v);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return max === -Infinity ? 0 : max;
}

function fnCount(args: ASTNode[], ctx: FormulaContext): CellValue {
  let count = 0;
  for (const arg of args) {
    const vals = resolveArgValues(arg, ctx);
    for (const v of vals) {
      if (typeof v === 'number') count++;
    }
  }
  return count;
}

function fnCountA(args: ASTNode[], ctx: FormulaContext): CellValue {
  let count = 0;
  for (const arg of args) {
    const vals = resolveArgValues(arg, ctx);
    for (const v of vals) {
      if (v !== null && v !== '') count++;
    }
  }
  return count;
}

function fnAverage(args: ASTNode[], ctx: FormulaContext): CellValue {
  let total = 0;
  let count = 0;
  for (const arg of args) {
    const vals = resolveArgValues(arg, ctx);
    for (const v of vals) {
      const n = toNumber(v);
      if (!isNaN(n)) {
        total += n;
        count++;
      }
    }
  }
  return count === 0 ? DIV_ERROR : total / count;
}

function fnValue(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const text = toString(evaluate(args[0], ctx));
  const n = parseExcelNumber(text);
  return isNaN(n) ? VALUE_ERROR : n;
}

function fnNot(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const v = evaluate(args[0], ctx);
  return !(v === true || (typeof v === 'number' && v !== 0));
}

function fnIsBlank(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 1) return VALUE_ERROR;
  const v = evaluate(args[0], ctx);
  return v === null || v === '';
}

/** IFS函数 - 按顺序判断条件 */
function fnIfs(args: ASTNode[], ctx: FormulaContext): CellValue {
  for (let i = 0; i < args.length - 1; i += 2) {
    const cond = evaluate(args[i], ctx);
    if (cond === true || (typeof cond === 'number' && cond !== 0)) {
      return evaluate(args[i + 1], ctx);
    }
  }
  return NA_ERROR;
}

/** XLOOKUP函数 - 简化实现 */
function fnXLookup(args: ASTNode[], ctx: FormulaContext): CellValue {
  if (args.length < 3) return VALUE_ERROR;
  const lookupVal = evaluate(args[0], ctx);
  const lookupVals = resolveArgValues(args[1], ctx);
  const returnVals = resolveArgValues(args[2], ctx);

  for (let i = 0; i < lookupVals.length; i++) {
    if (lookupVals[i] === lookupVal) {
      return i < returnVals.length ? returnVals[i] : NA_ERROR;
    }
    // 模糊匹配（字符串包含）
    if (typeof lookupVal === 'string' && typeof lookupVals[i] === 'string') {
      const lv = lookupVal as string;
      const lvi = lookupVals[i] as string;
      if (lvi.includes(lv) || lv.includes(lvi)) {
        return i < returnVals.length ? returnVals[i] : NA_ERROR;
      }
    }
  }

  // if_not_found 参数
  if (args.length > 3) return evaluate(args[3], ctx);
  return NA_ERROR;
}

// ---- Criteria匹配 ----

function matchesCriteria(cellVal: CellValue, criteria: CellValue): boolean {
  if (typeof criteria === 'number') {
    return toNumber(cellVal) === criteria;
  }
  const critStr = toString(criteria);

  // 支持 ">0", "<=10" 等运算符
  const opMatch = critStr.match(/^(>=|<=|<>|>|<|=)(.+)$/);
  if (opMatch) {
    const op = opMatch[1];
    const val = opMatch[2];
    const cellNum = toNumber(cellVal);
    const critNum = parseExcelNumber(val);
    if (!isNaN(critNum) && !isNaN(cellNum)) {
      switch (op) {
        case '>': return cellNum > critNum;
        case '<': return cellNum < critNum;
        case '>=': return cellNum >= critNum;
        case '<=': return cellNum <= critNum;
        case '=': return cellNum === critNum;
        case '<>': return cellNum !== critNum;
      }
    }
    // 字符串比较
    const cellStr = toString(cellVal).toLowerCase();
    const critStrLow = val.toLowerCase();
    switch (op) {
      case '=': return cellStr === critStrLow;
      case '<>': return cellStr !== critStrLow;
    }
  }

  // 通配符匹配
  if (critStr.includes('*') || critStr.includes('?')) {
    return excelWildcardMatch(critStr, toString(cellVal));
  }

  // 精确匹配
  return toString(cellVal).toLowerCase() === critStr.toLowerCase();
}
