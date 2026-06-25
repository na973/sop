import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `你是一位专业的工程造价咨询师，擅长从招标文件中提取商务条款信息。
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

  const ai = getAiConfig();
  if (!ai.apiKey) {
    return new Response(JSON.stringify({
      error: '未配置 STEP4_AI_API_KEY。请在 .env.local 中配置 DeepSeek Key 后重启服务。',
    }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upstream = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ai.apiKey}`,
    },
    body: JSON.stringify({
      model: ai.model,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `请从以下招标文件中提取商务条款信息：\n\n${content}` },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const raw = await upstream.text();
    return new Response(JSON.stringify({ error: `AI接口请求失败：${upstream.status}`, raw }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              continue;
            }

            try {
              const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
              const text = chunk.choices?.[0]?.delta?.content;
              if (text) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
              }
            } catch {
              // 忽略上游心跳或非JSON片段。
            }
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(error) })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function getAiConfig() {
  return {
    apiKey: process.env.STEP4_AI_API_KEY,
    baseUrl: (process.env.STEP4_AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
    model: process.env.STEP4_AI_MODEL || 'deepseek-chat',
  };
}
