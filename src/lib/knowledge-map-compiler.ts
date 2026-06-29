import type {
  KnowledgeMapCommunity,
  KnowledgeMapData,
  KnowledgeMapEdge,
  KnowledgeMapNode,
  KnowledgeMapNodeType,
} from '@/lib/knowledge-map-types';
import type { GroundedCitation, RagSourceInput } from '@/lib/rag';

interface TermStat {
  label: string;
  score: number;
  citationNumbers: Set<number>;
  sourceId?: string;
  sourceTitle?: string;
  excerpts: string[];
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'has', 'are', 'was', 'were', 'will',
  'can', 'not', 'into', 'using', 'used', 'use', 'data', 'source', 'sources', 'text', 'content',
  'feature', 'smoke', 'test', 'tests', 'should', 'must', 'when', 'then', 'than', 'there', 'their',
  '资料', '来源', '内容', '系统', '功能', '当前', '可以', '需要', '生成', '使用', '进行',
]);

export function buildFastKnowledgeMap(papers: RagSourceInput[], citations: GroundedCitation[]): KnowledgeMapData {
  const stats = collectTermStats(papers, citations);
  const selected = [...stats.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 10);
  if (selected.length === 0) {
    selected.push(...papers.slice(0, 6).map((paper, index) => ({
      label: paper.title || paper.fileName || `资料 ${index + 1}`,
      score: 1,
      citationNumbers: new Set(citations[index] ? [index + 1] : []),
      sourceId: paper.id,
      sourceTitle: paper.title || paper.fileName,
      excerpts: [paper.abstract || paper.content || paper.rawContent || '选中资料中的内容'],
    })));
  }

  const nodes: KnowledgeMapNode[] = selected.map((term, index) => {
    const citationsList = [...term.citationNumbers].sort((a, b) => a - b);
    const citationText = citationsList.length ? ` ${citationsList.map(n => `[${n}]`).join(' ')}` : '';
    return {
      id: normalizeId(term.label, `n${index + 1}`),
      label: cleanText(term.label, 48),
      type: inferNodeType(term.label),
      summary: `${summarizeTerm(term)}${citationText}`.slice(0, 260),
      community: inferNodeType(term.label),
      sourceId: term.sourceId,
      sourceTitle: term.sourceTitle,
      citationNumbers: citationsList,
      degree: 0,
      focal: index === 0,
    };
  });

  const nodeByLabel = new Map(nodes.map(node => [node.label.toLowerCase(), node]));
  const edges: KnowledgeMapEdge[] = [];
  const center = nodes[0];
  if (center) {
    for (const node of nodes.slice(1, 8)) {
      const citationNumbers = mergeCitationNumbers(center.citationNumbers, node.citationNumbers, citations.length);
      edges.push({
        id: `${center.id}__${node.id}__focus`,
        source: center.id,
        target: node.id,
        relation: inferRelation(center.label, node.label),
        confidence: citationNumbers.length > 0 ? 'INFERRED' : 'AMBIGUOUS',
        evidence: makeFastEdgeEvidence(center.label, node.label, citationNumbers),
        citationNumbers,
      });
    }
  }

  for (const [citationIndex, citation] of citations.entries()) {
    const labels = selected
      .filter(term => term.citationNumbers.has(citationIndex + 1))
      .slice(0, 4)
      .map(term => nodeByLabel.get(term.label.toLowerCase()))
      .filter((node): node is KnowledgeMapNode => Boolean(node));
    for (let index = 0; index < labels.length - 1; index += 1) {
      const source = labels[index];
      const target = labels[index + 1];
      if (source.id === target.id || edges.some(edge => edge.source === source.id && edge.target === target.id)) continue;
      edges.push({
        id: `${source.id}__${target.id}__c${citationIndex + 1}`,
        source: source.id,
        target: target.id,
        relation: '同段支撑',
        confidence: 'EXTRACTED',
        evidence: `两个节点出现在同一证据片段中：${cleanText(citation.excerpt, 48)} [${citationIndex + 1}]`,
        citationNumbers: [citationIndex + 1],
      });
    }
  }

  const dedupedEdges = dedupeEdges(edges);
  const degree = new Map<string, number>();
  for (const edge of dedupedEdges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  for (const node of nodes) node.degree = degree.get(node.id) || 0;
  ensureFocalNodes(nodes);
  const communities = normalizeCommunities(nodes);
  const analysis = analyzeKnowledgeMap(nodes, dedupedEdges, communities, [
    center ? `围绕“${center.label}”展开：哪些关系是资料直接支撑，哪些只是推断？` : '哪些节点可以继续补充证据？',
  ]);

  return {
    schemaVersion: 1,
    title: `${cleanText(papers[0]?.title || '资料', 36)} 的资料脉络`,
    generatedAt: new Date().toISOString(),
    nodes: nodes.sort((a, b) => Number(Boolean(b.focal)) - Number(Boolean(a.focal)) || b.degree - a.degree || a.label.localeCompare(b.label)),
    edges: dedupedEdges,
    communities,
    analysis,
  };
}

function collectTermStats(papers: RagSourceInput[], citations: GroundedCitation[]): Map<string, TermStat> {
  const stats = new Map<string, TermStat>();
  const citationTexts = citations.length > 0
    ? citations.map((citation, index) => ({
        citationNumber: index + 1,
        sourceId: citation.sourceId,
        sourceTitle: citation.sourceTitle,
        text: `${citation.sourceTitle}\n${citation.excerpt}`,
        excerpt: citation.excerpt,
      }))
    : papers.map((paper, index) => ({
        citationNumber: index + 1,
        sourceId: paper.id,
        sourceTitle: paper.title || paper.fileName,
        text: `${paper.title || ''}\n${paper.abstract || ''}\n${paper.content || paper.rawContent || ''}`,
        excerpt: paper.abstract || paper.content || paper.rawContent || '',
      }));

  for (const item of citationTexts) {
    for (const term of extractTerms(item.text).slice(0, 18)) {
      const key = term.toLowerCase();
      const existing = stats.get(key) || {
        label: term,
        score: 0,
        citationNumbers: new Set<number>(),
        sourceId: item.sourceId,
        sourceTitle: item.sourceTitle,
        excerpts: [],
      };
      existing.score += scoreTerm(term, item.text);
      existing.citationNumbers.add(item.citationNumber);
      if (existing.excerpts.length < 3 && item.excerpt) existing.excerpts.push(item.excerpt);
      stats.set(key, existing);
    }
  }
  return stats;
}

function extractTerms(text: string): string[] {
  const normalized = text.replace(/[_/\\]+/g, ' ').replace(/\s+/g, ' ');
  const terms: string[] = [];
  const words = (normalized.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || [])
    .map(word => word.replace(/-+/g, ' '))
    .filter(word => !STOP_WORDS.has(word.toLowerCase()));
  for (let index = 0; index < words.length; index += 1) {
    terms.push(words[index]);
    if (index < words.length - 1) terms.push(`${words[index]} ${words[index + 1]}`);
    if (index < words.length - 2) terms.push(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);
  }
  for (const phrase of normalized.match(/[\u4e00-\u9fff]{2,10}/g) || []) {
    if (!STOP_WORDS.has(phrase)) terms.push(phrase);
  }
  return Array.from(new Set(terms.map(term => cleanText(term, 42)).filter(term => term.length >= 2)));
}

function scoreTerm(term: string, text: string): number {
  const lower = text.toLowerCase();
  const frequency = lower.split(term.toLowerCase()).length - 1;
  const lengthBonus = Math.min(3, Math.max(1, term.split(/\s+/).length));
  const titleBonus = lower.slice(0, 160).includes(term.toLowerCase()) ? 3 : 0;
  return Math.max(1, frequency) * lengthBonus + titleBonus;
}

function inferNodeType(label: string): KnowledgeMapNodeType {
  if (/method|pipeline|workflow|retrieval|index|route|流程|方法|路径|检索|索引/i.test(label)) return 'method';
  if (/finding|result|conclusion|evidence|status|结论|发现|证据|状态/i.test(label)) return 'finding';
  if (/question|issue|risk|error|fallback|问题|风险|错误|降级/i.test(label)) return 'question';
  if (/source|paper|document|资料|来源|文档/i.test(label)) return 'source';
  if (/model|api|embedding|vector|citation|术语|模型|引用/i.test(label)) return 'term';
  return 'concept';
}

function summarizeTerm(term: TermStat): string {
  const excerpt = cleanText(term.excerpts[0] || '', 78);
  if (excerpt) return `${term.label} 是资料中高频出现的关键节点，证据片段提到：${excerpt}`;
  return `${term.label} 是选中资料中抽取出的关键节点，可继续查看相邻关系和引用来源。`;
}

function mergeCitationNumbers(a: number[], b: number[], citationCount: number): number[] {
  const merged = Array.from(new Set([...a, ...b])).filter(number => number >= 1 && number <= citationCount);
  return merged.slice(0, 3).sort((x, y) => x - y);
}

function inferRelation(sourceLabel: string, targetLabel: string): string {
  const pair = `${sourceLabel} ${targetLabel}`;
  if (/fallback|降级|error|风险|问题/i.test(pair)) return '暴露问题';
  if (/index|retrieval|检索|索引/i.test(pair)) return '依赖检索';
  if (/citation|evidence|引用|证据/i.test(pair)) return '证据支撑';
  if (/ppt|audio|classroom|studio|产物|课堂/i.test(pair)) return '产物关联';
  return '共同支撑';
}

function makeFastEdgeEvidence(sourceLabel: string, targetLabel: string, citationNumbers: number[]): string {
  const marker = citationNumbers.length ? ` ${citationNumbers.map(number => `[${number}]`).join(' ')}` : '';
  return `“${sourceLabel}”与“${targetLabel}”在同一批检索证据中共同出现，适合作为局部展开关系复核。${marker}`;
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

function normalizeCommunities(nodes: KnowledgeMapNode[]): KnowledgeMapCommunity[] {
  const communities = new Map<string, KnowledgeMapCommunity>();
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
