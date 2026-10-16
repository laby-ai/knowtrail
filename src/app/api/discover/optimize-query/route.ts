import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { llmInvoke } from '@/lib/ai-service';
import { optimizeDiscoverQuery } from '@/lib/discover-query-plan';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const body = await request.json() as { query?: string; scope?: 'webpage' | 'scholar'; notebookId?: string };
  const access = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号，再优化检索式。',
  });
  if (!access.ok) return access.response;
  try {
    const plan = await optimizeDiscoverQuery(
      body.query || '',
      body.scope === 'scholar' ? 'scholar' : 'webpage',
      llmInvoke,
      request.signal,
    );
    return NextResponse.json({ success: true, ...plan });
  } catch (error) {
    const message = error instanceof Error && /请输入/.test(error.message)
      ? error.message
      : '检索式优化暂不可用，可直接编辑检索式后搜索。';
    return NextResponse.json({ error: message }, { status: /请输入/.test(message) ? 400 : 503 });
  }
}
