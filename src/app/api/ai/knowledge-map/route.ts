import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { buildKnowledgeMapPayload, type KnowledgeMapRequestInput } from '@/lib/knowledge-map-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as KnowledgeMapRequestInput;
    const scope = await resolveAccountNotebookScope(request, {
      notebookId: body.notebookId,
      loginMessage: '请先登录账号，再生成研究脉络。',
    });
    if (!scope.ok) return scope.response;
    const result = await buildKnowledgeMapPayload({
      ...body,
      ownerMemberId: scope.ownerMemberId,
      notebookId: scope.notebookId,
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error, errorType: result.errorType }, { status: result.status });
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '生成研究脉络失败';
    console.error('[knowledge-map] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
