import type { Message } from '@/lib/ai-service';

export type DiscoverQueryScope = 'webpage' | 'scholar';

export type DiscoverQueryPlan = {
  originalQuery: string;
  optimizedQuery: string;
  keywords: string[];
};

type QueryPlanInvoker = (
  messages: Message[],
  options: { temperature: number; thinking: 'disabled'; maxTokens: number; signal?: AbortSignal },
) => Promise<string>;

function compact(value: unknown, maxLength = 240): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('检索式优化服务返回异常');
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error('检索式优化服务返回异常');
  }
}

export function normalizeDiscoverQueryPlan(originalQuery: string, raw: string): DiscoverQueryPlan {
  const original = compact(originalQuery);
  const parsed = parseJsonObject(raw);
  const optimized = compact(parsed.optimizedQuery || parsed.searchQuery || parsed.query);
  if (!original || !optimized) throw new Error('检索式优化服务未返回可用检索式');
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map(item => compact(item, 60)).filter(Boolean).slice(0, 6)
    : [];
  return { originalQuery: original, optimizedQuery: optimized, keywords };
}

export async function optimizeDiscoverQuery(
  originalQuery: string,
  scope: DiscoverQueryScope,
  invoke: QueryPlanInvoker,
  signal?: AbortSignal,
): Promise<DiscoverQueryPlan> {
  const original = compact(originalQuery);
  if (!original) throw new Error('请输入搜索关键词');
  const sourceLabel = scope === 'scholar' ? '学术论文数据库' : '联网网页搜索';
  const response = await invoke([
    {
      role: 'system',
      content: [
        `你是${sourceLabel}的检索式规划器。`,
        '只改写检索式，不回答问题，不生成论文题名、作者、链接、引用或事实。',
        '保留用户核心意图，去掉对话性表达，补充必要英文术语和同义词。',
        '输出严格 JSON：{"optimizedQuery":"一条可直接检索的中英双语检索式","keywords":["最多6个关键词"]}。',
      ].join(''),
    },
    { role: 'user', content: original },
  ], { temperature: 0.1, thinking: 'disabled', maxTokens: 220, signal });
  return normalizeDiscoverQueryPlan(original, response);
}
