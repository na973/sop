/**
 * 公式解析器 - 将Excel公式字符串解析为AST
 * 支持: 算术运算, 单元格引用, 范围引用, 跨Sheet引用, 12个函数
 */

import { ASTNode, NodeType } from './types';

export class FormulaParser {
  private pos = 0;
  private formula: string;

  constructor(formula: string) {
    // 去掉开头的 = 号
    this.formula = formula.startsWith('=') ? formula.slice(1) : formula;
    this.pos = 0;
  }

  parse(): ASTNode {
    const node = this.parseExpression();
    if (this.pos < this.formula.length) {
      throw new Error(`Unexpected character at position ${this.pos}: "${this.formula[this.pos]}"`);
    }
    return node;
  }

  // ---- 表达式优先级 ----

  private parseExpression(): ASTNode {
    return this.parseComparison();
  }

  private parseComparison(): ASTNode {
    let left = this.parseConcat();
    while (this.pos < this.formula.length) {
      const op = this.peek2();
      if (op === '<>' || op === '<=' || op === '>=') {
        this.pos += 2;
        left = { type: NodeType.BinaryOp, op, left, right: this.parseConcat() };
      } else if (this.peek() === '<' || this.peek() === '>' || this.peek() === '=') {
        const o = this.peek();
        this.pos++;
        left = { type: NodeType.BinaryOp, op: o, left, right: this.parseConcat() };
      } else {
        break;
      }
    }
    return left;
  }

  private parseConcat(): ASTNode {
    let left = this.parseAddSub();
    while (this.peek() === '&') {
      this.pos++;
      left = { type: NodeType.BinaryOp, op: '&', left, right: this.parseAddSub() };
    }
    return left;
  }

  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    while (this.pos < this.formula.length) {
      const ch = this.peek();
      if (ch === '+' || ch === '-') {
        this.pos++;
        left = { type: NodeType.BinaryOp, op: ch, left, right: this.parseMulDiv() };
      } else {
        break;
      }
    }
    return left;
  }

  private parseMulDiv(): ASTNode {
    let left = this.parsePower();
    while (this.pos < this.formula.length) {
      const ch = this.peek();
      if (ch === '*' || ch === '/') {
        this.pos++;
        left = { type: NodeType.BinaryOp, op: ch, left, right: this.parsePower() };
      } else {
        break;
      }
    }
    return left;
  }

  private parsePower(): ASTNode {
    let left = this.parsePercent();
    if (this.peek() === '^') {
      this.pos++;
      left = { type: NodeType.BinaryOp, op: '^', left, right: this.parsePercent() };
    }
    return left;
  }

  private parsePercent(): ASTNode {
    let node = this.parseUnary();
    if (this.peek() === '%') {
      this.pos++;
      node = { type: NodeType.Percent, operand: node };
    }
    return node;
  }

  private parseUnary(): ASTNode {
    if (this.peek() === '-') {
      this.pos++;
      // Check for double negation (--) used in SUMPRODUCT etc.
      if (this.peek() === '-') {
        this.pos++;
        // --x = x (just evaluate the operand, double negation is identity for numbers)
        // But we need to ensure the result is numeric, so wrap in a special case
        const operand = this.parseUnary();
        // --x is equivalent to IF(ISNUMBER(x), x*1, 0) for arrays, but for simplicity:
        return { type: NodeType.UnaryOp, op: '-', operand: { type: NodeType.UnaryOp, op: '-', operand } };
      }
      return { type: NodeType.UnaryOp, op: '-', operand: this.parseUnary() };
    }
    if (this.peek() === '+') {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    this.skipSpaces();

    // 跨Sheet引用: 'Sheet Name'!A1 或 SheetName!A1
    if (this.peek() === "'" || this.isCrossSheetRef()) {
      return this.parseCrossSheetRef();
    }

    // 函数调用
    if (this.isFunctionStart()) {
      return this.parseFunction();
    }

    // 括号表达式
    if (this.peek() === '(') {
      this.pos++;
      const node = this.parseExpression();
      this.expect(')');
      return node;
    }

    // 数字
    if (this.isDigit() || this.peek() === '.') {
      return this.parseNumber();
    }

    // 字符串
    if (this.peek() === '"') {
      return this.parseString();
    }

    // 布尔值
    if (this.matchKeyword('TRUE')) {
      return { type: NodeType.Boolean, value: true };
    }
    if (this.matchKeyword('FALSE')) {
      return { type: NodeType.Boolean, value: false };
    }

    // 单元格引用或范围
    if (this.isCellRefStart()) {
      return this.parseCellRefOrRange();
    }

    throw new Error(`Unexpected at pos ${this.pos}: "${this.formula.slice(this.pos, this.pos + 20)}"`);
  }

  // ---- 具体解析方法 ----

  private parseNumber(): ASTNode {
    const start = this.pos;
    while (this.pos < this.formula.length && (this.isDigit() || this.peek() === '.')) {
      this.pos++;
    }
    // 科学计数法
    if (this.pos < this.formula.length && (this.peek() === 'e' || this.peek() === 'E')) {
      this.pos++;
      if (this.peek() === '+' || this.peek() === '-') this.pos++;
      while (this.pos < this.formula.length && this.isDigit()) this.pos++;
    }
    const num = parseFloat(this.formula.slice(start, this.pos));
    return { type: NodeType.Number, value: num };
  }

  private parseString(): ASTNode {
    this.pos++; // skip opening "
    let result = '';
    while (this.pos < this.formula.length) {
      if (this.peek() === '"') {
        this.pos++;
        if (this.peek() === '"') {
          result += '"';
          this.pos++;
        } else {
          break;
        }
      } else {
        result += this.peek();
        this.pos++;
      }
    }
    return { type: NodeType.String, value: result };
  }

  private parseCellRefOrRange(): ASTNode {
    const ref1 = this.readCellRef();
    if (!ref1) {
      throw new Error(`Expected cell reference at pos ${this.pos}`);
    }
    // 检查是否是范围引用 (A1:B5)
    if (this.peek() === ':') {
      this.pos++;
      const ref2 = this.readCellRef();
      if (!ref2) throw new Error('Expected end of range');
      return {
        type: NodeType.RangeRef,
        start: ref1,
        end: ref2,
      };
    }
    return {
      type: NodeType.CellRef,
      row: ref1.row,
      col: ref1.col,
      absRow: ref1.absRow,
      absCol: ref1.absCol,
    };
  }

  private readCellRef(): { row: number; col: number; absRow: boolean; absCol: boolean } | null {
    const start = this.pos;
    let absCol = false;
    let absRow = false;

    if (this.peek() === '$') {
      absCol = true;
      this.pos++;
    }

    // 读取列字母
    const colStart = this.pos;
    while (this.pos < this.formula.length && /[A-Z]/i.test(this.peek())) {
      this.pos++;
    }
    if (this.pos === colStart) {
      this.pos = start;
      return null;
    }
    const colLetters = this.formula.slice(colStart, this.pos).toUpperCase();

    if (this.peek() === '$') {
      absRow = true;
      this.pos++;
    }

    // 读取行号 - 可能为空（整列引用如 $A:$A）
    const rowStart = this.pos;
    while (this.pos < this.formula.length && this.isDigit()) {
      this.pos++;
    }
    const rowNum = this.pos > rowStart ? parseInt(this.formula.slice(rowStart, this.pos), 10) : 0;

    let col = 0;
    for (let i = 0; i < colLetters.length; i++) {
      col = col * 26 + (colLetters.charCodeAt(i) - 64);
    }

    return { row: rowNum, col, absRow, absCol };
  }

  private parseCrossSheetRef(): ASTNode {
    let sheet: string;
    if (this.peek() === "'") {
      this.pos++;
      const start = this.pos;
      while (this.pos < this.formula.length) {
        if (this.peek() === "'") {
          // Check for escaped single quote ('')
          if (this.pos + 1 < this.formula.length && this.formula[this.pos + 1] === "'") {
            this.pos += 2; // skip ''
          } else {
            break;
          }
        } else {
          this.pos++;
        }
      }
      sheet = this.formula.slice(start, this.pos);
      this.pos++; // skip closing '
    } else {
      // 非引号的Sheet名: 找到 ! 之前的所有字母数字和部分中文
      const start = this.pos;
      while (this.pos < this.formula.length && this.peek() !== '!') {
        this.pos++;
      }
      sheet = this.formula.slice(start, this.pos).trim();
    }

    if (this.peek() !== '!') {
      throw new Error(`Expected ! after sheet name "${sheet}"`);
    }
    this.pos++; // skip !

    // 读取单元格引用或范围
    const ref1 = this.readCellRef();
    if (!ref1) throw new Error(`Expected cell ref after ${sheet}!`);

    if (this.peek() === ':') {
      this.pos++;
      const ref2 = this.readCellRef();
      if (!ref2) throw new Error('Expected end of range');
      return {
        type: NodeType.CrossSheetRange,
        sheet,
        start: ref1,
        end: ref2,
      };
    }

    return {
      type: NodeType.CrossSheetRef,
      sheet,
      row: ref1.row,
      col: ref1.col,
    };
  }

  private isCrossSheetRef(): boolean {
    // 检查当前位置是否可能是跨Sheet引用（SheetName!A1）
    if (this.peek() === "'") return true;
    const rest = this.formula.slice(this.pos);
    // 匹配: 字母/中文...!A1
    const match = rest.match(/^[\w\u4e00-\u9fff【】]+(\([^)]*\))?!/);
    return match !== null;
  }

  private isFunctionStart(): boolean {
    const rest = this.formula.slice(this.pos);
    const match = rest.match(/^([A-Z]+)\(/i);
    if (!match) return false;
    // 确保不是单元格引用（如 A1 不是函数）
    const name = match[1].toUpperCase();
    // 函数名通常是纯字母且较长，或已知函数
    const knownFunctions = [
      'SUM', 'ROUND', 'IF', 'IFERROR', 'INDEX', 'MATCH',
      'SUMIF', 'SUMPRODUCT', 'OR', 'AND', 'FIND', 'LEFT',
      'TRIM', 'LEN', 'MID', 'RIGHT', 'ABS', 'INT', 'MOD',
      'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTIF', 'AVERAGE',
      'VLOOKUP', 'HLOOKUP', 'VALUE', 'TEXT', 'NOT', 'ISBLANK',
      'IFS', 'XLOOKUP',
    ];
    return knownFunctions.includes(name);
  }

  private parseFunction(): ASTNode {
    const start = this.pos;
    while (this.pos < this.formula.length && /[A-Z]/i.test(this.peek())) {
      this.pos++;
    }
    const name = this.formula.slice(start, this.pos).toUpperCase();
    this.expect('(');

    const args: ASTNode[] = [];
    if (this.peek() !== ')') {
      args.push(this.parseFunctionArg());
      while (this.peek() === ',') {
        this.pos++;
        args.push(this.parseFunctionArg());
      }
    }
    this.expect(')');
    return { type: NodeType.Function, name, args };
  }

  /** 函数参数解析（支持空参数，如 IF(A1,"",B1)） */
  private parseFunctionArg(): ASTNode {
    if (this.peek() === ',' || this.peek() === ')') {
      // 空参数 - 返回空字符串节点
      return { type: NodeType.String, value: '' };
    }
    return this.parseExpression();
  }

  private matchKeyword(keyword: string): boolean {
    const rest = this.formula.slice(this.pos);
    if (rest.toUpperCase().startsWith(keyword)) {
      // 确保后面不是字母（避免把 TRUEXX 误匹配为 TRUE）
      const nextChar = rest[keyword.length];
      if (!nextChar || !/[A-Z]/i.test(nextChar)) {
        this.pos += keyword.length;
        return true;
      }
    }
    return false;
  }

  // ---- 辅助方法 ----

  private peek(): string {
    return this.pos < this.formula.length ? this.formula[this.pos] : '';
  }

  private peek2(): string {
    return this.pos + 1 < this.formula.length
      ? this.formula.slice(this.pos, this.pos + 2)
      : '';
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new Error(`Expected "${ch}" at pos ${this.pos}, got "${this.peek()}"`);
    }
    this.pos++;
  }

  private skipSpaces(): void {
    while (this.pos < this.formula.length && this.peek() === ' ') {
      this.pos++;
    }
  }

  private isDigit(): boolean {
    return this.peek() >= '0' && this.peek() <= '9';
  }

  private isCellRefStart(): boolean {
    // 以$或字母开头，后面跟数字
    if (this.peek() === '$') return true;
    if (/[A-Z]/i.test(this.peek())) {
      // 检查是否是字母+数字的模式
      const rest = this.formula.slice(this.pos);
      return /^\$?[A-Z]+\$?\d/i.test(rest);
    }
    return false;
  }
}

/** 便捷解析方法 */
export function parseFormula(formula: string): ASTNode {
  const parser = new FormulaParser(formula);
  return parser.parse();
}
