import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';

export const maxDuration = 60;

// ============================================================
// Discover sources (NotebookLM-style): web search via Metaso
// (metaso.cn) so users can find and ingest online sources
// without leaving the workbench.
// ============================================================

const METASO_API_BASE = process.env.METASO_API_BASE?.trim() || 'https://metaso.cn/api/v1';
const METASO_API_KEY = process.env.METASO_API_KEY?.trim() || '';

interface DiscoverSearchRequest {
  query: string;
  scope?: 'webpage' | 'scholar' | 'document';
  size?: number;
  withContent?: boolean;
  notebookId?: string;
}

interface MetasoWebpage {
  title?: string;
  link?: string;
  snippet?: string;
  content?: string;
  date?: string;
  authors?: string[];
  position?: number;
  score?: string;
}

interface MetasoResponse {
  webpages?: MetasoWebpage[];
  documents?: MetasoWebpage[];
  papers?: MetasoWebpage[];
  total?: number;
  credits?: number;
  code?: number;
  message?: string;
}

export async function POST(request: NextRequest) {
  const body: DiscoverSearchRequest = await request.json();
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号,再搜索网络信源。',
  });
  if (!scope.ok) return scope.response;

  if (!METASO_API_KEY) {
    return NextResponse.json({ error: '服务器未配置搜索服务(METASO_API_KEY)。' }, { status: 503 });
  }

  const query = (body.query || '').trim();
  if (!query) {
    return NextResponse.json({ error: '请输入搜索关键词' }, { status: 400 });
  }
  const searchScope = body.scope === 'scholar' || body.scope === 'document' ? body.scope : 'webpage';
  const size = Math.min(20, Math.max(1, Number(body.size) || 10));
  const withContent = Boolean(body.withContent);

  try {
    const response = await fetch(`${METASO_API_BASE}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${METASO_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        scope: searchScope,
        includeSummary: false,
        size: String(size),
        includeRawContent: withContent,
        conciseSnippet: !withContent,
      }),
      signal: AbortSignal.timeout(Number(process.env.DISCOVER_SEARCH_TIMEOUT_MS || 30_000)),
    });

    const raw = await response.text();
    if (!response.ok) {
      console.error(`[Discover] Metaso HTTP ${response.status}: ${raw.slice(0, 200)}`);
      return NextResponse.json({ error: `搜索服务暂不可用(HTTP ${response.status})` }, { status: 502 });
    }

    let parsed: MetasoResponse;
    try {
      parsed = JSON.parse(raw) as MetasoResponse;
    } catch {
      return NextResponse.json({ error: '搜索服务返回异常' }, { status: 502 });
    }
    if (parsed.code && parsed.code !== 0 && parsed.message) {
      console.error(`[Discover] Metaso error ${parsed.code}: ${parsed.message}`);
      return NextResponse.json({ error: `搜索失败:${parsed.message}` }, { status: 502 });
    }

    const items = (parsed.webpages || parsed.documents || parsed.papers || [])
      .filter(item => item.link && item.title)
      .map(item => ({
        title: String(item.title).trim(),
        link: String(item.link).trim(),
        snippet: (item.snippet || '').trim(),
        content: withContent ? (item.content || '').trim() : undefined,
        date: item.date || '',
        authors: Array.isArray(item.authors) ? item.authors : [],
        score: item.score || '',
      }));

    console.log(`[Discover] "${query.slice(0, 40)}" scope=${searchScope} withContent=${withContent} -> ${items.length} 条`);
    return NextResponse.json({ success: true, query, scope: searchScope, results: items, total: parsed.total ?? items.length });
  } catch (err) {
    const message = err instanceof Error && err.name === 'TimeoutError' ? '搜索超时,请重试' : '搜索服务暂不可用';
    console.error('[Discover] error:', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
