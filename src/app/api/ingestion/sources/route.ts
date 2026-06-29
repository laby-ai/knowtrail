import { NextRequest, NextResponse } from 'next/server';
import { getIngestionSource, listIngestionSources } from '@/lib/ingestion-store';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
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
      updatedAt: source.updatedAt,
      error: source.error,
    })),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
