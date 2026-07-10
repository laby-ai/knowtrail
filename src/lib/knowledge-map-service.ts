import { llmInvoke } from '@/lib/ai-service';
import { auditCitationMarkers } from '@/lib/citation-audit';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { readKnowledgeMapCache, writeKnowledgeMapCache } from '@/lib/knowledge-map-cache';
import { buildFastKnowledgeMap } from '@/lib/knowledge-map-compiler';
import type {
  KnowledgeMapCommunity,
  KnowledgeMapData,
  KnowledgeMapEdge,
  KnowledgeMapEdgeConfidence,
  KnowledgeMapNode,
  KnowledgeMapNodeType,
  KnowledgeMapResponse,
} from '@/lib/knowledge-map-types';
import type { RagSourceInput } from '@/lib/rag';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { CitationAuditResult, RuntimeAIConfig } from '@/types';

const SYSTEM_PROMPT = `你是一个资料关系抽取助手。你的任务是把资料整理成可浏览的关系网络，而不是卡片列表。

必须抽取:
- nodes: 6-10 个节点，每个节点代表一个核心概念、方法、发现、问题、来源或术语
- edges: 7-14 条有方向的关系边，表示“支持、导致、包含、对比、依赖、解释、应用、追问”等关系
- communities: 2-5 个主题群组
- suggestedQuestions: 3-6 个基于关系网络可继续追问的问题

节点字段:
- id: 稳定短 id，只能用英文、数字、下划线或短横线
- label: 用户可读名称，优先中文或资料原词
- type: concept | method | finding | question | source | term
- summary: 35-70字，必须带 [1] 这样的引用编号
- community: 主题群组 id
- sourceId/sourceTitle/sourceLocation: 能指向证据的来源信息
- citationNumbers: 支撑该节点的引用编号数组
- focal: 是否为本图中心核心词，只能 1-3 个 true

边字段:
- source: 源节点 id
- target: 目标节点 id
- relation: 2-8字关系短语
- confidence: EXTRACTED | INFERRED | AMBIGUOUS
- evidence: 25-60字证据说明，必须带 [1] 这样的引用编号
- citationNumbers: 支撑该关系的引用编号数组

要求:
1. 必须让最重要的核心词成为 focal=true 的中心节点
2. 关系必须具体，不要只写“相关”
3. EXTRACTED 用于资料片段直接表述的关系；INFERRED 用于合理推断；AMBIGUOUS 用于需要用户复核
4. 不要编造不存在的来源编号，只能使用检索证据里的 [1]、[2] 等编号
5. 严格输出一行 JSON，不要输出解释文本，不要 Markdown 代码块，不要尾随逗号

JSON 格式:
{
  "title": "...",
  "nodes": [],
  "edges": [],
  "communities": [{"id":"c1","label":"...","nodeIds":[]}],
  "suggestedQuestions": []
}`;

const NODE_TYPES = new Set<KnowledgeMapNodeType>(['concept', 'method', 'finding', 'question', 'source', 'term']);
const EDGE_CONFIDENCE = new Set<KnowledgeMapEdgeConfidence>(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

export interface KnowledgeMapRequestInput {
  papers: RagSourceInput[];
  aiConfig?: Partial<RuntimeAIConfig>;
  debugRetrievalOnly?: boolean;
  debugAnswerText?: string;
  forceRefresh?: boolean;
  deepExtract?: boolean;
  ownerMemberId?: string;
  notebookId?: string;
}

interface ParsedNode {
  id?: string;
  label?: string;
  type?: string;
  summary?: string;
  community?: string;
  sourceId?: string;
  sourceTitle?: string;
  sourceLocation?: string;
  citationNumbers?: number[];
  focal?: boolean;
}

interface ParsedEdge {
  source?: string;
  target?: string;
  relation?: string;
  confidence?: string;
  evidence?: string;
  citationNumbers?: number[];
}

interface ParsedCommunity {
  id?: string;
  label?: string;
  nodeIds?: string[];
}

interface ParsedKnowledgeMap {
  title?: string;
  nodes?: ParsedNode[];
  edges?: ParsedEdge[];
  communities?: ParsedCommunity[];
  suggestedQuestions?: string[];
}

export async function buildKnowledgeMapPayload(input: KnowledgeMapRequestInput) {
  const { papers, aiConfig, debugRetrievalOnly, debugAnswerText, forceRefresh, deepExtract, ownerMemberId, notebookId } = input;
  if (!papers || papers.length === 0) {
    return { error: '请提供资料内容', status: 400 as const };
  }

  const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);
  const scope = { ownerMemberId, notebookId };
  if (!debugRetrievalOnly && !forceRefresh) {
    const cached = await readKnowledgeMapCache(papers, runtimeConfig, scope);
    if (cached) return { body: cached, status: 200 as const };
  }

  const grounded = await buildGroundedRetrievalContext(
    '抽取核心概念、方法、发现和它们之间的关系，生成可视化资料脉络',
    papers,
    runtimeConfig,
    { topK: 8, ownerMemberId, notebookId },
  );

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

  const hasSubstantiveEvidence = grounded.citations.some(citation =>
    (citation.excerpt || '').replace(/\s+/g, ' ').trim().length >= 40,
  );
  if (!hasSubstantiveEvidence) {
    return {
      error: '当前选定来源中没有可用证据片段，不能生成研究脉络。请等待资料解析完成或补充来源。',
      errorType: 'knowledge_map_no_evidence',
      status: 422 as const,
    };
  }

  if (!deepExtract) {
    const map = buildFastKnowledgeMap(papers, grounded.citations);
    const auditText = [
      ...map.nodes.map(node => `${node.label}\n${node.summary}`),
      ...map.edges.map(edge => `${edge.relation}\n${edge.evidence}`),
    ].join('\n\n');
    const response: KnowledgeMapResponse = {
      map,
      citations: grounded.citations,
      retrieval: toRetrievalMetadata(grounded),
      citationAudit: auditCitationMarkers(auditText, grounded.citations) as CitationAuditResult,
    };
    const cache = await writeKnowledgeMapCache(papers, runtimeConfig, response, scope);
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

  const fallbackText = papers
    .map((paper, index) => `--- 资料 ${index + 1}: ${paper.title || paper.fileName || '未命名资料'} ---\n摘要: ${paper.abstract || ''}\n正文: ${paper.content || ''}`)
    .join('\n\n');
  const evidenceContext = grounded.promptContext || fallbackText;
  const result = await llmInvoke([
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `请基于以下检索证据生成资料关系网络。所有节点 summary 和边 evidence 必须使用 [1]、[2] 这样的来源编号标注证据。\n\n${evidenceContext}`,
    },
  ], { temperature: 0.1, maxTokens: 2600 }, undefined, runtimeConfig);

  const map = parseKnowledgeMapResult(result, papers, grounded.citations.length);
  if (map.nodes.length === 0 || map.edges.length === 0) {
    return { error: '未能生成可用资料脉络，请重试', status: 500 as const };
  }

  const auditText = [
    ...map.nodes.map(node => `${node.label}\n${node.summary}`),
    ...map.edges.map(edge => `${edge.relation}\n${edge.evidence}`),
  ].join('\n\n');
  const response: KnowledgeMapResponse = {
    map,
    citations: grounded.citations,
    retrieval: toRetrievalMetadata(grounded),
    citationAudit: auditCitationMarkers(auditText, grounded.citations) as CitationAuditResult,
  };
  const cache = await writeKnowledgeMapCache(papers, runtimeConfig, response, scope);
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

function parseKnowledgeMapResult(result: string, papers: RagSourceInput[], citationCount: number): KnowledgeMapData {
  const jsonText = result.match(/\{[\s\S]*\}/)?.[0] || result;
  const parsed = parseJsonObject(jsonText);
  return sanitizeKnowledgeMap(parsed, papers, citationCount);
}

function parseJsonObject(jsonText: string): ParsedKnowledgeMap {
  try {
    return JSON.parse(jsonText) as ParsedKnowledgeMap;
  } catch (firstError) {
    const repaired = jsonText
      .replace(/```json|```/gi, '')
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
    try {
      return JSON.parse(repaired) as ParsedKnowledgeMap;
    } catch {
      throw firstError;
    }
  }
}

function sanitizeKnowledgeMap(parsed: ParsedKnowledgeMap, papers: RagSourceInput[], citationCount: number): KnowledgeMapData {
  const idMap = new Map<string, string>();
  const nodes = dedupeNodes((parsed.nodes || []).flatMap((node, index) => {
    if (!node.label?.trim()) return [];
    const id = normalizeId(node.id || node.label, `n${index + 1}`);
    idMap.set(String(node.id || '').trim(), id);
    idMap.set(String(node.label || '').trim(), id);
    const type = NODE_TYPES.has(node.type as KnowledgeMapNodeType) ? node.type as KnowledgeMapNodeType : 'concept';
    const citationNumbers = normalizeCitationNumbers(node.citationNumbers, citationCount, node.summary);
    return [{
      id,
      label: cleanText(node.label, 48),
      type,
      summary: cleanText(node.summary || '该节点来自选中资料中的关键内容。', 260),
      community: normalizeId(node.community || type, type),
      sourceId: cleanOptional(node.sourceId),
      sourceTitle: cleanOptional(node.sourceTitle || papers[0]?.title || papers[0]?.fileName),
      sourceLocation: cleanOptional(node.sourceLocation),
      citationNumbers,
      degree: 0,
      focal: Boolean(node.focal),
    }];
  }));

  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = dedupeEdges((parsed.edges || []).flatMap((edge, index) => {
    const source = resolveNodeRef(edge.source, idMap);
    const target = resolveNodeRef(edge.target, idMap);
    if (!source || !target || source === target || !nodeIds.has(source) || !nodeIds.has(target)) return [];
    const confidence = EDGE_CONFIDENCE.has(edge.confidence as KnowledgeMapEdgeConfidence)
      ? edge.confidence as KnowledgeMapEdgeConfidence
      : 'INFERRED';
    return [{
      id: `${source}__${target}__${normalizeId(edge.relation || 'rel', `r${index + 1}`)}`,
      source,
      target,
      relation: cleanText(edge.relation || '关联', 20),
      confidence,
      evidence: cleanText(edge.evidence || '该关系来自选中资料中的共同证据。', 240),
      citationNumbers: normalizeCitationNumbers(edge.citationNumbers, citationCount, edge.evidence),
    }];
  }));

  if (edges.length === 0 && nodes.length > 1) {
    const focal = nodes.find(node => node.focal) || nodes[0];
    for (const node of nodes.slice(0, 8)) {
      if (node.id === focal.id) continue;
      edges.push({
        id: `${focal.id}__${node.id}__context`,
        source: focal.id,
        target: node.id,
        relation: '证据相邻',
        confidence: 'AMBIGUOUS',
        evidence: `两个节点出现在同一批资料证据中，需要继续复核其具体关系${citationCount > 0 ? ' [1]' : ''}`,
        citationNumbers: citationCount > 0 ? [1] : [],
      });
    }
  }

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  for (const node of nodes) {
    node.degree = degree.get(node.id) || 0;
  }
  ensureFocalNodes(nodes);

  const communities = normalizeCommunities(parsed.communities || [], nodes);
  const analysis = analyzeKnowledgeMap(nodes, edges, communities, parsed.suggestedQuestions || []);

  return {
    schemaVersion: 1,
    title: cleanText(parsed.title || '资料脉络', 60),
    generatedAt: new Date().toISOString(),
    nodes: nodes.sort((a, b) => Number(Boolean(b.focal)) - Number(Boolean(a.focal)) || b.degree - a.degree || a.label.localeCompare(b.label)),
    edges,
    communities,
    analysis,
  };
}

function normalizeId(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanOptional(value?: string): string | undefined {
  const cleaned = value ? cleanText(value, 140) : '';
  return cleaned || undefined;
}

function normalizeCitationNumbers(numbers: unknown, citationCount: number, text?: string): number[] {
  const fromArray = Array.isArray(numbers) ? numbers : [];
  const fromText = Array.from(String(text || '').matchAll(/\[(\d{1,3})\]/g)).map(match => Number(match[1]));
  return Array.from(new Set([...fromArray, ...fromText]
    .map(Number)
    .filter(number => Number.isInteger(number) && number >= 1 && number <= citationCount)))
    .sort((a, b) => a - b);
}

function resolveNodeRef(value: unknown, idMap: Map<string, string>): string | undefined {
  if (typeof value !== 'string') return undefined;
  const direct = idMap.get(value.trim());
  return direct || normalizeId(value, '');
}

function dedupeNodes(nodes: KnowledgeMapNode[]): KnowledgeMapNode[] {
  const byId = new Map<string, KnowledgeMapNode>();
  for (const node of nodes) {
    const existing = byId.get(node.id);
    byId.set(node.id, existing ? { ...existing, ...node, focal: existing.focal || node.focal } : node);
  }
  return [...byId.values()].slice(0, 18);
}

function dedupeEdges(edges: KnowledgeMapEdge[]): KnowledgeMapEdge[] {
  const seen = new Set<string>();
  const result: KnowledgeMapEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}:${edge.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result.slice(0, 28);
}

function ensureFocalNodes(nodes: KnowledgeMapNode[]) {
  const focalCount = nodes.filter(node => node.focal).length;
  if (focalCount > 0) return;
  const top = [...nodes].sort((a, b) => b.degree - a.degree)[0];
  if (top) top.focal = true;
}

function normalizeCommunities(parsed: ParsedCommunity[], nodes: KnowledgeMapNode[]): KnowledgeMapCommunity[] {
  const nodeIds = new Set(nodes.map(node => node.id));
  const communities = new Map<string, KnowledgeMapCommunity>();

  for (const community of parsed) {
    const id = normalizeId(community.id || community.label || 'topic', `c${communities.size + 1}`);
    const item = communities.get(id) || { id, label: cleanText(community.label || '主题', 28), nodeIds: [] };
    for (const nodeId of community.nodeIds || []) {
      const normalized = normalizeId(nodeId, '');
      if (nodeIds.has(normalized) && !item.nodeIds.includes(normalized)) item.nodeIds.push(normalized);
    }
    communities.set(id, item);
  }

  for (const node of nodes) {
    const id = node.community || node.type;
    const item = communities.get(id) || { id, label: communityLabelFromId(id), nodeIds: [] };
    if (!item.nodeIds.includes(node.id)) item.nodeIds.push(node.id);
    communities.set(id, item);
  }

  return [...communities.values()].filter(community => community.nodeIds.length > 0);
}

function communityLabelFromId(id: string): string {
  const labels: Record<string, string> = {
    concept: '核心概念',
    method: '方法路径',
    finding: '关键发现',
    question: '问题线索',
    source: '资料来源',
    term: '术语',
  };
  return labels[id] || id.replace(/-/g, ' ');
}

function analyzeKnowledgeMap(
  nodes: KnowledgeMapNode[],
  edges: KnowledgeMapEdge[],
  communities: KnowledgeMapCommunity[],
  suggestedQuestions: string[],
) {
  const communityByNode = new Map<string, string>();
  for (const community of communities) {
    for (const nodeId of community.nodeIds) communityByNode.set(nodeId, community.id);
  }

  const hubNodes = [...nodes]
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5)
    .map(node => ({ id: node.id, label: node.label, degree: node.degree }));

  const bridgeEdges = edges
    .filter(edge => communityByNode.get(edge.source) !== communityByNode.get(edge.target) || edge.confidence !== 'EXTRACTED')
    .slice(0, 6)
    .map(edge => ({
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      confidence: edge.confidence,
      why: edge.confidence === 'EXTRACTED' ? '连接了两个不同主题' : '该关系需要结合证据继续复核',
    }));

  const questions = suggestedQuestions
    .map(question => cleanText(question, 120))
    .filter(Boolean)
    .slice(0, 6);

  if (questions.length === 0 && hubNodes.length > 0) {
    questions.push(`围绕“${hubNodes[0].label}”继续追问：它和其他关键节点的关系是否被资料直接支持？`);
  }

  return { hubNodes, bridgeEdges, suggestedQuestions: questions };
}
