import { NextRequest } from 'next/server';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { groupJournalWorks } from '@/lib/journal-discovery';
export async function GET(request: NextRequest) {
  try { if (!await resolveAccountSessionFromRequest(request)) return Response.json({ error: '请登录后检索期刊。' }, { status: 401 }); }
  catch { return Response.json({ error: '登录已失效，请重新登录。' }, { status: 401 }); }
  const query = request.nextUrl.searchParams.get('query')?.trim() || '';
  if (query.length < 3 || query.length > 500) return Response.json({ error: '请输入 3–500 字的研究主题或英文关键词。' }, { status: 400 });
  try {
    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query.bibliographic', query); url.searchParams.set('filter', 'type:journal-article'); url.searchParams.set('rows', '40');
    url.searchParams.set('select', 'DOI,title,container-title,publisher,ISSN,type');
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'KnowTrail/1.0 (research journal discovery)' } });
    if (!response.ok) throw new Error('upstream_unavailable');
    return Response.json({ candidates: groupJournalWorks(await response.json()), source: 'Crossref', retrievedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: 'Crossref 暂时无法返回期刊元数据，请稍后重试。' }, { status: 502 }); }
}
