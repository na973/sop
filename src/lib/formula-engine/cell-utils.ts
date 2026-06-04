/**
 * Excel列名与列号互转工具
 * A=1, B=2, ..., Z=26, AA=27, ...
 */

/** 列号转列名 (1-based) */
export function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c > 0) {
    const mod = (c - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    c = Math.floor((c - 1) / 26);
  }
  return result;
}

/** 列名转列号 (1-based) */
export function letterToCol(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col;
}

/** 单元格地址字符串 "A1" → {row:1, col:1} */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^\$?([A-Z]+)\$?(\d+)$/);
  if (!match) return null;
  return {
    col: letterToCol(match[1]),
    row: parseInt(match[2], 10),
  };
}

/** 行列号 → 单元格字符串 */
export function cellRefToString(row: number, col: number): string {
  return `${colToLetter(col)}${row}`;
}

/** Sheet内单元格key: "row,col" */
export function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** 跨Sheet单元格key: "sheet!row,col" */
export function crossCellKey(sheet: string, row: number, col: number): string {
  return `${sheet}!${row},${col}`;
}
