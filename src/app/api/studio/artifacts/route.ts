import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';
import { isResearchReportDocument } from '@/lib/research-report-document';
import { isKnowledgeMapDocument } from '@/lib/knowledge-map-document';
import { isDataProcessingDocument } from '@/lib/data-processing-document';
import { isHtmlDeckDocument, isImageDeckDocument, type PptDeckDocument } from '@/lib/ppt/deck-document';
import { PptDeckAccessError, readDeckImage, savePptDeckDocument } from '@/lib/ppt/deck-store';
import { buildStandaloneDeckHtml } from '@/lib/ppt/html-deck-export';
import { latestDeckExport, readDeckExport, saveDeckExport } from '@/lib/ppt/deck-export-store';

import { isHypothesisDocument, isExperimentDocument } from '@/lib/research-design-document';
import { isChatHistoryDocument } from '@/lib/chat-history-document';

const headers = { 'Cache-Control': 'private, no-store' };
const validators = { 'hypothesis-generation': isHypothesisDocument, 'experiment-design': isExperimentDocument, 'chat-history': isChatHistoryDocument, 'research-report': isResearchReportDocument, 'knowledge-map': isKnowledgeMapDocument, 'data-processing': isDataProcessingDocument, 'image-deck': isImageDeckDocument, 'html-deck': isHtmlDeckDocument };
function validatorFor(kind: string | null) { return kind && Object.hasOwn(validators, kind) ? validators[kind as keyof typeof validators] : null; }

async function scopeFor(request: NextRequest, notebookId: unknown): Promise<PrivateNotebookScope | { response: Response }> {
  const scope = await resolveAccountNotebookScope(request, { notebookId, loginMessage: '请先登录，再打开已保存内容。', requireAuthenticatedPaperHost: true });
  if (!scope.ok) return { response: scope.response };
  if (!scope.ownerMemberId) return { response: NextResponse.json({ error: '请先登录。' }, { status: 401, headers }) };
  if (!scope.notebookId) return { response: NextResponse.json({ error: '请先打开文献本。' }, { status: 400, headers }) };
  return { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId };
}

function failed(error: unknown) {
  return NextResponse.json({ error: error instanceof NotebookDocumentConflict || error instanceof PptDeckAccessError ? error.message : '内容暂时无法保存或读取，请重试。' }, { status: error instanceof NotebookDocumentConflict ? 409 : error instanceof PptDeckAccessError ? error.status : 503, headers });
}

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind');
  const validate = validatorFor(kind);
  if (!validate || !kind) return NextResponse.json({ error: '工具类型无效。' }, { status: 400, headers });
  const scope = await scopeFor(request, request.nextUrl.searchParams.get('notebookId'));
  if ('response' in scope) return scope.response;
  try {
    if ((kind === 'image-deck' || kind === 'html-deck') && request.nextUrl.searchParams.get('exportMeta') === '1') {
      return NextResponse.json({ export: await latestDeckExport(scope, kind, request.nextUrl.searchParams.get('revision') || '') }, { headers });
    }
    const exportId = request.nextUrl.searchParams.get('exportId');
    if ((kind === 'image-deck' || kind === 'html-deck') && exportId) {
      const exported = await readDeckExport(scope, kind, request.nextUrl.searchParams.get('revision') || '', exportId);
      return new Response(new Uint8Array(exported.buffer), { headers: { ...headers, 'Content-Type': exported.contentType, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`, 'X-Content-Type-Options': 'nosniff' } });
    }
    const assetId = request.nextUrl.searchParams.get('assetId');
    if (kind === 'image-deck' && assetId) {
      const image = await readDeckImage(scope, assetId);
      return new Response(new Uint8Array(image.buffer), { headers: { ...headers, 'Content-Type': image.contentType, 'X-Content-Type-Options': 'nosniff' } });
    }
    const download = (kind === 'data-processing' || kind === 'html-deck' || kind === 'experiment-design') && request.nextUrl.searchParams.get('download') === '1';
    const revision = request.nextUrl.searchParams.get('revision');
    if ((download || revision) && !/^[a-f0-9]{64}$/.test(revision || '')) return NextResponse.json({ error: '下载版本不完整，请重新读取。' }, { status: 400, headers });
    const saved = await readNotebookDocument(scope, kind, revision || undefined);
    if (!saved) return NextResponse.json({ error: '还没有保存内容。' }, { status: 404, headers });
    if (!validate(saved.data)) throw new Error('Invalid saved document');
    if (download && isHtmlDeckDocument(saved.data) && saved.data.deck) {
      return new Response(buildStandaloneDeckHtml(saved.data.deck.slides, saved.data.deck.deckTitle), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(saved.data.deck.deckTitle.replace(/[\\/:*?"<>|]/g, '_') + '.html')}` } });
    }
    if (download && isExperimentDocument(saved.data) && saved.data.result) {
      return new Response(saved.data.result.artifactMarkdown, { headers: { ...headers, 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="experiment-preregistration.md"` } });
    }
    if (download && isDataProcessingDocument(saved.data) && saved.data.plan) {
      return new Response(saved.data.plan.artifactMarkdown, { headers: { ...headers, 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(saved.data.plan.artifactFileName)}` } });
    }
    return NextResponse.json({ document: saved }, { headers });
  } catch (error) { return failed(error); }
}

export async function POST(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind');
  if (kind !== 'image-deck' && kind !== 'html-deck') return NextResponse.json({ error: '工具类型无效。' }, { status: 400, headers });
  const scope = await scopeFor(request, request.nextUrl.searchParams.get('notebookId'));
  if ('response' in scope) return scope.response;
  try {
    if (Number(request.headers.get('Content-Length')) > 80_000_000) throw new PptDeckAccessError('文件过大，暂时无法导出。', 413);
    const exported = await saveDeckExport(scope, kind, request.nextUrl.searchParams.get('revision') || '', Buffer.from(await request.arrayBuffer()));
    return NextResponse.json({ export: exported }, { headers });
  } catch (error) { return failed(error); }
}

export async function PUT(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind');
  const validate = validatorFor(kind);
  if (!validate || !kind) return NextResponse.json({ error: '工具类型无效。' }, { status: 400, headers });
  try {
    const body = await request.json() as { notebookId?: unknown; data?: unknown; expectedRevision?: unknown };
    const scope = await scopeFor(request, body.notebookId);
    if ('response' in scope) return scope.response;
    if (!validate(body.data) || (body.expectedRevision !== null && typeof body.expectedRevision !== 'string')) return NextResponse.json({ error: '内容或保存版本不完整，请重新读取。' }, { status: 400, headers });
    const document = kind === 'image-deck' || kind === 'html-deck'
      ? await savePptDeckDocument(scope, kind, body.data as PptDeckDocument, body.expectedRevision)
      : await saveNotebookDocument(scope, kind, body.data, body.expectedRevision);
    return NextResponse.json({ document }, { headers });
  } catch (error) { return failed(error); }
}
