import { NextRequest, NextResponse } from 'next/server';
import { buildFormulaWorkbook } from '@/lib/bidding/formula-workbook-export';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileBase64 } = body as { fileBase64?: string };

    if (!fileBase64) {
      return NextResponse.json({ success: false, error: '请上传清单组价表 Excel 文件' }, { status: 400 });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const { buffer: outputBuffer, stats } = await buildFormulaWorkbook(new Uint8Array(buffer).buffer);

    return NextResponse.json({
      success: true,
      fileName: '公式版清单组价表.xlsx',
      fileBase64: outputBuffer.toString('base64'),
      stats,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
