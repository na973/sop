import ExcelJS from 'exceljs';

type FormulaStats = {
  resourcePriceFormulas: number;
  detailUnitPriceFormulas: number;
  detailTotalFormulas: number;
  detailSubtotalFormulas: number;
  mainItemFormulas: number;
  summaryFormulas: number;
  safetyFormulas: number;
};

type ExcelCellValue = ExcelJS.CellValue;

const ANALYSIS_SHEET_RE = /^综合单价分析表【(.+)】$/;
const MONEY_FORMAT = '#,##0.00';
const PRICE_FORMAT = '#,##0.0000';

export type FormulaWorkbookResult = {
  buffer: Buffer;
  stats: FormulaStats;
  summary: Record<string, number>;
};

export async function buildFormulaWorkbook(arrayBuffer: ArrayBuffer): Promise<FormulaWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const stats: FormulaStats = {
    resourcePriceFormulas: 0,
    detailUnitPriceFormulas: 0,
    detailTotalFormulas: 0,
    detailSubtotalFormulas: 0,
    mainItemFormulas: 0,
    summaryFormulas: 0,
    safetyFormulas: 0,
  };

  const resourceSheet = findSheet(workbook, '工料机汇总表');
  if (resourceSheet) {
    addResourceFormulas(resourceSheet, stats);
  }

  const analysisSheets = workbook.worksheets
    .map((sheet) => {
      const match = sheet.name.match(ANALYSIS_SHEET_RE);
      return match ? { sheet, category: match[1].trim() } : null;
    })
    .filter((item): item is { sheet: ExcelJS.Worksheet; category: string } => item !== null);

  for (const { sheet } of analysisSheets) {
    addAnalysisSheetFormulas(sheet, resourceSheet?.rowCount ?? 1, stats);
  }

  const safetySheet = findSheet(workbook, '安全文明施工项目清单明细表');
  const summarySheet = findSheet(workbook, '汇总表');
  if (summarySheet) {
    addSummaryFormulas(summarySheet, analysisSheets, safetySheet, stats);
  }
  if (summarySheet && safetySheet) {
    addSafetyFormulas(safetySheet, summarySheet, stats);
  }

  // 保留 Excel 公式，同时由结构化算法写入缓存结果，避免内置公式引擎兼容问题造成总价异常放大。
  workbook.calcProperties.fullCalcOnLoad = true;
  const summary = writeStructuredFormulaResults(workbook, analysisSheets, resourceSheet, safetySheet, summarySheet);

  const output = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(output),
    stats,
    summary,
  };
}

function writeStructuredFormulaResults(
  workbook: ExcelJS.Workbook,
  analysisSheets: Array<{ sheet: ExcelJS.Worksheet; category: string }>,
  resourceSheet: ExcelJS.Worksheet | undefined,
  safetySheet: ExcelJS.Worksheet | undefined,
  summarySheet: ExcelJS.Worksheet | undefined,
): Record<string, number> {
  const resourcePrices = resourceSheet ? writeResourceResults(resourceSheet) : new Map<string, number>();
  const categoryTotals = new Map<string, number>();

  for (const { sheet, category } of analysisSheets) {
    categoryTotals.set(category, writeAnalysisResults(sheet, resourcePrices));
  }

  if (summarySheet) {
    return writeSummaryResults(workbook, summarySheet, categoryTotals, safetySheet);
  }

  return {};
}

function writeResourceResults(sheet: ExcelJS.Worksheet): Map<string, number> {
  const prices = new Map<string, number>();

  for (let row = 2; row <= sheet.rowCount; row++) {
    const code = normalizeCode(text(sheet.getCell(row, 2).value));
    if (!code) continue;

    const taxPrice = toNumber(sheet.getCell(row, 6).value);
    const taxRate = toNumber(sheet.getCell(row, 7).value);
    const price = round(taxPrice / (1 + taxRate / 100), 2);
    setFormulaResult(sheet.getCell(row, 8), price, MONEY_FORMAT);
    prices.set(code, price);
  }

  return prices;
}

function writeAnalysisResults(sheet: ExcelJS.Worksheet, resourcePrices: Map<string, number>): number {
  let row = 1;
  let sheetTotal = 0;

  while (row <= sheet.rowCount) {
    if (!isMainHeader(sheet, row)) {
      row++;
      continue;
    }

    const mainRow = row + 1;
    const detailStart = row + 3;
    const enterpriseHeader = findEnterpriseHeader(sheet, detailStart);
    if (!enterpriseHeader) {
      row++;
      continue;
    }

    const detailEnd = enterpriseHeader - 1;
    const enterpriseRow = enterpriseHeader + 1;
    let detailSum = 0;
    let laborSum = 0;

    for (let detailRow = detailStart; detailRow <= detailEnd; detailRow++) {
      const code = text(sheet.getCell(detailRow, 4).value);
      if (!code) continue;

      const unitPrice = findResourcePrice(resourcePrices, code) ?? toNumber(sheet.getCell(detailRow, 9).value);
      const totalPrice = round(toNumber(sheet.getCell(detailRow, 8).value) * unitPrice, 4);
      detailSum += totalPrice;
      if (text(sheet.getCell(detailRow, 3).value) === '人工费') {
        laborSum += totalPrice;
      }

      setFormulaResult(sheet.getCell(detailRow, 9), unitPrice, PRICE_FORMAT);
      setFormulaResult(sheet.getCell(detailRow, 10), totalPrice, PRICE_FORMAT);
      setFormulaResult(sheet.getCell(detailRow, 11), totalPrice, PRICE_FORMAT);
    }

    const enterpriseFee = round(laborSum * toNumber(sheet.getCell(enterpriseRow, 8).value) / 100, 4);
    const unitPrice = round(detailSum + enterpriseFee, 2);
    const totalPrice = round(toNumber(sheet.getCell(mainRow, 5).value) * unitPrice, 2);

    setFormulaResult(sheet.getCell(enterpriseRow, 11), enterpriseFee, PRICE_FORMAT);
    setFormulaResult(sheet.getCell(mainRow, 6), unitPrice, MONEY_FORMAT);
    setFormulaResult(sheet.getCell(mainRow, 7), totalPrice, MONEY_FORMAT);

    sheetTotal += totalPrice;
    row = enterpriseRow + 1;
  }

  return round(sheetTotal, 2);
}

function writeSummaryResults(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  categoryTotals: Map<string, number>,
  safetySheet: ExcelJS.Worksheet | undefined,
): Record<string, number> {
  const codeRows = new Map<string, number>();
  const labelRows = new Map<string, number>();
  const summary: Record<string, number> = {};

  for (let row = 1; row <= sheet.rowCount; row++) {
    const code = text(sheet.getCell(row, 1).value);
    const label = text(sheet.getCell(row, 2).value);
    if (code) codeRows.set(code, row);
    if (label) labelRows.set(label, row);
  }

  for (const [category, total] of categoryTotals) {
    const row = labelRows.get(category);
    if (row) setFormulaResult(sheet.getCell(row, 3), total, MONEY_FORMAT);
  }

  const singleProjectTotal = sumCategoryRows(sheet, labelRows, categoryTotals);
  setFormulaResultByCode(sheet, codeRows, '1.1', singleProjectTotal);
  setFormulaResultByCode(sheet, codeRows, '1', singleProjectTotal);

  if (safetySheet) {
    const safetyRate = getSafetyRate(safetySheet);
    const safetyAmount = round(singleProjectTotal * safetyRate / 100, 2);
    const safetyAmountColumn = findSafetyAmountColumn(safetySheet);
    setFormulaResult(safetySheet.getCell(2, 6), singleProjectTotal, MONEY_FORMAT);
    setFormulaResult(safetySheet.getCell(2, safetyAmountColumn), safetyAmount, MONEY_FORMAT);
    setFormulaResultByCode(sheet, codeRows, '2.1', safetyAmount);
  }

  setFormulaResultByCode(sheet, codeRows, '2', sumKnownCodes(sheet, codeRows, ['2.1', '2.2']));
  setFormulaResultByCode(sheet, codeRows, '3', sumKnownCodes(sheet, codeRows, ['3.1', '3.2', '3.3', '3.4']));

  const row1 = codeRows.get('1');
  const row2 = codeRows.get('2');
  const row3 = codeRows.get('3');
  const row32 = codeRows.get('3.2');
  const row4 = codeRows.get('4');
  if (row1 && row2 && row3 && row4) {
    const taxable = toNumber(sheet.getCell(row1, 3).value)
      + toNumber(sheet.getCell(row2, 3).value)
      + toNumber(sheet.getCell(row3, 3).value)
      - (row32 ? toNumber(sheet.getCell(row32, 3).value) : 0);
    setFormulaResult(sheet.getCell(row4, 3), round(taxable * 0.09, 2), MONEY_FORMAT);
  }

  const totalRow = findTotalRow(sheet);
  if (totalRow && row1 && row2 && row3 && row4) {
    const total = toNumber(sheet.getCell(row1, 3).value)
      + toNumber(sheet.getCell(row2, 3).value)
      + toNumber(sheet.getCell(row3, 3).value)
      + toNumber(sheet.getCell(row4, 3).value);
    setFormulaResult(sheet.getCell(totalRow, 3), round(total, 2), MONEY_FORMAT);
  }

  for (let row = 1; row <= sheet.rowCount; row++) {
    const label = text(sheet.getCell(row, 2).value);
    if (!label) continue;
    const amount = toNumber(sheet.getCell(row, 3).value);
    summary[label] = amount;
    if (label.includes('合计')) summary.合计 = amount;
  }

  workbook.calcProperties.fullCalcOnLoad = true;
  return summary;
}

function addResourceFormulas(sheet: ExcelJS.Worksheet, stats: FormulaStats) {
  for (let row = 2; row <= sheet.rowCount; row++) {
    if (!text(sheet.getCell(row, 2).value)) continue;
    setFormula(sheet.getCell(row, 8), `ROUND(F${row}/(1+G${row}/100),2)`, MONEY_FORMAT);
    stats.resourcePriceFormulas++;
  }
}

function addAnalysisSheetFormulas(sheet: ExcelJS.Worksheet, resourceLastRow: number, stats: FormulaStats) {
  const safeResourceLastRow = Math.max(resourceLastRow, 2);
  let row = 1;

  while (row <= sheet.rowCount) {
    if (!isMainHeader(sheet, row)) {
      row++;
      continue;
    }

    const mainRow = row + 1;
    const detailStart = row + 3;
    const enterpriseHeader = findEnterpriseHeader(sheet, detailStart);
    if (!enterpriseHeader) {
      row++;
      continue;
    }

    const detailEnd = enterpriseHeader - 1;
    const enterpriseRow = enterpriseHeader + 1;

    for (let detailRow = detailStart; detailRow <= detailEnd; detailRow++) {
      if (!text(sheet.getCell(detailRow, 4).value)) continue;
      const fallback = numberFormulaFallback(sheet.getCell(detailRow, 9).value);
      const resourceLookup =
        `IFERROR(INDEX('工料机汇总表'!$H$2:$H$${safeResourceLastRow},` +
        `MATCH("*"&TRIM(D${detailRow})&"*",'工料机汇总表'!$B$2:$B$${safeResourceLastRow},0)),` +
        `IFERROR(INDEX('工料机汇总表'!$H$2:$H$${safeResourceLastRow},` +
        `MATCH("*"&IFERROR(LEFT(TRIM(D${detailRow}),FIND("@",TRIM(D${detailRow}))-1),TRIM(D${detailRow}))&"*",` +
        `'工料机汇总表'!$B$2:$B$${safeResourceLastRow},0)),${fallback}))`;

      setFormula(sheet.getCell(detailRow, 9), resourceLookup, PRICE_FORMAT);
      setFormula(sheet.getCell(detailRow, 10), `IF(OR(H${detailRow}="",I${detailRow}=""),"",ROUND(H${detailRow}*I${detailRow},4))`, PRICE_FORMAT);
      setFormula(sheet.getCell(detailRow, 11), `ROUND(J${detailRow},4)`, PRICE_FORMAT);
      stats.detailUnitPriceFormulas++;
      stats.detailTotalFormulas++;
      stats.detailSubtotalFormulas++;
    }

    setFormula(sheet.getCell(enterpriseRow, 11), `ROUND(SUMIF(C${detailStart}:C${detailEnd},"人工费",J${detailStart}:J${detailEnd})*H${enterpriseRow}/100,4)`, PRICE_FORMAT);
    setFormula(sheet.getCell(mainRow, 6), `ROUND(SUM(J${detailStart}:J${detailEnd})+K${enterpriseRow},2)`, MONEY_FORMAT);
    setFormula(sheet.getCell(mainRow, 7), `ROUND(E${mainRow}*F${mainRow},2)`, MONEY_FORMAT);
    stats.detailSubtotalFormulas++;
    stats.mainItemFormulas += 2;

    row = enterpriseRow + 1;
  }
}

function addSummaryFormulas(
  sheet: ExcelJS.Worksheet,
  analysisSheets: Array<{ sheet: ExcelJS.Worksheet; category: string }>,
  safetySheet: ExcelJS.Worksheet | undefined,
  stats: FormulaStats,
) {
  const codeRows = new Map<string, number>();
  const labelRows = new Map<string, number>();

  for (let row = 1; row <= sheet.rowCount; row++) {
    const code = text(sheet.getCell(row, 1).value);
    const label = text(sheet.getCell(row, 2).value);
    if (code) codeRows.set(code, row);
    if (label) labelRows.set(label, row);
  }

  for (const { sheet: analysisSheet, category } of analysisSheets) {
    const row = labelRows.get(category);
    if (!row) continue;
    setFormula(sheet.getCell(row, 3), `SUMIF(${quoteSheet(analysisSheet.name)}!$A:$A,">0",${quoteSheet(analysisSheet.name)}!$G:$G)`, MONEY_FORMAT);
    stats.summaryFormulas++;
  }

  setFormulaByCode(sheet, codeRows, '1.1', sumCategoryFormula(labelRows, analysisSheets.map((item) => item.category)), stats);
  setFormulaByCode(sheet, codeRows, '1', codeRows.has('1.1') ? `C${codeRows.get('1.1')}` : '', stats);
  const row1 = codeRows.get('1');
  if (safetySheet && row1) {
    setFormulaByCode(sheet, codeRows, '2.1', `ROUND(C${row1}*${getSafetyRate(safetySheet)}/100,2)`, stats);
  }
  setFormulaByCode(sheet, codeRows, '2', sumCodesFormula(codeRows, ['2.1', '2.2']), stats);
  setFormulaByCode(sheet, codeRows, '3', sumCodesFormula(codeRows, ['3.1', '3.2', '3.3', '3.4']), stats);

  const row2 = codeRows.get('2');
  const row3 = codeRows.get('3');
  const row32 = codeRows.get('3.2');
  const row4 = codeRows.get('4');
  if (row1 && row2 && row3 && row4) {
    const excludeTempProfessional = row32 ? `-VALUE(C${row32})` : '';
    setFormula(sheet.getCell(row4, 3), `ROUND((C${row1}+C${row2}+C${row3}${excludeTempProfessional})*0.09,2)`, MONEY_FORMAT);
    stats.summaryFormulas++;
  }

  const totalRow = findTotalRow(sheet);
  if (totalRow && row1 && row2 && row3 && row4) {
    setFormula(sheet.getCell(totalRow, 3), `ROUND(C${row1}+C${row2}+C${row3}+C${row4},2)`, MONEY_FORMAT);
    stats.summaryFormulas++;
  }
}

function addSafetyFormulas(sheet: ExcelJS.Worksheet, summarySheet: ExcelJS.Worksheet, stats: FormulaStats) {
  if (sheet.rowCount < 2) return;
  const summaryCodeRows = getCodeRows(summarySheet);
  const partFeeRow = summaryCodeRows.get('1');
  if (partFeeRow) {
    setFormula(sheet.getCell(2, 6), `${quoteSheet(summarySheet.name)}!C${partFeeRow}`, MONEY_FORMAT);
  }
  setFormula(sheet.getCell(2, findSafetyAmountColumn(sheet)), `ROUND(F2*${columnLetter(findSafetyRateColumn(sheet))}2/100,2)`, MONEY_FORMAT);
  stats.safetyFormulas += 2;
}

function findSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return workbook.worksheets.find((sheet) => sheet.name === name);
}

function setFormula(cell: ExcelJS.Cell, formula: string, numFmt?: string) {
  if (!formula) return;
  const previousValue = formulaResultFallback(cell.value);
  cell.value = previousValue === undefined ? { formula } : { formula, result: previousValue };
  if (numFmt) cell.numFmt = numFmt;
}

function formulaResultFallback(value: ExcelCellValue): string | number | boolean | Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') {
    if ('result' in value) {
      const result = value.result;
      if (result === null || result === undefined) return undefined;
      return typeof result === 'string' ? parseNumericString(result) ?? result : result as string | number | boolean | Date | undefined;
    }
    return undefined;
  }
  return typeof value === 'string' ? parseNumericString(value) ?? value : value;
}

function numberFormulaFallback(value: ExcelCellValue): string {
  const direct = formulaResultFallback(value);
  if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct);
  const parsed = parseNumericString(String(direct ?? ''));
  return parsed === undefined ? '0' : String(parsed);
}

function parseNumericString(value: string): number | undefined {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return undefined;
  const numericPattern = /^-?(?:\d+|\d*\.\d+)(?:%?)$/;
  if (!numericPattern.test(normalized)) return undefined;
  const isPercent = normalized.endsWith('%');
  const parsed = Number(normalized.replace(/%$/, ''));
  if (!Number.isFinite(parsed)) return undefined;
  return isPercent ? parsed / 100 : parsed;
}

function setFormulaResult(cell: ExcelJS.Cell, result: number, numFmt?: string) {
  const formula = extractExistingFormula(cell);
  cell.value = formula ? { formula, result } : result;
  if (numFmt) cell.numFmt = numFmt;
}

function extractExistingFormula(cell: ExcelJS.Cell): string | undefined {
  if (typeof cell.value !== 'object' || cell.value === null) return undefined;
  if ('formula' in cell.value && typeof cell.value.formula === 'string') return cell.value.formula;
  if ('sharedFormula' in cell.value && typeof cell.value.sharedFormula === 'string') return cell.value.sharedFormula;
  return undefined;
}

function setFormulaResultByCode(sheet: ExcelJS.Worksheet, codeRows: Map<string, number>, code: string, result: number) {
  const row = codeRows.get(code);
  if (!row) return;
  setFormulaResult(sheet.getCell(row, 3), round(result, 2), MONEY_FORMAT);
}

function sumChildValues(sheet: ExcelJS.Worksheet, codeRows: Map<string, number>, parentCode: string): number {
  return [...codeRows.entries()]
    .filter(([code]) => code.startsWith(`${parentCode}.`) && code.slice(parentCode.length + 1).match(/^\d+$/))
    .reduce((sum, [, row]) => sum + toNumber(sheet.getCell(row, 3).value), 0);
}

function sumColumn(sheet: ExcelJS.Worksheet, col: number, startRow: number): number {
  let total = 0;
  for (let row = startRow; row <= sheet.rowCount; row++) {
    total += toNumber(sheet.getCell(row, col).value);
  }
  return round(total, 2);
}

function sumCategoryRows(
  sheet: ExcelJS.Worksheet,
  labelRows: Map<string, number>,
  categoryTotals: Map<string, number>,
): number {
  let total = 0;
  for (const category of categoryTotals.keys()) {
    const row = labelRows.get(category);
    if (row) total += toNumber(sheet.getCell(row, 3).value);
  }
  return round(total, 2);
}

function sumKnownCodes(sheet: ExcelJS.Worksheet, codeRows: Map<string, number>, codes: string[]): number {
  return round(codes.reduce((sum, code) => {
    const row = codeRows.get(code);
    return sum + (row ? toNumber(sheet.getCell(row, 3).value) : 0);
  }, 0), 2);
}

function findSafetyAmountColumn(sheet: ExcelJS.Worksheet): number {
  for (let row = 1; row <= Math.min(sheet.rowCount, 5); row++) {
    for (let col = 1; col <= Math.max(sheet.columnCount, 8); col++) {
      const label = text(sheet.getCell(row, col).value).replace(/\s+/g, '');
      if (label.includes('金额') && label.includes('元')) return col;
    }
  }
  return 8;
}

function findSafetyRateColumn(sheet: ExcelJS.Worksheet): number {
  for (let row = 1; row <= Math.min(sheet.rowCount, 5); row++) {
    for (let col = 1; col <= Math.max(sheet.columnCount, 8); col++) {
      const label = text(sheet.getCell(row, col).value).replace(/\s+/g, '');
      if (label.includes('费率') || label.includes('费率(%)') || label.includes('费率（%）')) return col;
    }
  }
  return 7;
}

function getSafetyRate(sheet: ExcelJS.Worksheet): number {
  return toNumber(sheet.getCell(2, findSafetyRateColumn(sheet)).value);
}

function getCodeRows(sheet: ExcelJS.Worksheet): Map<string, number> {
  const codeRows = new Map<string, number>();
  for (let row = 1; row <= sheet.rowCount; row++) {
    const code = text(sheet.getCell(row, 1).value);
    if (code) codeRows.set(code, row);
  }
  return codeRows;
}

function sumCategoryFormula(labelRows: Map<string, number>, categories: string[]): string {
  const rows = categories.map((category) => labelRows.get(category)).filter((row): row is number => Boolean(row));
  return sumRowsFormula(rows);
}

function sumCodesFormula(codeRows: Map<string, number>, codes: string[]): string {
  const rows = codes.map((code) => codeRows.get(code)).filter((row): row is number => Boolean(row));
  return sumRowsFormula(rows);
}

function sumRowsFormula(rows: number[]): string {
  if (rows.length === 0) return '';
  if (rows.length === 1) return `C${rows[0]}`;
  return `SUM(${rows.map((row) => `C${row}`).join(',')})`;
}

function columnLetter(col: number): string {
  let value = col;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || 'A';
}

function findResourcePrice(resourcePrices: Map<string, number>, code: string): number | undefined {
  const normalized = normalizeCode(code);
  if (!normalized) return undefined;
  return resourcePrices.get(normalized)
    ?? resourcePrices.get(normalizeCode(normalized.split('@')[0] || ''));
}

function normalizeCode(code: string): string {
  return String(code || '').replace(/\s+/g, '').trim();
}

function toNumber(value: ExcelCellValue): number {
  const direct = formulaResultFallback(value);
  if (typeof direct === 'number') return Number.isFinite(direct) ? direct : 0;
  if (typeof direct === 'boolean') return direct ? 1 : 0;
  if (direct instanceof Date) return 0;
  const parsed = parseNumericString(String(direct ?? ''));
  return parsed ?? 0;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function text(value: ExcelCellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text).trim();
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
    if ('result' in value) return text(value.result as ExcelCellValue);
    return '';
  }
  return String(value).trim();
}

function isMainHeader(sheet: ExcelJS.Worksheet, row: number): boolean {
  return text(sheet.getCell(row, 1).value) === '序号'
    && text(sheet.getCell(row, 2).value).includes('项目编码')
    && text(sheet.getCell(row, 6).value).includes('综合单价');
}

function findEnterpriseHeader(sheet: ExcelJS.Worksheet, startRow: number): number | null {
  for (let row = startRow; row <= sheet.rowCount; row++) {
    if (row > startRow && isMainHeader(sheet, row)) return null;
    if (text(sheet.getCell(row, 1).value).includes('企业管理费及利润')
      && text(sheet.getCell(row, 2).value).includes('组价内容')) {
      return row;
    }
  }
  return null;
}

function sumDescendantFormula(codeRows: Map<string, number>, parentCode: string): string {
  const childRows = [...codeRows.entries()]
    .filter(([code]) => code.startsWith(`${parentCode}.`) && code.slice(parentCode.length + 1).match(/^\d+$/))
    .map(([, row]) => row)
    .sort((a, b) => a - b);

  if (childRows.length === 0) return '';
  if (childRows.length === 1) return `C${childRows[0]}`;
  return `SUM(${childRows.map((row) => `C${row}`).join(',')})`;
}

function setFormulaByCode(sheet: ExcelJS.Worksheet, codeRows: Map<string, number>, code: string, formula: string, stats: FormulaStats) {
  const row = codeRows.get(code);
  if (!row || !formula) return;
  setFormula(sheet.getCell(row, 3), formula, MONEY_FORMAT);
  stats.summaryFormulas++;
}

function findTotalRow(sheet: ExcelJS.Worksheet): number | null {
  for (let row = 1; row <= sheet.rowCount; row++) {
    const label = `${text(sheet.getCell(row, 1).value)} ${text(sheet.getCell(row, 2).value)}`;
    if (label.includes('合计')) return row;
  }
  return null;
}

function quoteSheet(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}
