import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { buildKnowledgeMapPayload, type KnowledgeMapRequestInput } from '@/lib/knowledge-map-service';
import { isKnowledgeMapDocument, type KnowledgeMapDocument } from '@/lib/knowledge-map-document';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument } from '@/lib/private-notebook-document';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as KnowledgeMapRequestInput & { persistArtifact?: boolean; expectedRevision?: string | null; runId?: string };
    const scope = await resolveAccountNotebookScope(request, {
      notebookId: body.notebookId,
      loginMessage: '请先登录账号，再生成研究脉络。',
    });
    if (!scope.ok) return scope.response;
    if (body.runId !== undefined && (!/^[a-f0-9-]{36}$/i.test(body.runId) || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1200 || typeof body.deepExtract !== 'boolean')) {
      return NextResponse.json({ error: '本轮研究问题或生成信息不完整。' }, { status: 400, headers });
    }
    const verified = scope.ownerMemberId && scope.notebookId ? { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId } : null;
    if (body.persistArtifact) {
      if (!verified) return NextResponse.json({ error: '请先登录并打开文献本。' }, { status: 401, headers });
      if (body.expectedRevision !== null && typeof body.expectedRevision !== 'string') return NextResponse.json({ error: '缺少保存版本，请重新读取。' }, { status: 400, headers });
      const previous = await readNotebookDocument(verified, 'knowledge-map');
      if (previous && !isKnowledgeMapDocument(previous.data)) throw new Error('保存记录暂时无法读取。');
      if ((previous?.revision || null) !== body.expectedRevision) throw new NotebookDocumentConflict();
    }
    const result = await buildKnowledgeMapPayload({
      ...body,
      ownerMemberId: scope.ownerMemberId,
      notebookId: scope.notebookId,
      signal: request.signal,
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error, errorType: result.errorType }, { status: result.status, headers });
    }
    if (body.persistArtifact && verified && 'map' in result.body) {
      request.signal.throwIfAborted();
      const data: KnowledgeMapDocument = { session: { ...result.body, cache: 'cache' in result.body ? result.body.cache : null, sourceCount: body.papers.length }, ...(body.runId ? { generation: { runId: body.runId, question: body.question!, deepExtract: body.deepExtract === true } } : {}) };
      try {
        if (!isKnowledgeMapDocument(data)) throw new Error('研究脉络格式不完整。');
        const document = await saveNotebookDocument(verified, 'knowledge-map', data, body.expectedRevision!);
        return NextResponse.json({ ...result.body, document }, { headers });
      } catch (error) {
        return NextResponse.json({ error: error instanceof NotebookDocumentConflict ? error.message : '研究脉络尚未保存，请重试保存。', unsavedDocument: data }, { status: error instanceof NotebookDocumentConflict ? 409 : 503, headers });
      }
    }
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '生成研究脉络失败';
    console.error('[knowledge-map] Error:', msg);
    return NextResponse.json({ error: e instanceof NotebookDocumentConflict ? e.message : '研究脉络暂时无法生成或保存，请重试。' }, { status: e instanceof NotebookDocumentConflict ? 409 : 503, headers });
  }
}
