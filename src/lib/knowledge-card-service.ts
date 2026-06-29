import { llmInvoke } from '@/lib/ai-service';
import { auditCitationMarkers } from '@/lib/citation-audit';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { readKnowledgeCardCache, writeKnowledgeCardCache } from '@/lib/knowledge-card-cache';
import type { KnowledgeCardData } from '@/lib/knowledge-card-types';
import type { RagSourceInput } from '@/lib/rag';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { CitationAuditResult, RuntimeAIConfig } from '@/types';

const SYSTEM_PROMPT = `你是一个资料知识卡片整理助手。你的任务是从资料中提炼可追溯、可复用的知识卡片。

每张卡片包含以下字段：
- category: 分类，必须是以下之一：「核心概念」「关键要点」「背景脉络」「方法线索」「结论启发」
- title: 卡片标题，简洁的问句、概念名或要点名（10-25字）
- content: 详细解析，200-400字，通俗易懂地解释
- extra: 补充信息，如关键数据、公式、引用来源或后续提问建议（50-100字）

要求：
1. 每份资料生成 4-7 张知识卡片
2. 覆盖不同分类，不要只集中在某一种
3. 提取资料中最有价值、最具学习意义的内容
4. content 应该让非专业读者也能理解，必要时使用类比
5. content 或 extra 必须使用 [1]、[2] 这样的来源编号标注支撑证据，不要编造未出现的来源
6. extra 提供原文的关键数据、公式或引用支撑

请严格按照以下 JSON 格式输出，不要输出任何其他内容：
{
  "cards": [
    {
      "category": "核心概念",
      "title": "...",
      "content": "...",
      "extra": "..."
    }
  ]
}`;

export interface KnowledgeCardRequestInput {
  papers: RagSourceInput[];
  aiConfig?: Partial<RuntimeAIConfig>;
  debugRetrievalOnly?: boolean;
  debugAnswerText?: string;
  forceRefresh?: boolean;
  ownerMemberId?: string;
  notebookId?: string;
}

export async function buildKnowledgeCardsPayload(input: KnowledgeCardRequestInput) {
  const { papers, aiConfig, debugRetrievalOnly, debugAnswerText, forceRefresh, ownerMemberId, notebookId } = input;
  if (!papers || papers.length === 0) {
    return { error: '请提供资料内容', status: 400 as const };
  }

  const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);
  const scope = { ownerMemberId, notebookId };
  if (!debugRetrievalOnly && !forceRefresh) {
    const cached = await readKnowledgeCardCache(papers, runtimeConfig, scope);
    if (cached) return { body: cached, status: 200 as const };
  }

  const grounded = await buildGroundedRetrievalContext('梳理核心概念、关键要点、背景脉络、方法线索和结论启发', papers, runtimeConfig, { topK: 10, ownerMemberId, notebookId });
  if (debugRetrievalOnly) {
    return {
      body: {
        success: true,
        citations: grounded.citations,
        retrieval: toRetrievalMetadata(grounded),
        citationAudit: typeof debugAnswerText === 'string'
          ? auditCitationMarkers(debugAnswerText, grounded.citations)
          : undefined,
        promptContextLength: grounded.promptContext.length,
      },
      status: 200 as const,
    };
  }

  const papersText = papers
    .map((paper, index) => `--- 资料 ${index + 1}: ${paper.title} ---\n摘要: ${paper.abstract}\n正文: ${paper.content}`)
    .join('\n\n');
  const evidenceContext = grounded.promptContext || papersText;
  const result = await llmInvoke([
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `请从以下检索证据片段中生成知识卡片。每张卡片的 content 或 extra 字段必须使用 [1]、[2] 这样的来源编号标注支撑证据，不要编造未出现的来源；如需补充 chunkId，可放在 extra 中。\n\n${evidenceContext}`,
    },
  ], { temperature: 0.5 }, undefined, runtimeConfig);

  const cards = parseKnowledgeCardResult(result);
  if (cards.length === 0) {
    return { error: '未能生成知识卡片，请重试', status: 500 as const };
  }

  const auditText = cards.map(card => `${card.title}\n${card.content}\n${card.extra}`).join('\n\n');
  const retrieval = toRetrievalMetadata(grounded);
  const citationAudit = auditCitationMarkers(auditText, grounded.citations) as CitationAuditResult;
  const response = {
    cards,
    citations: grounded.citations,
    retrieval,
    citationAudit,
  };
  const cache = await writeKnowledgeCardCache(papers, runtimeConfig, response, scope);
  return {
    body: {
      ...response,
      cache: {
        hit: false,
        key: cache.key,
        storedAt: cache.storedAt,
      },
    },
    status: 200 as const,
  };
}

function parseKnowledgeCardResult(result: string): KnowledgeCardData[] {
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('无法解析 JSON');
    return sanitizeParsedKnowledgeCards(JSON.parse(jsonMatch[0]));
  } catch {
    try {
      return sanitizeParsedKnowledgeCards(JSON.parse(result));
    } catch {
      throw new Error('知识卡片返回格式异常，请重试');
    }
  }
}

function sanitizeParsedKnowledgeCards(parsed: { cards?: Array<{ category?: string; title?: string; content?: string; extra?: string }> }) {
  return (parsed.cards || []).flatMap(card => {
    if (!card.title || !card.content) return [];
    return [{
      category: card.category || '关键要点',
      title: card.title,
      content: card.content,
      extra: card.extra || '',
    }];
  });
}
