import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { DiscoverSearchProviderError, searchDiscoveredSources } from '@/lib/discover-search-provider';

export const maxDuration = 60;

interface DiscoverSearchRequest {
  query: string;
  scope?: 'webpage' | 'scholar' | 'document';
  size?: number;
  withContent?: boolean;
  notebookId?: string;
}

export async function POST(request: NextRequest) {
  const body: DiscoverSearchRequest = await request.json();
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号,再搜索网络信源。',
  });
  if (!scope.ok) return scope.response;

  const query = (body.query || '').trim();
  if (!query) {
    return NextResponse.json({ error: '请输入搜索关键词' }, { status: 400 });
  }
  const searchScope = body.scope === 'scholar' || body.scope === 'document' ? body.scope : 'webpage';
  const size = Math.min(20, Math.max(1, Number(body.size) || 10));
  const withContent = Boolean(body.withContent);

  try {
    const result = await searchDiscoveredSources({ query, scope: searchScope, size, withContent, signal: request.signal });
    console.log(`[Discover] "${query.slice(0, 40)}" provider=${result.provider} scope=${searchScope} -> ${result.results.length} 条`);
    return NextResponse.json({ success: true, query, scope: searchScope, ...result });
  } catch (err) {
    const status = err instanceof DiscoverSearchProviderError ? err.status : 502;
    const message = err instanceof DiscoverSearchProviderError
      ? err.message
      : err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        ? '搜索超时,请重试'
        : '搜索服务暂不可用';
    console.error('[Discover] error:', err);
    return NextResponse.json({ error: message }, { status });
  }
}
