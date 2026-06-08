import { NextResponse } from 'next/server';
import { pathToFileURL } from 'url';
import { PDFParse } from 'pdf-parse';
import { getPath as getPdfWorkerPath } from 'pdf-parse/worker';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { fileBase64?: string };
    const { fileBase64 } = body;

    if (!fileBase64) {
      return NextResponse.json({ success: false, error: '请提供PDF文件' }, { status: 400 });
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(fileBase64, 'base64');

    // Next/Turbopack cannot infer pdf.js worker location reliably, so point it
    // at the package-provided worker file explicitly.
    PDFParse.setWorker(pathToFileURL(getPdfWorkerPath()).href);

    // Parse PDF. pdf-parse v2 exposes PDFParse instead of a default function.
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    let text = '';
    let pages = 0;
    let info: unknown = null;
    try {
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      text = textResult.text;
      pages = textResult.total;
      info = infoResult;
    } finally {
      await parser.destroy();
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'PDF文件无法提取文本内容，可能是扫描件图片。请尝试OCR或手动输入。',
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      text: text.trim(),
      pages,
      info,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      success: false,
      error: `PDF解析失败: ${msg}`,
    }, { status: 500 });
  }
}
