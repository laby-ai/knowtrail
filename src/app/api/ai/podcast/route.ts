import { NextRequest, NextResponse } from 'next/server';
import { classifyPodcastGenerationError, getPodcastStatus } from '@/lib/ai-service';
import { buildPodcastRetrievalPreview, getPodcastStudioJobResponse, submitPodcastJob } from '@/lib/studio-podcast-job';
import { toStudioJobResponse } from '@/lib/studio-job';
import type { RagSourceInput } from '@/lib/rag';
import type { RuntimeAIConfig } from '@/types';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { normalizeNotebookId } from '@/lib/notebook-scope';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      text?: string;
      content?: string;
      title?: string;
      papers?: RagSourceInput[];
      aiConfig?: Partial<RuntimeAIConfig>;
      debugRetrievalOnly?: boolean;
      notebookId?: string;
    };
    const { text, content, title, papers = [], aiConfig, debugRetrievalOnly } = body;
    const notebookId = normalizeNotebookId(body.notebookId);
    const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);

    const requestedText = text || content || '';
    if (!requestedText && papers.length === 0) {
      return NextResponse.json({ error: '缺少文本内容' }, { status: 400 });
    }

    let ownerMemberId: string | undefined;
    try {
      const accountSession = await resolveAccountSessionFromRequest(request);
      if (accountAuthRequired() && !accountSession) {
        return NextResponse.json({
          error: '请先登录账号，再生成语音摘要。',
          status: 'failed',
          errorType: 'account_login_required',
        }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      }
      ownerMemberId = accountSession?.member.id;
    } catch {
      return NextResponse.json({
        error: '账号登录已过期，请重新登录。',
        status: 'failed',
        errorType: 'invalid_account_session',
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }

    if (debugRetrievalOnly) {
      const preview = await buildPodcastRetrievalPreview({ requestedText, title, papers, aiConfig: runtimeConfig, ownerMemberId, notebookId });
      return NextResponse.json({
        success: true,
        citations: preview.citations,
        retrieval: preview.retrieval,
        promptContextLength: preview.promptContext.length,
      });
    }

    const job = await submitPodcastJob({ requestedText, title, papers, aiConfig: runtimeConfig, ownerMemberId, notebookId });
    return NextResponse.json(toStudioJobResponse(job), { status: 202 });
  } catch (error) {
    const failure = classifyPodcastGenerationError(error);
    console.error('[Podcast API Error]', failure.errorType, failure.error);
    const status = failure.errorType === 'auth'
      ? 401
      : failure.errorType === 'permission'
        ? 403
        : failure.errorType === 'rate_limit'
          ? 429
          : failure.errorType === 'invalid_request' || failure.errorType === 'configuration'
            ? 400
            : 502;
    return NextResponse.json({
      error: failure.userMessage,
      detail: failure.error,
      status: 'failed',
      errorType: failure.errorType,
      retryable: failure.retryable,
      retryAfterSeconds: failure.retryable ? 60 : undefined,
      requestId: failure.requestId,
      upstreamStatus: failure.upstreamStatus,
    }, { status });
  }
}

export async function GET(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get('taskId')?.trim();
    if (!taskId) {
      return NextResponse.json({ error: '缺少 taskId 参数' }, { status: 400 });
    }

    let ownerMemberId: string | undefined;
    try {
      const accountSession = await resolveAccountSessionFromRequest(request);
      if (accountAuthRequired() && !accountSession) {
        return NextResponse.json({
          error: '请先登录账号，再查看语音摘要任务。',
          status: 'failed',
          errorType: 'account_login_required',
        }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      }
      ownerMemberId = accountSession?.member.id;
    } catch {
      return NextResponse.json({
        error: '账号登录已过期，请重新登录。',
        status: 'failed',
        errorType: 'invalid_account_session',
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }

    const notebookId = normalizeNotebookId(request.nextUrl.searchParams.get('notebookId'));
    const studioJob = getPodcastStudioJobResponse(taskId, { ownerMemberId, notebookId });
    if (studioJob) {
      return NextResponse.json(studioJob);
    }
    if (taskId.startsWith('studio-podcast-')) {
      return NextResponse.json({ error: '任务不存在或无权访问', status: 'failed' }, { status: 404 });
    }
    const status = await getPodcastStatus(taskId);
    return NextResponse.json(status);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '播客状态查询失败';
    console.error('[Podcast Status API Error]', msg);
    return NextResponse.json({ error: msg, status: 'failed' }, { status: 502 });
  }
}
