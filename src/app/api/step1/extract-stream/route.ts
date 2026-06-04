import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils, Message } from 'coze-coding-dev-sdk';

export const dynamic = 'force-dynamic';

/**
 * POST /api/step1/extract-stream
 * 流式AI提取招标文件商务条款（SSE）
 */
export async function POST(request: NextRequest) {
  const { content } = await request.json();
  if (!content || typeof content !== 'string') {
    return new Response(JSON.stringify({ error: '请提供招标文件文本内容' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const config = new Config();
  const client = new LLMClient(config, customHeaders);

  const systemPrompt = `你是一位专业的工程造价咨询师，擅长从招标文件中提取商务条款信息。
请从提供的招标文件文本中，提取以下8大分类的商务条款信息，以JSON数组格式返回。

每个条目包含以下字段：
- category: 分类名称
- item: 条款名称
- content: 条款具体内容/数值
- impact: 对报价的影响分析（高/中/低）
- note: 备注

8大分类：
1. 投标报价要求
2. 工期要求
3. 质量要求
4. 付款条件
5. 保证金与保险
6. 变更与索赔
7. 违约与争议
8. 其他商务条款

只返回JSON数组，不要其他内容。`;

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请从以下招标文件中提取商务条款信息：\n\n${content}` },
  ];

  const stream = client.stream(messages, {
    model: 'doubao-seed-2-0-pro-260215',
    temperature: 0.2,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.content) {
            const text = chunk.content.toString();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: String(error) })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
