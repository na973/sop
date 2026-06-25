import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type StrategyLevel = '极高' | '高' | '平均偏高' | '平均偏低' | '低' | '极低';

interface StrategyItemInput {
  row: number;
  category: string;
  code: string;
  name: string;
  feature?: string;
  unit?: string;
  quantity?: number;
  maxUnitPrice?: number;
  maxTotalPrice?: number;
  ourUnitPrice?: number;
  deviationRate?: number;
  deviationLevel?: string;
  isScreeningItem?: boolean;
  optimization?: string;
  projectMajorType?: string;
  projectSubType?: string;
  checklistStep?: string;
  strategyLevel?: string;
  suggestion?: string;
  reason?: string;
}

interface AiSuggestion {
  row: number;
  category: string;
  code: string;
  strategyLevel: StrategyLevel;
  suggestion: string;
  reason: string;
  projectMajorType?: string;
  projectSubType?: string;
  checklistStep?: string;
  reviewStatus?: string;
}

const STRATEGY_LEVELS = new Set(['极高', '高', '平均偏高', '平均偏低', '低', '极低']);
const PROMPT_FILE_PATH = resolve(process.cwd(), '..', '样表', '步骤4ai提示词.md');
const FALLBACK_SYSTEM_PROMPT = `你是商务标不平衡报价策略助手。
你的任务：根据新版步骤4原则，识别工程大类、工程子类、清单步骤/利润点类型，并给每条清单输出建议价格等级和判断理由。

重要约束：
1. 只能从以下等级中选择：极高、高、平均偏高、平均偏低、低、极低。
2. AI只是辅助建议，不能直接决定最终价格；输出应便于人工复核。
3. AI自动建议时的判断顺序必须是：总利润增量原则 > 是否是单价甄别项目（单价甄别不扣分，只做约束） > 工程量能否优化原则。
4. 人工判断发生在AI给出建议之后；如果后续人工修改建议等级，人工修改结果才是最终等级。
5. 不要把每个维度折算成分数，不要输出总分。
6. 预计结算量增加、变更概率高、签证概率高、旧改/维修检测不准的清单，优先提高建议等级。
7. 工程量小、设计明确、量差小、结算量可能减少或主要用于总价配平的清单，优先降低建议等级。
8. 单价甄别项目不直接拉高或拉低等级，但必须提醒后续步骤5做动态允许范围校验。
9. 如果无法确认工程类型或清单步骤，reviewStatus 必须写“需人工复核”。
10. 必须只返回 JSON，不要 Markdown，不要解释性前后缀。`;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { items, rulesText = '' } = await request.json() as {
      items?: StrategyItemInput[];
      rulesText?: string;
    };

    if (!items?.length) {
      return NextResponse.json({ success: false, error: '请提供步骤4清单 items' }, { status: 400 });
    }

    const apiKey = process.env.STEP4_AI_API_KEY;
    const baseUrl = (process.env.STEP4_AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
    const model = process.env.STEP4_AI_MODEL || 'deepseek-chat';

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        configured: false,
        error: '未配置 STEP4_AI_API_KEY。请在 .env.local 中配置后重启服务。',
        expectedEnv: ['STEP4_AI_API_KEY', 'STEP4_AI_BASE_URL', 'STEP4_AI_MODEL'],
      }, { status: 501 });
    }

    const compactItems = items.map((item) => ({
      row: item.row,
      category: item.category,
      code: item.code,
      name: item.name,
      feature: item.feature,
      quantity: item.quantity,
      maxUnitPrice: item.maxUnitPrice,
      maxTotalPrice: item.maxTotalPrice,
      ourUnitPrice: item.ourUnitPrice,
      deviationRate: item.deviationRate,
      deviationLevel: item.deviationLevel,
      isScreeningItem: item.isScreeningItem,
      optimization: item.optimization,
      projectMajorType: item.projectMajorType,
      projectSubType: item.projectSubType,
      checklistStep: item.checklistStep,
      currentStrategyLevel: item.strategyLevel,
      currentSuggestion: item.suggestion,
    }));

    const systemPrompt = readStep4Prompt();

    const userPrompt = `请严格按照 system message 中的《步骤4 AI 提示词》执行。

补充规则：
${rulesText || '无额外补充，按步骤4ai提示词.md 和公式引擎计算规则执行。'}

请为以下清单输出 JSON，顶层必须是 suggestions：
{
  "suggestions": [
    {
      "row": 数字,
      "category": "分部",
      "code": "项目编码",
      "projectMajorType": "工程大类",
      "projectSubType": "工程子类",
      "checklistStep": "清单步骤或利润点类型",
      "strategyLevel": "极高/高/平均偏高/平均偏低/低/极低",
      "suggestion": "一句报价建议",
      "reason": "一句判断理由",
      "reviewStatus": "系统已判断/需人工复核"
    }
  ]
}

清单数据：
${JSON.stringify(compactItems)}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      return NextResponse.json({
        success: false,
        configured: true,
        error: `AI接口请求失败：${response.status}`,
        raw,
      }, { status: 502 });
    }

    const parsed = parseJsonOrThrow<{ choices?: Array<{ message?: { content?: string } }> }>(
      raw,
      'AI接口响应不是合法JSON',
    );
    const content = parsed.choices?.[0]?.message?.content || '';
    const result = parseAiSuggestions(content);
    const suggestions = sanitizeSuggestions(result.suggestions || [], items);

    return NextResponse.json({
      success: true,
      configured: true,
      suggestions,
      raw: content,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function readStep4Prompt(): string {
  try {
    const promptText = readFileSync(PROMPT_FILE_PATH, 'utf8').trim();
    if (promptText) return promptText;
  } catch {
    // Use the embedded fallback so AI still works if the sample document is moved.
  }
  return FALLBACK_SYSTEM_PROMPT;
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  return content.trim();
}

function parseAiSuggestions(content: string): { suggestions?: AiSuggestion[] } {
  const jsonText = extractJson(content);
  const parsed = parseJsonOrThrow<unknown>(
    jsonText,
    '步骤4 AI 返回的 JSON 格式不完整，程序已尝试自动修复但仍失败。请重新点击 DeepSeek 辅助建议；如果仍失败，建议减少一次处理的清单数量。',
  );
  if (Array.isArray(parsed)) return { suggestions: parsed as AiSuggestion[] };
  if (isRecord(parsed) && Array.isArray(parsed.suggestions)) {
    return { suggestions: parsed.suggestions as AiSuggestion[] };
  }
  throw new Error('步骤4 AI 返回 JSON 中缺少 suggestions 数组，请重新生成 AI 建议。');
}

function parseJsonOrThrow<T>(text: string, message: string): T {
  const attempts = getJsonCandidates(text);
  const errors: string[] = [];
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const lastError = errors.at(-1) || '未知JSON解析错误';
  throw new Error(`${message} 原因：${lastError}`);
}

function getJsonCandidates(text: string): string[] {
  const raw = text.trim();
  const extracted = extractJson(raw);
  const candidates = new Set<string>([raw, extracted]);
  for (const candidate of [raw, extracted]) {
    const repaired = repairCommonJsonIssues(candidate);
    candidates.add(repaired);
    const completed = completeLikelyTruncatedJson(repaired);
    candidates.add(completed);
    if (completed.trim().startsWith('[')) {
      candidates.add(`{"suggestions":${completed}}`);
    }
  }
  return [...candidates].filter(Boolean);
}

function repairCommonJsonIssues(text: string): string {
  return text
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/}\s*{/g, '},{')
    .replace(/]\s*{/g, '],{')
    .replace(/}\s*"/g, '},"')
    .replace(/]\s*"/g, '],"');
}

function completeLikelyTruncatedJson(text: string): string {
  let output = text.trim();
  const openBraces = countChar(output, '{') - countChar(output, '}');
  const openBrackets = countChar(output, '[') - countChar(output, ']');
  if (openBraces > 0 || openBrackets > 0) {
    output = output.replace(/,\s*$/, '');
    output += ']'.repeat(Math.max(openBrackets, 0));
    output += '}'.repeat(Math.max(openBraces, 0));
  }
  return output;
}

function countChar(text: string, char: string): number {
  return [...text].filter((item) => item === char).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeSuggestions(suggestions: AiSuggestion[], sourceItems: StrategyItemInput[]): AiSuggestion[] {
  const sourceKeys = new Set(sourceItems.map((item) => makeKey(item)));
  return suggestions
    .filter((item) => sourceKeys.has(makeKey(item)))
    .map((item) => ({
      row: Number(item.row),
      category: String(item.category || ''),
      code: String(item.code || ''),
      projectMajorType: String(item.projectMajorType || '').slice(0, 40),
      projectSubType: String(item.projectSubType || '').slice(0, 40),
      checklistStep: String(item.checklistStep || '').slice(0, 80),
      strategyLevel: STRATEGY_LEVELS.has(item.strategyLevel) ? item.strategyLevel : '平均偏低',
      suggestion: String(item.suggestion || 'AI建议需人工复核').slice(0, 120),
      reason: String(item.reason || 'AI辅助判断，需人工复核').slice(0, 240),
      reviewStatus: String(item.reviewStatus || '需人工复核').slice(0, 40),
    }));
}

function makeKey(item: Pick<StrategyItemInput, 'row' | 'category' | 'code'>): string {
  return `${item.category}::${item.row}::${item.code}`;
}
