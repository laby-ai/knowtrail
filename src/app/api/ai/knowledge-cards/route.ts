import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { buildKnowledgeCardsPayload, type KnowledgeCardRequestInput } from '@/lib/knowledge-card-service';
import { emptyLearningMaterials, isLearningMaterials, type LearningMaterials } from '@/lib/learning-materials';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument, type NotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';
import type { RagSourceInput } from '@/lib/rag';
import { getIngestionSource } from '@/lib/ingestion-store';
import { isLearningInput } from '@/lib/research-agent-learning';

const headers = { 'Cache-Control': 'private, no-store' };
const documentName = 'learning-materials';

async function resolveScope(request: NextRequest, notebookId: unknown): Promise<PrivateNotebookScope | { response: Response }> {
  const scope = await resolveAccountNotebookScope(request, { notebookId, loginMessage: '请先登录，再打开学习材料。', requireAuthenticatedPaperHost: true });
  if (!scope.ok) return { response: scope.response };
  if (!scope.ownerMemberId) return { response: NextResponse.json({ error: '请先登录。' }, { status: 401, headers }) };
  if (!scope.notebookId) return { response: NextResponse.json({ error: '请先打开文献本。' }, { status: 400, headers }) };
  return { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId };
}

function failed(error: unknown) {
  if (error instanceof NotebookDocumentConflict) return NextResponse.json({ error: error.message }, { status: 409, headers });
  return NextResponse.json({ error: '学习材料暂时无法保存或读取，请重试。' }, { status: 503, headers });
}

export async function GET(request: NextRequest) {
  const scope = await resolveScope(request, request.nextUrl.searchParams.get('notebookId'));
  if ('response' in scope) return scope.response;
  try {
    const revision = request.nextUrl.searchParams.get('revision');
    if (revision && !/^[a-f0-9]{64}$/.test(revision)) return NextResponse.json({ error: '学习材料版本无效。' }, { status: 400, headers });
    const saved = await readNotebookDocument<LearningMaterials>(scope, documentName, revision || undefined);
    if (!saved) return NextResponse.json({ error: '还没有保存学习材料。' }, { status: 404, headers });
    if (!isLearningMaterials(saved.data)) throw new Error('Invalid saved learning materials');
    return NextResponse.json({ document: saved }, { headers });
  } catch (error) { return failed(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { notebookId?: unknown; data?: unknown; expectedRevision?: unknown };
    const scope = await resolveScope(request, body.notebookId);
    if ('response' in scope) return scope.response;
    if (!isLearningMaterials(body.data) || (body.expectedRevision !== null && typeof body.expectedRevision !== 'string')) {
      return NextResponse.json({ error: '学习材料或保存版本不完整，请重新读取。' }, { status: 400, headers });
    }
    const saved = await saveNotebookDocument(scope, documentName, body.data, body.expectedRevision);
    return NextResponse.json({ document: saved }, { headers });
  } catch (error) { return failed(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as KnowledgeCardRequestInput & { expectedRevision?: string | null; runId?: unknown; kind?: unknown };
    const scope = await resolveScope(request, body.notebookId);
    if ('response' in scope) return scope.response;
    if (body.runId !== undefined) {
      if (typeof body.runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.runId) || !isLearningInput({ kind: body.kind, question: body.question })
        || !Array.isArray(body.papers) || !body.papers.length || body.papers.length > 20) return NextResponse.json({ error: '本轮复习范围或来源不完整。' }, { status: 400, headers });
      const canonical: RagSourceInput[] = [];
      for (const paper of body.papers) {
        const source = typeof paper?.id === 'string' ? await getIngestionSource(paper.id, scope) : null;
        if (!source || !(source.rawContent || source.content)?.trim()) return NextResponse.json({ error: '所选资料暂不可读，请重新读取。' }, { status: 404, headers });
        canonical.push({ id: source.id, title: source.title, content: source.content || '', rawContent: source.rawContent || source.content || '', fileType: source.fileType });
      }
      body.papers = canonical;
      body.aiConfig = undefined; body.debugRetrievalOnly = false; body.debugAnswerText = undefined;
    }
    if (!body.debugRetrievalOnly) {
      const previous = await readNotebookDocument(scope, documentName);
      if ((previous?.revision || null) !== (body.expectedRevision || null)) throw new NotebookDocumentConflict();
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
    const result = await buildKnowledgeCardsPayload({
      ...body,
      ownerMemberId: scope.ownerMemberId,
      notebookId: scope.notebookId,
      signal,
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status, headers });
    }
    if ('cards' in result.body) {
      const data = { ...emptyLearningMaterials(), ...result.body };
      const document: LearningMaterials = {
        cards: data.cards, citations: data.citations, retrieval: data.retrieval, citationAudit: data.citationAudit,
        cardIndex: 0, quizIndex: 0, answers: {},
        ...(typeof body.runId === 'string' && isLearningInput({ kind: body.kind, question: body.question }) ? { generation: { runId: body.runId, question: body.question!, kind: body.kind as 'knowledge-cards' | 'quiz' } } : {}),
      };
      signal.throwIfAborted();
      if (body.runId && (!isLearningMaterials(document) || !document.citations.length)) return NextResponse.json({ error: '本轮材料缺少可核对来源，未保存，请检查原文。' }, { status: 503, headers });
      let saved: NotebookDocument<LearningMaterials>;
      try { saved = await saveNotebookDocument<LearningMaterials>(scope, documentName, document, body.expectedRevision || null); }
      catch (error) {
        if (body.runId) return NextResponse.json({ error: error instanceof NotebookDocumentConflict ? error.message : '本轮材料尚未保存，可重试保存。', unsavedDocument: document }, { status: error instanceof NotebookDocumentConflict ? 409 : 503, headers });
        throw error;
      }
      return NextResponse.json({ ...result.body, document: saved }, { headers });
    }
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (e: unknown) {
    if (e instanceof Error && /abort|timeout/i.test(e.name)) return NextResponse.json({ error: '生成超时，请稍后重试；已保存的材料仍可读取。' }, { status: 504, headers });
    return failed(e);
  }
}
