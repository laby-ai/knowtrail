import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { authorizeResearchNotebook, executeResearchTool, ResearchMcpError } from '@/lib/mcp/research-client';
import { readResearchBody } from '@/lib/mcp/research-request';
import { prepareLiteratureResults } from '@/lib/literature/service';
import type { LiteraturePaper } from '@/lib/literature/types';

const schema = z.object({ query: z.string().trim().min(1).max(500), notebookId: z.string().min(1).max(200), mode: z.enum(['oa', 'arxiv-title', 'arxiv-abstract', 'arxiv-id', 'arxiv-multi']), yearFrom: z.number().int().min(1900).max(2100).optional(), yearTo: z.number().int().min(1900).max(2100).optional() });
const paperSchema = z.object({ title: z.string().nullable(), authors: z.array(z.string()), year: z.number().nullable(), abstract: z.string().nullable(), venue: z.string().nullable(), doi: z.string().nullable(), arxiv_id: z.string().nullable(), url: z.string().nullable(), pdf_url: z.string().nullable() });
const payloadSchema = z.object({ ok: z.boolean().optional(), dry_run: z.boolean().optional(), normalized_results: z.array(paperSchema).optional() });
function secureUrl(value: string | null): string | undefined {
  if (!value) return;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; } catch { return; }
}
export async function POST(request: NextRequest) {
  try {
    const session = await resolveAccountSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: '请登录后使用集思谱检索。' }, { status: 401 });
    const text = new TextDecoder().decode(await readResearchBody(request, 100_000));
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: '请求格式无效。' }, { status: 400 }); }
    const input = schema.safeParse(body);
    if (!input.success) return NextResponse.json({ error: '检索参数无效。' }, { status: 400 });
    const scope = await authorizeResearchNotebook(session, input.data.notebookId);
    const raw = z.record(z.string(), z.unknown()).parse(await executeResearchTool('giiisp', 'search_papers', { mode: input.data.mode, query: input.data.query, page_size: 10, page_num: 1 }, scope));
    let value: unknown = raw.structuredContent;
    if (!value && Array.isArray(raw.content)) {
      const parts = z.array(z.object({ text: z.string().optional() }).passthrough()).parse(raw.content);
      value = JSON.parse(parts.map(part => part.text || '').join('\n'));
    }
    const payload = payloadSchema.parse(value);
    if (raw.isError === true || payload.ok !== true || payload.dry_run) throw new ResearchMcpError('集思谱检索未完成，请稍后重试。');
    const papers: LiteraturePaper[] = (payload.normalized_results || []).flatMap(paper => {
      if (!paper.title?.trim()) return [];
      const arxivId = paper.arxiv_id || paper.pdf_url?.match(/\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)/)?.[1];
      const doi = paper.doi && /^10\.\d{4,9}\/\S+$/.test(paper.doi) ? paper.doi : undefined;
      const url = secureUrl(paper.url) || (doi ? `https://doi.org/${doi}` : arxivId && /^\d{4}\.\d{4,5}(?:v\d+)?$/.test(arxivId) ? `https://arxiv.org/abs/${arxivId}` : '');
      const pdf = secureUrl(paper.pdf_url);
      return [{ title: paper.title.replace(/<[^>]+>/g, '').trim(), authors: paper.authors.filter(name => name.trim()).map(name => ({ name })), year: paper.year || '', abstract: paper.abstract || '', venue: paper.venue || '', doi, arxivId, url, source: 'giiisp', provider: '集思谱', evidenceScope: paper.abstract ? 'abstract' : 'metadata', oaLocations: pdf ? [{ url: url || pdf, pdfUrl: pdf, source: '集思谱' }] : undefined }];
    });
    const results = prepareLiteratureResults(papers, input.data);
    return NextResponse.json({ success: true, results, total: results.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ResearchMcpError ? error.message : '集思谱返回异常，请稍后重试。' }, { status: error instanceof ResearchMcpError ? error.status : 502 });
  }
}
