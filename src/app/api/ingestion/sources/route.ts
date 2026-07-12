import { NextRequest, NextResponse } from 'next/server';
import { getIngestionSource, listIngestionSources } from '@/lib/ingestion-store';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { normalizeNotebookId } from '@/lib/notebook-scope';
import { IngestionRetryError, retryIngestionSource } from '@/lib/ingestion-retry';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';

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

export async function POST(request: NextRequest) {
  let ownerMemberId: string | undefined;
  try {
    const accountSession = await resolveAccountSessionFromRequest(request);
    if (accountAuthRequired() && !accountSession) {
      return NextResponse.json({ error: '请先登录账号，再继续处理文献。' }, { status: 401 });
    }
    ownerMemberId = accountSession?.member.id;
  } catch {
    return NextResponse.json({ error: '账号登录已过期，请重新登录。' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { sourceId?: string; notebookId?: string };
  const sourceId = body.sourceId?.trim();
  const notebookId = normalizeNotebookId(body.notebookId);
  if (!sourceId) return NextResponse.json({ error: '缺少文献标识。' }, { status: 400 });

  const source = await getIngestionSource(sourceId, { ownerMemberId, notebookId });
  if (!source) return NextResponse.json({ error: '文献不存在或无权访问。' }, { status: 404 });

  try {
    const retried = await retryIngestionSource(source, { aiConfig: resolveServerRuntimeAIConfig() });
    return NextResponse.json({ source: retried }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof IngestionRetryError) {
      const status = error.code === 'not_retryable' ? 409 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: '文献重新处理失败，请稍后重试。' }, { status: 500 });
  }
}
