import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { fileBase64?: string };
    const { fileBase64 } = body;

    if (!fileBase64) {
      return NextResponse.json({ success: false, error: '请提供PDF文件' }, { status: 400 });
    }

    const buffer = Buffer.from(fileBase64, 'base64');

    // Step 1: Try pdf-parse first (fast, works for text-based PDFs)
    let text = '';
    let pages = 0;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      text = data.text || '';
      pages = data.numpages || 0;
    } catch {
      // pdf-parse failed, try LLM vision fallback
    }

    // Step 2: If text is too short (likely scanned PDF), use LLM vision OCR
    const MIN_TEXT_LENGTH = 100;
    if (!text || text.trim().length < MIN_TEXT_LENGTH) {
      console.log('[PDF Parse] Text too short or empty, falling back to LLM vision OCR...');
      try {
        const visionResult = await extractWithVision(buffer);
        if (visionResult.text && visionResult.text.trim().length > text.trim().length) {
          text = visionResult.text;
          pages = visionResult.pages || pages;
        }
      } catch (visionErr) {
        console.error('[PDF Parse] Vision OCR failed:', visionErr instanceof Error ? visionErr.message : String(visionErr));
      }
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'PDF文件无法提取文本内容。请确认文件包含可识别的文本。',
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      text: text.trim(),
      pages,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      success: false,
      error: `PDF解析失败: ${msg}`,
    }, { status: 500 });
  }
}

async function extractWithVision(_buffer: Buffer): Promise<{ text: string; pages: number }> {
  // Convert PDF pages to images using pdf-to-img, then send to LLM vision model
  const { pdf } = await import('pdf-to-img');
  const { LLMClient } = await import('coze-coding-dev-sdk');

  const doc = await pdf(_buffer, { scale: 2 });
  const totalPages = doc.length;

  let fullText = '';
  const MAX_PAGES_FOR_VISION = 10; // Limit pages to avoid token overflow

  const client = new LLMClient();

  for (let i = 1; i <= Math.min(totalPages, MAX_PAGES_FOR_VISION); i++) {
    const page = await doc.getPage(i);
    // page is a Buffer containing PNG image data
    const pageBase64 = Buffer.from(page).toString('base64');
    const imageUrl = `data:image/png;base64,${pageBase64}`;

    try {
      const response = await client.invoke(
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: '请仔细识别这张图片中的所有文字内容，原样输出，不要遗漏任何信息。这是一份招标文件的页面。' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        { model: 'doubao-seed-2-0-pro-260215' },
      );

      const pageText = response.content || '';
      if (pageText) {
        fullText += `\n--- 第${i}页 ---\n${pageText}`;
      }
    } catch (pageErr) {
      console.error(`[PDF Vision] Page ${i} OCR failed:`, pageErr instanceof Error ? pageErr.message : String(pageErr));
    }
  }

  return { text: fullText, pages: totalPages };
}
