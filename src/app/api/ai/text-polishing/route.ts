import { NextRequest } from 'next/server';
import { llmStream } from '@/lib/ai-service';
import { accountUsageErrorMessage, reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { resolveRequestRuntimeAIConfigResult } from '@/lib/bailian-provider-profile';
import {
  auditTextPolishing,
  buildPolishingMarkdown,
  buildTextPolishingPrompt,
  buildTextProtection,
  parseTextPolishingOutput,
  type PolishingScene,
} from '@/lib/text-polishing-contract';
import type { RuntimeAIConfig } from '@/types';

type TextPolishingRequest = {
  sourceText?: string;
  goal?: string;
  scene?: PolishingScene;
  protectedTerms?: string[];
  notebookId?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
};

const SYSTEM_PROMPT = `你是一位保守的科研文本编辑。
只输出严格 JSON。默认少动，必须保持事实、术语、数字、单位、引用、图表编号和结论强度。
不得新增数据、统计结论、引用、因果、显著性、新颖性、期刊格式或投稿状态。`;

function jsonError(error: string, errorType: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ success: false, error, errorType, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function cleanTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 80);
}

function isScene(value: unknown): value is PolishingScene {
  return value === 'paper' || value === 'proposal' || value === 'presentation';
}

export async function POST(request: NextRequest) {
  let input: TextPolishingRequest;
  try {
    input = await request.json() as TextPolishingRequest;
  } catch {
    return jsonError('文本润色请求格式无效。', 'text_polishing_invalid_request', 400);
  }
  const sourceText = input.sourceText?.trim() || '';
  const goal = input.goal?.trim() || '';
  if (sourceText.length < 20) return jsonError('请粘贴至少 20 个字符的待润色文本。', 'text_polishing_source_required', 400);
  if (sourceText.length > 16_000) return jsonError('单次润色文本不能超过 16000 个字符。', 'text_polishing_source_too_long', 413);
  if (!isScene(input.scene)) return jsonError('请选择论文、项目书或讲稿场景。', 'text_polishing_scene_invalid', 400);

  const scope = await resolveAccountNotebookScope(request, {
    notebookId: input.notebookId,
    loginMessage: '请先登录账号，再润色科研文本。',
  });
  if (!scope.ok) return scope.response;

  const protection = buildTextProtection(sourceText, cleanTerms(input.protectedTerms));
  const runtimeConfigResult = await resolveRequestRuntimeAIConfigResult(request, input.aiConfig);
  if (runtimeConfigResult instanceof Response) return runtimeConfigResult;
  const runtimeConfig = runtimeConfigResult;
  const modelName = runtimeConfig.model?.trim() || 'doubao-seed-2-0-pro-260215';
  const prompt = buildTextPolishingPrompt({ sourceText, goal, scene: input.scene, protection });
  let reservation = null;
  try {
    reservation = await reserveAIUsage({
      route: 'text-polishing',
      modelName,
      inputText: sourceText,
      promptContext: goal,
      memberId: scope.ownerMemberId,
      idempotencyKey: request.headers.get('idempotency-key') || undefined,
    });
  } catch (billingError) {
    const status = billingError instanceof AccountServiceError ? billingError.status : 402;
    const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
    return jsonError(accountUsageErrorMessage(billingError, '账号积分不足，请先充值，或联系管理员分配积分后再润色。'), code, status);
  }

  const configuredTimeoutMs = Number(process.env.TEXT_POLISHING_LLM_TIMEOUT_MS || 120_000);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(30_000, configuredTimeoutMs) : 120_000;
  const taskController = new AbortController();
  const abortFromRequest = () => taskController.abort(request.signal.reason);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener('abort', abortFromRequest, { once: true });

  const encoder = new TextEncoder();
  let streamClosed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const timeoutId = setTimeout(() => taskController.abort(new Error('text polishing timed out')), timeoutMs);
      const emit = (payload: unknown) => {
        if (streamClosed) return;
        try { controller.enqueue(encoder.encode(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)); }
        catch { streamClosed = true; }
      };
      let rawOutput = '';
      let reservationFinalized = false;
      try {
        emit({ progress: { stage: 'protecting', progress: 24, message: `已锁定 ${protection.items.length} 个数字、术语、引用或图表编号。` }, protection });
        emit({ progress: { stage: 'revising', progress: 54, message: '正在按最小修改原则调整结构、语序和表达。' } });
        for await (const chunk of llmStream([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ], {
          model: modelName,
          temperature: 0.2,
          maxTokens: 5000,
          signal: taskController.signal,
        }, undefined, runtimeConfig)) rawOutput += chunk;

        emit({ progress: { stage: 'auditing', progress: 90, message: '正在检查保护项、结论强度和逐项修改理由。' } });
        let billing: { status: 'settled' } | { status: 'settle_failed'; code: string } | undefined;
        if (reservation) {
          try { await reservation.settle(rawOutput); reservationFinalized = true; billing = { status: 'settled' }; }
          catch (billingError) {
            reservationFinalized = true;
            billing = { status: 'settle_failed', code: billingError instanceof AccountServiceError ? billingError.code : 'account_settle_failed' };
          }
        }

        let result;
        try { result = parseTextPolishingOutput(rawOutput); }
        catch (parseError) {
          emit({ error: parseError instanceof Error ? parseError.message : '模型返回的润色结构不完整。', errorType: 'text_polishing_invalid_output', billing });
          emit('[DONE]');
          if (!streamClosed) { streamClosed = true; controller.close(); }
          return;
        }
        const audit = auditTextPolishing(sourceText, result, protection);
        if (!audit.safe) {
          emit({
            error: '修订文本改变了受保护内容或增强了结论强度，已拒绝展示。请重试或收窄润色目标。',
            errorType: 'text_polishing_unsafe_output',
            audit,
            billing,
          });
          emit('[DONE]');
          if (!streamClosed) { streamClosed = true; controller.close(); }
          return;
        }
        emit({
          result,
          audit,
          artifactMarkdown: buildPolishingMarkdown(sourceText, result, audit),
          artifactFileName: 'scientific-text-revision.md',
          billing,
        });
        emit('[DONE]');
        if (!streamClosed) { streamClosed = true; controller.close(); }
      } catch (error) {
        if (reservation && !reservationFinalized) {
          if (rawOutput) await reservation.settle(rawOutput).catch(() => undefined);
          else await reservation.release().catch(() => undefined);
        }
        const aborted = taskController.signal.aborted;
        emit({
          error: aborted ? '文本润色已停止或超过等待时间；未通过保护检查的内容不会展示。' : error instanceof Error ? error.message : '文本润色失败。',
          errorType: aborted ? 'text_polishing_interrupted' : 'text_polishing_failed',
        });
        if (!streamClosed) { streamClosed = true; controller.close(); }
      } finally {
        clearTimeout(timeoutId);
        request.signal.removeEventListener('abort', abortFromRequest);
      }
    },
    cancel() { taskController.abort(new Error('text polishing client cancelled')); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
