import { NextRequest, NextResponse } from 'next/server';
import { deleteIngestionSource, getIngestionSource, listIngestionSources } from '@/lib/ingestion-store';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';

export async function GET(request: NextRequest) {
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: request.nextUrl.searchParams.get('notebookId'),
    loginMessage: '请先登录国科大科教平台，再查看资料。',
  });
  if (!scope.ok) {
    return scope.response;
  }

  const sourceId = request.nextUrl.searchParams.get('id')?.trim();
  const ownerMemberId = scope.ownerMemberId;
  const notebookId = scope.notebookId;

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
      updatedAt: source.updatedAt,
      error: source.error,
    })),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(request: NextRequest) {
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: request.nextUrl.searchParams.get('notebookId'),
    loginMessage: '请先登录国科大科教平台，再删除资料。',
  });
  if (!scope.ok) {
    return scope.response;
  }

  const sourceId = request.nextUrl.searchParams.get('id')?.trim();
  if (!sourceId) {
    return NextResponse.json({ error: 'source id is required' }, { status: 400 });
  }

  const deleted = await deleteIngestionSource(sourceId, {
    ownerMemberId: scope.ownerMemberId,
    notebookId: scope.notebookId,
  });
  if (!deleted) {
    return NextResponse.json({ error: 'source not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true, id: sourceId }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
