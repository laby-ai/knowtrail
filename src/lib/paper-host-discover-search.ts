import type { DiscoverSearchResult, DiscoverSearchScope, DiscoveredSource } from '@/lib/discover-search-provider';
import { normalizeDiscoverQueryPlan, type DiscoverQueryPlan } from '@/lib/discover-query-plan';

type HostResponse = { status: number; text: string; json?: unknown };
type HostBridge = {
  request: (request: { method: 'POST'; url: string; body: unknown }, timeoutMs?: number) => Promise<HostResponse>;
};

function cleanText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim()
    : '';
}

function authors(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  return text ? text.split(/[,，;；、]/).map(item => item.trim()).filter(Boolean) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function parseGiiispPaperResponse(payload: unknown): DiscoverSearchResult {
  const root = asRecord(payload);
  const nested = asRecord(root.data);
  const rows = Array.isArray(root.rows) ? root.rows : Array.isArray(nested.rows) ? nested.rows : [];
  const results: DiscoveredSource[] = rows.map(item => {
    const paper = asRecord(item);
    const arxivId = cleanText(paper.arvixNo || paper.arxivNo || paper.arxivId).replace(/^arxiv:/i, '');
    const pdfUrl = cleanText(paper.pdfUrl);
    const link = arxivId ? `https://arxiv.org/abs/${arxivId}` : pdfUrl;
    return {
      title: cleanText(paper.title),
      link,
      snippet: cleanText(paper.paperAbstract || paper.abstract || paper.summary),
      date: cleanText(paper.publishDate || paper.created || paper.year),
      authors: authors(paper.author || paper.authors),
      score: cleanText(paper.score),
      provider: 'giiisp-paper' as const,
      verificationStatus: 'candidate' as const,
    };
  }).filter(item => item.title && /^https?:\/\//i.test(item.link));
  return { provider: 'giiisp-paper', results, total: Number(root.total || nested.total) || results.length };
}

export function parsePaperHostSearchEvents(payload: string, scope: DiscoverSearchScope): DiscoverSearchResult {
  const provider = scope === 'scholar' ? 'giiisp-paper' as const : 'dashscope-web' as const;
  const results: DiscoveredSource[] = [];
  const seen = new Set<string>();
  for (const block of payload.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const event = cleanText(lines.find(line => line.startsWith('event:'))?.slice(6));
    if (event !== 'citation_source') continue;
    const dataLine = lines.find(line => line.startsWith('data:'));
    if (!dataLine) continue;
    try {
      const data = JSON.parse(dataLine.slice(5).trim()) as { paper?: Record<string, unknown> };
      const paper = data.paper || {};
      const title = cleanText(paper.title);
      const link = cleanText(paper.url || paper.link);
      if (!title || !/^https?:\/\//i.test(link) || seen.has(link)) continue;
      seen.add(link);
      results.push({
        title,
        link,
        snippet: cleanText(paper.description || paper.abstract || paper.summary),
        date: cleanText(paper.year || paper.published || paper.date),
        authors: authors(paper.authors || paper.author),
        score: cleanText(paper.score),
        provider,
        verificationStatus: 'candidate',
      });
    } catch {
      // Ignore malformed keepalive or partial event blocks; only complete real citations are shown.
    }
  }
  return { provider, results, total: results.length };
}

function parseAgentAnswer(payload: string): string {
  let answer = '';
  let streamed = '';
  for (const block of payload.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const event = cleanText(lines.find(line => line.startsWith('event:'))?.slice(6));
    const dataLine = lines.find(line => line.startsWith('data:'));
    if (!dataLine) continue;
    try {
      const data = JSON.parse(dataLine.slice(5).trim()) as { answer?: unknown; content?: unknown };
      if (event === 'delta') streamed += cleanText(data.content);
      if (event === 'done') answer = cleanText(data.answer);
    } catch {
      // Ignore malformed keepalive blocks.
    }
  }
  return answer || streamed;
}

export async function optimizePaperHostDiscoverQuery(
  originalQuery: string,
  scope: 'webpage' | 'scholar',
  bridge?: HostBridge,
): Promise<DiscoverQueryPlan> {
  const activeBridge = bridge || (typeof window !== 'undefined' ? window.paperHostBridge : undefined);
  if (!activeBridge) throw new Error('宿主检索式优化服务尚未连接');
  const sourceLabel = scope === 'scholar' ? '学术论文数据库' : '联网网页搜索';
  const instruction = [
    `请把下面问题改写为适合${sourceLabel}的一条中英双语检索式。`,
    '只做检索词拆解与润色，不回答问题，不生成题名、作者、链接、引用或事实。',
    '只输出严格 JSON：{"optimizedQuery":"...","keywords":["..."]}。',
    `原始问题：${originalQuery}`,
  ].join('\n');
  const response = await activeBridge.request({
    method: 'POST',
    url: '/center/agent/chat/stream',
    body: {
      question: instruction,
      mode: 'quick',
      scope: 'query-plan',
      enableWebSearch: false,
      enablePaperSearch: false,
    },
  }, 35_000);
  if (response.status < 200 || response.status >= 300) throw new Error('检索式优化暂不可用');
  return normalizeDiscoverQueryPlan(originalQuery, parseAgentAnswer(response.text));
}

export async function searchPaperHostSources(
  input: { query: string; scope: DiscoverSearchScope },
  bridge?: HostBridge,
): Promise<DiscoverSearchResult> {
  const activeBridge = bridge || (typeof window !== 'undefined' ? window.paperHostBridge : undefined);
  if (!activeBridge) throw new Error('宿主检索服务尚未连接');
  const isScholar = input.scope === 'scholar';
  if (isScholar) {
    const response = await activeBridge.request({
      method: 'POST',
      url: '/first/paper/searchArxiv',
      body: { key: input.query, pageNum: 1, pageSize: 10 },
    }, 35_000);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.status === 401 ? '当前检索需要登录后继续' : '平台论文检索暂不可用');
    }
    let payload = response.json;
    if (!payload && response.text) {
      try { payload = JSON.parse(response.text); } catch { throw new Error('平台论文检索返回异常'); }
    }
    return parseGiiispPaperResponse(payload);
  }
  const response = await activeBridge.request({
    method: 'POST',
    url: '/center/agent/chat/stream',
    body: {
      question: input.query,
      mode: 'quick',
      scope: 'web',
      enableWebSearch: true,
      enablePaperSearch: false,
    },
  }, 70_000);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.status === 401 ? '当前检索需要登录后继续' : '平台检索服务暂不可用');
  }
  return parsePaperHostSearchEvents(response.text, input.scope);
}
