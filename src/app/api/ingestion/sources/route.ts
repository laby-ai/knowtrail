import { NextRequest, NextResponse } from 'next/server';
import { deleteIngestionSources, SourceDeletionConflict, getIngestionSource, listIngestionSources } from '@/lib/ingestion-store';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { normalizeNotebookId } from '@/lib/notebook-scope';

export async function GET(request: NextRequest) {
  let ownerMemberId: string | undefined;
  try {
    const accountSession = await resolveAccountSessionFromRequest(request);
    if (accountAuthRequired() && !accountSession) {
      return NextResponse.json({ error: '请先登录账号，再查看资料。' }, { status: 401 });
    }
    ownerMemberId = accountSession?.member.id;
  } catch {
    return NextResponse.json({ error: '账号登录已过期，请重新登录。' }, { status: 401 });
  }

  const sourceId = request.nextUrl.searchParams.get('id')?.trim();
  const notebookId = normalizeNotebookId(request.nextUrl.searchParams.get('notebookId'));

  if (sourceId) {
    const source = await getIngestionSource(sourceId, { ownerMemberId, notebookId });
    if (!source) {
      return NextResponse.json({ error: 'source not found' }, { status: 404 });
    }
    return NextResponse.json({ source }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const sources = await listIngestionSources({ ownerMemberId, notebookId });
  return NextResponse.json({
    sources: sources.map(source => ({
      id: source.id,
      notebookId: source.notebookId,
      fileName: source.fileName,
      fileType: source.fileType,
      fileSize: source.fileSize,
      title: source.title,
      shortName: source.shortName,
      status: source.status,
      createdAt: source.createdAt,
      stages: source.stages,
      chunkCount: source.chunkCount,
      tokenEstimate: source.tokenEstimate,
      vectorIndex: source.vectorIndex,
      mineru: source.mineru,
      literature: source.literature,
      updatedAt: source.updatedAt,
      error: source.error,
    })),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('ids' in body) || !('notebookId' in body)
    || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 500
    || !body.ids.every((id: unknown) => typeof id === 'string' && id.trim().length > 0 && id.length <= 200)
    || typeof body.notebookId !== 'string' || !normalizeNotebookId(body.notebookId)) {
    return NextResponse.json({ error: '请选择当前文献本中要删除的文献（每次最多 500 个）。' }, { status: 400 });
  }
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId, loginMessage: '请先登录账号，再删除文献。',
  });
  if (!scope.ok) return scope.response;
  try {
    const deletedIds = await deleteIngestionSources(body.ids, {
      ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId!,
    });
    return NextResponse.json({ success: true, deletedIds }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const conflict = error instanceof SourceDeletionConflict;
    return NextResponse.json({ error: conflict ? error.message : '删除失败，请稍后重试。' }, { status: conflict ? 409 : 500 });
  }
}
