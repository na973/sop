import { NextResponse } from 'next/server';
// @ts-expect-error pdf-parse v2 ESM/CJS interop
import pdfParse from 'pdf-parse';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { fileBase64?: string };
    const { fileBase64 } = body;

    if (!fileBase64) {
      return NextResponse.json({ success: false, error: '请提供PDF文件' }, { status: 400 });
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(fileBase64, 'base64');

    // Parse PDF
    const data = await pdfParse(buffer);
    const text = data.text;

    if (!text || text.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'PDF文件无法提取文本内容，可能是扫描件图片。请尝试OCR或手动输入。',
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      text: text.trim(),
      pages: data.numpages,
      info: data.info,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      success: false,
      error: `PDF解析失败: ${msg}`,
    }, { status: 500 });
  }
}
