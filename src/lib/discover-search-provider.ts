import { XMLParser } from 'fast-xml-parser';

export type DiscoverSearchScope = 'webpage' | 'scholar' | 'document';

export interface DiscoverSearchInput {
  query: string;
  scope: DiscoverSearchScope;
  size: number;
  withContent: boolean;
  signal?: AbortSignal;
}

export interface DiscoveredSource {
  title: string;
  link: string;
  snippet: string;
  content?: string;
  date: string;
  authors: string[];
  score?: string;
  provider: 'metaso' | 'arxiv';
  verificationStatus: 'candidate' | 'open-source-candidate';
}

export interface DiscoverSearchResult {
  provider: 'metaso' | 'arxiv';
  results: DiscoveredSource[];
  total: number;
}

interface SearchOptions {
  metasoApiBase?: string;
  metasoApiKey?: string;
  arxivApiBase?: string;
  fetchImpl?: typeof fetch;
}

interface MetasoResponse {
  webpages?: Array<Record<string, unknown>>;
  documents?: Array<Record<string, unknown>>;
  scholars?: Array<Record<string, unknown>>;
  papers?: Array<Record<string, unknown>>;
  total?: number;
  code?: number;
  message?: string;
}

export class DiscoverSearchProviderError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = 'DiscoverSearchProviderError';
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).replace(/\s+/g, ' ').trim();
  if (value && typeof value === 'object' && '#text' in value) return text((value as { '#text': unknown })['#text']);
  return '';
}

function firstString(value: unknown): string {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

export function parseArxivAtom(xml: string): DiscoverSearchResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', trimValues: true }).parse(xml) as Record<string, unknown>;
  } catch {
    throw new DiscoverSearchProviderError('开放论文检索返回异常');
  }
  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (!feed) throw new DiscoverSearchProviderError('开放论文检索返回异常');
  const entries = asArray(feed.entry as Record<string, unknown> | Array<Record<string, unknown>> | undefined);
  const results = entries.map(entry => {
    const links = asArray(entry.link as Record<string, unknown> | Array<Record<string, unknown>> | undefined);
    const alternate = links.find(link => text(link.rel) === 'alternate') || links.find(link => text(link.type) === 'text/html');
    const id = text(entry.id);
    const link = text(alternate?.href) || id;
    const summary = text(entry.summary);
    return {
      title: text(entry.title),
      link,
      snippet: summary,
      content: summary || undefined,
      date: firstString(entry.published).slice(0, 10),
      authors: asArray(entry.author as Record<string, unknown> | Array<Record<string, unknown>> | undefined)
        .map(author => text(author.name))
        .filter(Boolean),
      provider: 'arxiv' as const,
      verificationStatus: 'open-source-candidate' as const,
    };
  }).filter(item => item.title && /^https:\/\/arxiv\.org\/abs\//.test(item.link));
  return {
    provider: 'arxiv',
    results,
    total: Number(text(feed['opensearch:totalResults'])) || results.length,
  };
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function searchArxiv(input: DiscoverSearchInput, options: Required<Pick<SearchOptions, 'arxivApiBase' | 'fetchImpl'>>): Promise<DiscoverSearchResult> {
  const url = new URL('/api/query', options.arxivApiBase);
  url.searchParams.set('search_query', `all:"${input.query.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', String(input.size));
  url.searchParams.set('sortBy', 'relevance');
  url.searchParams.set('sortOrder', 'descending');
  const response = await options.fetchImpl(url, {
    headers: {
      Accept: 'application/atom+xml',
      'User-Agent': 'KnowTrail/1.0 (https://airai.world)',
    },
    signal: requestSignal(input.signal, Number(process.env.DISCOVER_SEARCH_TIMEOUT_MS || 30_000)),
  });
  if (!response.ok) throw new DiscoverSearchProviderError(`开放论文检索暂不可用(HTTP ${response.status})`);
  return parseArxivAtom(await response.text());
}

async function searchMetaso(input: DiscoverSearchInput, options: Required<Pick<SearchOptions, 'metasoApiBase' | 'metasoApiKey' | 'fetchImpl'>>): Promise<DiscoverSearchResult> {
  const response = await options.fetchImpl(`${options.metasoApiBase.replace(/\/$/, '')}/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.metasoApiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: input.query,
      scope: input.scope,
      includeSummary: false,
      size: String(input.size),
      includeRawContent: input.withContent,
      conciseSnippet: !input.withContent,
    }),
    signal: requestSignal(input.signal, Number(process.env.DISCOVER_SEARCH_TIMEOUT_MS || 30_000)),
  });
  const raw = await response.text();
  if (!response.ok) throw new DiscoverSearchProviderError(`搜索服务暂不可用(HTTP ${response.status})`);
  let parsed: MetasoResponse;
  try {
    parsed = JSON.parse(raw) as MetasoResponse;
  } catch {
    throw new DiscoverSearchProviderError('搜索服务返回异常');
  }
  if (parsed.code && parsed.code !== 0) throw new DiscoverSearchProviderError(`搜索失败:${parsed.message || parsed.code}`);
  const items = parsed.webpages || parsed.scholars || parsed.documents || parsed.papers || [];
  const results = items.map(item => ({
    title: text(item.title),
    link: text(item.link),
    snippet: text(item.snippet),
    content: input.withContent ? text(item.content) || undefined : undefined,
    date: text(item.date),
    authors: asArray(item.authors as string | string[] | undefined).map(text).filter(Boolean),
    score: text(item.score),
    provider: 'metaso' as const,
    verificationStatus: 'candidate' as const,
  })).filter(item => item.title && /^https?:\/\//.test(item.link));
  return { provider: 'metaso', results, total: parsed.total ?? results.length };
}

export async function searchDiscoveredSources(input: DiscoverSearchInput, options: SearchOptions = {}): Promise<DiscoverSearchResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const metasoApiKey = options.metasoApiKey ?? process.env.METASO_API_KEY?.trim() ?? '';
  if (metasoApiKey) {
    return searchMetaso(input, {
      fetchImpl,
      metasoApiKey,
      metasoApiBase: options.metasoApiBase || process.env.METASO_API_BASE?.trim() || 'https://metaso.cn/api/v1',
    });
  }
  if (input.scope !== 'scholar') {
    throw new DiscoverSearchProviderError('网页检索服务未配置；请切换到“学术”检索开放论文候选。', 503);
  }
  return searchArxiv(input, {
    fetchImpl,
    arxivApiBase: options.arxivApiBase || process.env.ARXIV_API_BASE?.trim() || 'https://export.arxiv.org',
  });
}
