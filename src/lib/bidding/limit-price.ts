import type { CellValue } from '@/lib/formula-engine/types';

type SheetData = Map<string, { value: CellValue | undefined; isFormula: boolean; formula?: string }>;

export interface LimitPrice {
  maxUnitPrice: number;
  maxTotalPrice: number;
  source: 'sheet';
}

function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (v instanceof Error) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function cellText(sheet: SheetData, row: number, col: number): string {
  return String(sheet.get(`${row},${col}`)?.value ?? '').trim();
}

function isLimitHeader(text: string): boolean {
  return /限价|控制价|最高投标|招标控制|最高限价/.test(text);
}

function isUnitPriceHeader(text: string): boolean {
  return /单价|综合单价/.test(text) && !/合价|总价|金额/.test(text);
}

function isTotalPriceHeader(text: string): boolean {
  return /合价|总价|金额/.test(text);
}

function findHeaderColumn(sheet: SheetData, mainRow: number, predicate: (text: string) => boolean): number | null {
  const scanStart = Math.max(1, mainRow - 8);
  const scanEnd = Math.max(1, mainRow - 1);

  for (let r = scanEnd; r >= scanStart; r--) {
    for (let c = 1; c <= 30; c++) {
      const text = cellText(sheet, r, c);
      if (text && predicate(text)) return c;
    }
  }

  for (let r = 1; r <= 20; r++) {
    for (let c = 1; c <= 30; c++) {
      const text = cellText(sheet, r, c);
      if (text && predicate(text)) return c;
    }
  }

  return null;
}

export function extractLimitPrice(sheet: SheetData, mainRow: number, quantity: number): LimitPrice | null {
  const unitCol = findHeaderColumn(sheet, mainRow, (text) => isLimitHeader(text) && isUnitPriceHeader(text));
  const totalCol = findHeaderColumn(sheet, mainRow, (text) => isLimitHeader(text) && isTotalPriceHeader(text));

  const unitPrice = unitCol ? toNum(sheet.get(`${mainRow},${unitCol}`)?.value) : 0;
  const totalPrice = totalCol ? toNum(sheet.get(`${mainRow},${totalCol}`)?.value) : 0;

  if (unitPrice > 0) {
    return {
      maxUnitPrice: unitPrice,
      maxTotalPrice: totalPrice > 0 ? totalPrice : unitPrice * quantity,
      source: 'sheet',
    };
  }

  if (totalPrice > 0 && quantity > 0) {
    return {
      maxUnitPrice: totalPrice / quantity,
      maxTotalPrice: totalPrice,
      source: 'sheet',
    };
  }

  return null;
}
