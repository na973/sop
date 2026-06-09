import ExcelJS from 'exceljs';

/** 将表格数据导出为Excel文件（返回base64） */
export async function exportToExcel(
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Array<Array<string | number | boolean | null>>;
  }>,
  fileName: string,
): Promise<{ base64: string; fileName: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '商务标报价系统';
  workbook.created = new Date();

  for (const sheetDef of sheets) {
    const ws = workbook.addWorksheet(sheetDef.name);
    // Header row
    const headerRow = ws.addRow(sheetDef.headers);
    headerRow.font = { bold: true, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    headerRow.alignment = { horizontal: 'center' };

    // Data rows
    for (const row of sheetDef.rows) {
      ws.addRow(row);
    }

    // Auto-fit column widths (approximate)
    ws.columns.forEach((col, i) => {
      const headerLen = sheetDef.headers[i]?.length ?? 8;
      const maxDataLen = Math.max(
        ...sheetDef.rows.map((r) => String(r[i] ?? '').length),
        headerLen,
      );
      col.width = Math.min(Math.max(maxDataLen * 1.5, 10), 40);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return { base64, fileName };
}

/** 在浏览器端触发下载base64文件 */
export function downloadBase64File(base64: string, fileName: string, mimeType: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const byteCharacters = atob(base64);
  const byteArrays: Uint8Array[] = [];
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  const blob = new Blob(byteArrays as BlobPart[], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** 格式化数字 */
export function fmt(n: number | null | undefined, decimals: number = 2): string {
  if (n == null || isNaN(n)) return '-';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
