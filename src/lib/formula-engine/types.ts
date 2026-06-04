/**
 * 公式引擎核心类型定义
 */

/** 单元格地址 */
export interface CellAddress {
  sheet: string;
  row: number; // 1-based
  col: number; // 1-based
}

/** 单元格值类型（含公式错误） */
export type CellValue = string | number | boolean | null | Error;

/** 单元格数据 */
export interface CellData {
  /** 原始值（可能是常量或公式字符串） */
  raw: CellValue;
  /** 是否为公式 */
  isFormula: boolean;
  /** 计算结果 */
  value: CellValue;
  /** 公式文本（仅公式单元格有） */
  formula?: string;
}

/** Sheet数据：row/col 1-based */
export type SheetData = Map<string, CellData>; // key = "row,col"

/** 工作簿数据 */
export type WorkbookData = Map<string, SheetData>; // key = sheetName

/** AST节点类型 */
export enum NodeType {
  Number = 'Number',
  String = 'String',
  Boolean = 'Boolean',
  CellRef = 'CellRef',
  RangeRef = 'RangeRef',
  CrossSheetRef = 'CrossSheetRef',
  CrossSheetRange = 'CrossSheetRange',
  Function = 'Function',
  BinaryOp = 'BinaryOp',
  UnaryOp = 'UnaryOp',
  Percent = 'Percent',
}

/** AST节点 */
export type ASTNode =
  | { type: NodeType.Number; value: number }
  | { type: NodeType.String; value: string }
  | { type: NodeType.Boolean; value: boolean }
  | { type: NodeType.CellRef; row: number; col: number; absRow: boolean; absCol: boolean }
  | { type: NodeType.RangeRef; start: { row: number; col: number }; end: { row: number; col: number } }
  | { type: NodeType.CrossSheetRef; sheet: string; row: number; col: number }
  | { type: NodeType.CrossSheetRange; sheet: string; start: { row: number; col: number }; end: { row: number; col: number } }
  | { type: NodeType.Function; name: string; args: ASTNode[] }
  | { type: NodeType.BinaryOp; op: string; left: ASTNode; right: ASTNode }
  | { type: NodeType.UnaryOp; op: string; operand: ASTNode }
  | { type: NodeType.Percent; operand: ASTNode };

/** 依赖图中的单元格引用 */
export interface DependencyRef {
  sheet: string;
  row: number;
  col: number;
}

/** 公式计算上下文 */
export interface FormulaContext {
  /** 当前工作簿所有Sheet数据 */
  workbook: WorkbookData;
  /** 当前Sheet名 */
  currentSheet: string;
  /** 已缓存的计算结果，避免重复计算 */
  cache: Map<string, CellValue>;
  /** 是否正在计算（用于检测循环引用） */
  computing: Set<string>;
}

/** 引擎计算结果 */
export interface EngineResult {
  /** 工作簿计算后数据 */
  workbook: WorkbookData;
  /** 验证报告 */
  validation: {
    totalFormulas: number;
    calculated: number;
    errors: Array<{ sheet: string; cell: string; error: string }>;
  };
}
