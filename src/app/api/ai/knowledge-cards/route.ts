import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { buildKnowledgeCardsPayload, type KnowledgeCardRequestInput } from '@/lib/knowledge-card-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as KnowledgeCardRequestInput;
    const scope = await resolveAccountNotebookScope(request, {
      notebookId: body.notebookId,
      loginMessage: '请先登录账号，再生成知识卡片。',
    });
    if (!scope.ok) return scope.response;
    const result = await buildKnowledgeCardsPayload({
      ...body,
      ownerMemberId: scope.ownerMemberId,
      notebookId: scope.notebookId,
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '生成知识卡片失败';
    console.error('[knowledge-cards] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
