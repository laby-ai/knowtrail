import type { NextRequest } from 'next/server';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { readDataAnalysis } from '@/lib/data-analysis-store';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let owner: string;
  try {
    const session = await resolveAccountSessionFromRequest(request);
    if (!session) return Response.json({ error: '请登录后查看分析结果。' }, { status: 401 });
    owner = session.member.id;
  } catch { return Response.json({ error: '登录已失效，请重新登录。' }, { status: 401 }); }
  try {
    const result = await readDataAnalysis(owner, (await context.params).id);
    const format = request.nextUrl.searchParams.get('format');
    const exports: Record<string, { body: string; mime: string; name: string }> = {
      script: { body: result.reproduceScript, mime: 'text/x-python; charset=utf-8', name: 'analyze.py' },
      config: { body: JSON.stringify(result.request, null, 2), mime: 'application/json', name: 'analysis-config.json' },
      requirements: { body: result.reproduceRequirements, mime: 'text/plain; charset=utf-8', name: 'requirements.txt' },
      summary: { body: '\uFEFF' + result.summaryCsv, mime: 'text/csv; charset=utf-8', name: 'statistical-summary.csv' },
      figure: { body: result.chartSvg, mime: 'image/svg+xml', name: 'statistical-figure.svg' },
      results: { body: result.resultsDraft + '\n\n' + result.notes.join('\n'), mime: 'text/plain; charset=utf-8', name: 'results-draft.txt' },
    };
    if (!format) return Response.json({ code: 0, data: result }, { headers: { 'Cache-Control': 'private, no-store' } });
    const artifact = exports[format];
    if (!artifact) return Response.json({ error: '导出格式不支持。' }, { status: 400 });
    return new Response(artifact.body, { headers: { 'Content-Type': artifact.mime, 'Content-Disposition': `attachment; filename="${artifact.name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return Response.json({ error: '结果不存在或当前账号无权访问。' }, { status: 404 }); }
}
