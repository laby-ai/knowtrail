import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { buildKnowledgeCardsPayload, type KnowledgeCardRequestInput } from '@/lib/knowledge-card-service';
import { emptyLearningMaterials, isLearningMaterials, type LearningMaterials } from '@/lib/learning-materials';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';

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
    const saved = await readNotebookDocument<LearningMaterials>(scope, documentName);
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
    const body = await request.json() as KnowledgeCardRequestInput & { expectedRevision?: string | null };
    const scope = await resolveScope(request, body.notebookId);
    if ('response' in scope) return scope.response;
    if (!body.debugRetrievalOnly) {
      const previous = await readNotebookDocument(scope, documentName);
      if ((previous?.revision || null) !== (body.expectedRevision || null)) throw new NotebookDocumentConflict();
    }
    const result = await buildKnowledgeCardsPayload({
      ...body,
      ownerMemberId: scope.ownerMemberId,
      notebookId: scope.notebookId,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]),
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status, headers });
    }
    if ('cards' in result.body) {
      const data = { ...emptyLearningMaterials(), ...result.body };
      const saved = await saveNotebookDocument<LearningMaterials>(scope, documentName, {
        cards: data.cards, citations: data.citations, retrieval: data.retrieval, citationAudit: data.citationAudit,
        cardIndex: 0, quizIndex: 0, answers: {},
      }, body.expectedRevision || null);
      return NextResponse.json({ ...result.body, document: saved }, { headers });
    }
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (e: unknown) {
    if (e instanceof Error && /abort|timeout/i.test(e.name)) return NextResponse.json({ error: '生成超时，请稍后重试；已保存的材料仍可读取。' }, { status: 504, headers });
    return failed(e);
  }
}
