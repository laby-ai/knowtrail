import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';
import { isResearchReportDocument } from '@/lib/research-report-document';

const headers = { 'Cache-Control': 'private, no-store' };
const kind = 'research-report';

async function scopeFor(request: NextRequest, notebookId: unknown): Promise<PrivateNotebookScope | { response: Response }> {
  const scope = await resolveAccountNotebookScope(request, { notebookId, loginMessage: '请先登录，再打开已保存内容。', requireAuthenticatedPaperHost: true });
  if (!scope.ok) return { response: scope.response };
  if (!scope.ownerMemberId) return { response: NextResponse.json({ error: '请先登录。' }, { status: 401, headers }) };
  if (!scope.notebookId) return { response: NextResponse.json({ error: '请先打开文献本。' }, { status: 400, headers }) };
  return { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId };
}

function failed(error: unknown) {
  return NextResponse.json({ error: error instanceof NotebookDocumentConflict ? error.message : '内容暂时无法保存或读取，请重试。' }, { status: error instanceof NotebookDocumentConflict ? 409 : 503, headers });
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('kind') !== kind) return NextResponse.json({ error: '工具类型无效。' }, { status: 400, headers });
  const scope = await scopeFor(request, request.nextUrl.searchParams.get('notebookId'));
  if ('response' in scope) return scope.response;
  try {
    const saved = await readNotebookDocument(scope, kind);
    if (!saved) return NextResponse.json({ error: '还没有保存内容。' }, { status: 404, headers });
    if (!isResearchReportDocument(saved.data)) throw new Error('Invalid saved report');
    return NextResponse.json({ document: saved }, { headers });
  } catch (error) { return failed(error); }
}

export async function PUT(request: NextRequest) {
  if (request.nextUrl.searchParams.get('kind') !== kind) return NextResponse.json({ error: '工具类型无效。' }, { status: 400, headers });
  try {
    const body = await request.json() as { notebookId?: unknown; data?: unknown; expectedRevision?: unknown };
    const scope = await scopeFor(request, body.notebookId);
    if ('response' in scope) return scope.response;
    if (!isResearchReportDocument(body.data) || (body.expectedRevision !== null && typeof body.expectedRevision !== 'string')) return NextResponse.json({ error: '内容或保存版本不完整，请重新读取。' }, { status: 400, headers });
    return NextResponse.json({ document: await saveNotebookDocument(scope, kind, body.data, body.expectedRevision) }, { headers });
  } catch (error) { return failed(error); }
}
