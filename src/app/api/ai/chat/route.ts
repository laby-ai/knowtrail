import { NextRequest } from 'next/server';
import { llmStream, SYSTEM_PROMPTS } from '@/lib/ai-service';
import type { RuntimeAIConfig } from '@/types';
import type { RagSourceInput } from '@/lib/rag';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { auditCitationMarkers } from '@/lib/citation-audit';
import { resolveRequestRuntimeAIConfigResult } from '@/lib/bailian-provider-profile';
import { accountUsageErrorMessage, reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { normalizeNotebookId } from '@/lib/notebook-scope';
import {
  resolveStudioGenerationReadiness,
  studioGenerationUnavailablePayload,
} from '@/lib/studio-generation-readiness';

export async function POST(request: NextRequest) {
  try {
    const { message, papers, mode, aiConfig, maxTokens, debugRetrievalOnly, debugAnswerText, notebookId: rawNotebookId } = await request.json() as {
      message?: string;
      papers?: RagSourceInput[];
      mode?: string;
      aiConfig?: Partial<RuntimeAIConfig>;
      maxTokens?: number;
      debugRetrievalOnly?: boolean;
      debugAnswerText?: string;
      notebookId?: string;
    };
    const notebookId = normalizeNotebookId(rawNotebookId);

    if (!message) {
      return new Response(JSON.stringify({ error: '缺少消息内容' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let accountSession: Awaited<ReturnType<typeof resolveAccountSessionFromRequest>> = null;
    try {
      accountSession = await resolveAccountSessionFromRequest(request);
    } catch {
      return new Response(JSON.stringify({
        error: '账号登录已过期，请重新登录。',
        billing: { status: 'failed', code: 'invalid_account_session' },
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    if (accountAuthRequired() && !accountSession) {
      return new Response(JSON.stringify({
        error: '请先登录账号，再使用模型问答。',
        billing: { status: 'failed', code: 'account_login_required' },
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const readiness = resolveStudioGenerationReadiness().researchChat;
    if (!debugRetrievalOnly && !readiness.ready) {
      return new Response(JSON.stringify(studioGenerationUnavailablePayload(readiness)), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const runtimeConfigResult = await resolveRequestRuntimeAIConfigResult(request, aiConfig);
    if (runtimeConfigResult instanceof Response) return runtimeConfigResult;
    const runtimeConfig = runtimeConfigResult;
    const grounded = await buildGroundedRetrievalContext(message, papers || [], runtimeConfig, {
      ownerMemberId: accountSession?.member.id,
      notebookId,
    });

    if (debugRetrievalOnly) {
      return new Response(JSON.stringify({
        success: true,
        citations: grounded.citations,
        retrieval: toRetrievalMetadata(grounded),
        promptContextLength: grounded.promptContext.length,
        citationAudit: typeof debugAnswerText === 'string'
          ? auditCitationMarkers(debugAnswerText, grounded.citations)
          : undefined,
      }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const systemPrompt = mode === 'report'
      ? SYSTEM_PROMPTS.reportGeneration
      : SYSTEM_PROMPTS.academicQA;
    const modelName = runtimeConfig.model?.trim() || 'doubao-seed-2-0-pro-260215';
    const boundedMaxTokens = Number.isInteger(maxTokens) && typeof maxTokens === 'number'
      ? Math.min(Math.max(maxTokens, 1), 4096)
      : undefined;
    const llmTimeoutMs = Math.max(10_000, Number(process.env.CHAT_LLM_TIMEOUT_MS || 60_000));

    const citationRules = grounded.citations.length > 0
      ? [
          '引用规则：',
          '- 回答中必须至少出现一个引用编号，例如 [1]。',
          '- 每个关键事实句或结论句尾必须标注对应证据编号，如 [1] 或 [1][2]。',
          '- 只能使用上方证据片段中存在的编号，不要编造未给出的来源。',
          '- 如果证据不足，先说明不足，再引用最相关的已有证据。',
        ].join('\n')
      : '';

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...(grounded.promptContext ? [{
        role: 'user' as const,
        content: `以下是从当前资料库检索出的证据片段。回答必须优先基于这些片段。\n\n${citationRules}\n\n${grounded.promptContext}`,
      }] : []),
      {
        role: 'user' as const,
        content: grounded.citations.length > 0
          ? `请回答用户问题，并严格遵守上方引用规则。\n\n用户问题：${message}`
          : message,
      },
    ];

    let usageReservation = null;
    try {
      usageReservation = await reserveAIUsage({
        route: 'chat',
        modelName,
        inputText: message,
        promptContext: grounded.promptContext,
        memberId: accountSession?.member.id,
        idempotencyKey: request.headers.get('idempotency-key') || undefined,
      });
    } catch (billingError) {
      const status = billingError instanceof AccountServiceError ? billingError.status : 402;
      const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
      return new Response(JSON.stringify({
        error: accountUsageErrorMessage(billingError, '账号积分不足，请先充值，或联系管理员分配积分后再使用灵笔。'),
        billing: { status: 'failed', code },
      }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Stream response as SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const llmSignal = AbortSignal.timeout(llmTimeoutMs);
        try {
          let answerText = '';
          if (grounded.citations.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              citations: grounded.citations,
              retrieval: toRetrievalMetadata(grounded),
              billing: usageReservation ? { status: 'reserved', estimatedUnits: usageReservation.estimatedUnits } : undefined,
            })}\n\n`));
          } else if (usageReservation) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              billing: { status: 'reserved', estimatedUnits: usageReservation.estimatedUnits },
            })}\n\n`));
          }
          for await (const chunk of llmStream(messages, {
            model: modelName,
            temperature: mode === 'report' ? 0.5 : 0.3,
            maxTokens: boundedMaxTokens,
            signal: llmSignal,
          }, undefined, runtimeConfig)) {
            answerText += chunk;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            citationAudit: auditCitationMarkers(answerText, grounded.citations),
          })}\n\n`));
          if (usageReservation) {
            try {
              await usageReservation.settle(answerText);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ billing: { status: 'settled' } })}\n\n`));
            } catch (billingError) {
              const code = billingError instanceof AccountServiceError ? billingError.code : 'account_settle_failed';
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ billing: { status: 'settle_failed', code } })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err) {
          if (usageReservation) {
            await usageReservation.release().catch(() => undefined);
          }
          const timedOut = llmSignal.aborted || (err instanceof Error && /abort|timeout|timed out/i.test(err.message));
          const msg = timedOut
            ? `真实模型生成超过 ${Math.round(llmTimeoutMs / 1000)} 秒，已停止等待。请稍后重试或缩短问题。`
            : err instanceof Error ? err.message : '生成失败';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '服务错误';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
