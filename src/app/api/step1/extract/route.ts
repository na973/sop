import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `你是一位专业的工程造价咨询师，擅长从招标文件中提取商务条款信息。
请从提供的招标文件文本中，提取以下8大分类的商务条款信息，以JSON数组格式返回。

每个条目包含以下字段：
- category: 分类名称（从以下8类中选择）
- item: 条款名称
- content: 条款具体内容/数值
- impact: 对报价的影响分析（高/中/低）
- note: 备注

8大分类：
1. 投标报价要求（报价方式、币种、小数位数等）
2. 工期要求（总工期、节点工期、延误赔偿等）
3. 质量要求（质量标准、验收方式、缺陷责任期等）
4. 付款条件（预付款比例、进度款支付方式、结算方式等）
5. 保证金与保险（投标保证金、履约保证金、工程保险等）
6. 变更与索赔（变更程序、索赔时限、调价方式等）
7. 违约与争议（违约责任、争议解决方式等）
8. 其他商务条款（暂列金额、暂估价、甲供材等）

请确保提取的信息准确、完整，数值类信息保留原文表述。
只返回JSON数组，不要其他内容。`;

/**
 * POST /api/step1/extract
 * AI提取招标文件商务条款
 * Body: { content: string }  招标文件文本内容
 */
export async function POST(request: NextRequest) {
  try {
    const { content } = await request.json();
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ success: false, error: '请提供招标文件文本内容' }, { status: 400 });
    }

    const ai = getAiConfig();
    if (!ai.apiKey) {
      return NextResponse.json({
        success: false,
        configured: false,
        error: '未配置 STEP4_AI_API_KEY。请在 .env.local 中配置 DeepSeek Key 后重启服务。',
        expectedEnv: ['STEP4_AI_API_KEY', 'STEP4_AI_BASE_URL', 'STEP4_AI_MODEL'],
      }, { status: 501 });
    }

    const response = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `请从以下招标文件中提取商务条款信息：\n\n${content}` },
        ],
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      return NextResponse.json({ success: false, error: `AI接口请求失败：${response.status}`, raw }, { status: 502 });
    }

    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const aiContent = parsed.choices?.[0]?.message?.content || '';
    const extractedData = parseExtractedData(aiContent);

    return NextResponse.json({
      success: true,
      data: extractedData,
      raw: aiContent,
    });
  } catch (error) {
    console.error('Step1 extract error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

function getAiConfig() {
  return {
    apiKey: process.env.STEP4_AI_API_KEY,
    baseUrl: (process.env.STEP4_AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
    model: process.env.STEP4_AI_MODEL || 'deepseek-chat',
  };
}

function parseExtractedData(content: string): unknown[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as unknown[];
    return [{ category: '提取结果', item: '原始输出', content, impact: '中', note: 'AI未能输出标准JSON格式' }];
  } catch {
    return [{ category: '提取结果', item: '原始输出', content, impact: '中', note: 'JSON解析失败' }];
  }
}
