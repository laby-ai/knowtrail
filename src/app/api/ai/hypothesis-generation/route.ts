import { NextRequest } from 'next/server';
import { llmStream } from '@/lib/ai-service';
import { reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import {
  buildHypothesisGenerationPrompt,
  classifyHypothesisGeneration,
  hasSubstantiveHypothesisEvidence,
  parseHypothesisGenerationOutput,
} from '@/lib/hypothesis-generation-contract';
import type { RagSourceInput } from '@/lib/rag';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';

type HypothesisGenerationRequest = {
  question?: string;
  papers?: RagSourceInput[];
  notebookId?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
};

const HYPOTHESIS_SYSTEM_PROMPT = `你是一位严谨的科研假设设计助手。
只根据用户提供的证据片段生成结构化 JSON，不输出 Markdown 或额外说明。
每个假设必须可证伪，明确竞争解释、验证路径、证据编号和不确定性。
不得宣称新颖性、因果关系、统计显著性、实验完成或未提供的事实。`;

function jsonError(error: string, errorType: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ success: false, error, errorType, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  let input: HypothesisGenerationRequest;
  try {
    input = await request.json() as HypothesisGenerationRequest;
  } catch {
    return jsonError('假设生成请求格式无效。', 'hypothesis_generation_invalid_request', 400);
  }

  const question = input.question?.trim() || '';
  const papers = Array.isArray(input.papers) ? input.papers : [];
  if (!question) return jsonError('请先填写需要探索的研究问题。', 'hypothesis_generation_question_required', 400);
  if (papers.length === 0) {
    return jsonError('请先在左侧文献本选择至少一个证据来源。', 'hypothesis_generation_sources_required', 400);
  }

  const scope = await resolveAccountNotebookScope(request, {
    notebookId: input.notebookId,
    loginMessage: '请先登录账号，再生成研究假设。',
  });
  if (!scope.ok) return scope.response;

  const runtimeConfig = resolveServerRuntimeAIConfig(input.aiConfig);
  const retrievalQuery = `研究问题：${question}\n请检索可支持或反驳研究假设、竞争解释和可验证预测的证据。`;
  const grounded = await buildGroundedRetrievalContext(retrievalQuery, papers, runtimeConfig, {
    topK: 12,
    ownerMemberId: scope.ownerMemberId,
    notebookId: scope.notebookId,
  });
  const retrieval = toRetrievalMetadata(grounded);
  if (!hasSubstantiveHypothesisEvidence(grounded.citations)) {
    return jsonError(
      '当前选定来源中没有可用证据片段，不能生成研究假设。请等待资料解析完成、补充来源或收窄问题。',
      'hypothesis_generation_no_evidence',
      422,
      { hypothesisStatus: { answerStatus: 'no-evidence' }, citations: [], retrieval },
    );
  }

  const modelName = runtimeConfig.model?.trim() || 'doubao-seed-2-0-pro-260215';
  const prompt = buildHypothesisGenerationPrompt({
    question,
    evidenceContext: grounded.promptContext,
    sourceCount: papers.length,
  });

  let usageReservation = null;
  try {
    usageReservation = await reserveAIUsage({
      route: 'hypothesis-generation',
      modelName,
      inputText: question,
      promptContext: grounded.promptContext,
      memberId: scope.ownerMemberId,
    });
  } catch (billingError) {
    const status = billingError instanceof AccountServiceError ? billingError.status : 402;
    const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
    return jsonError('账号积分不足，请先充值，或联系管理员分配积分后再生成研究假设。', code, status);
  }

  const configuredTimeoutMs = Number(process.env.HYPOTHESIS_GENERATION_LLM_TIMEOUT_MS || 120_000);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(30_000, configuredTimeoutMs) : 120_000;
  const taskController = new AbortController();
  const abortFromRequest = () => taskController.abort(request.signal.reason);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener('abort', abortFromRequest, { once: true });

  const encoder = new TextEncoder();
  let streamClosed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const timeoutId = setTimeout(() => taskController.abort(new Error('hypothesis generation timed out')), timeoutMs);
      const emit = (payload: unknown) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`));
        } catch {
          streamClosed = true;
        }
      };
      let rawOutput = '';
      let reservationFinalized = false;

      try {
        emit({
          progress: {
            stage: 'evidence-ready',
            progress: 32,
            message: `已从选定来源匹配 ${grounded.citations.length} 条证据，正在区分支持与反证线索。`,
          },
          citations: grounded.citations,
          retrieval,
          billing: usageReservation ? { status: 'reserved', estimatedUnits: usageReservation.estimatedUnits } : undefined,
        });
        emit({
          progress: {
            stage: 'generating',
            progress: 58,
            message: '正在生成可区分假设、竞争解释与可证伪预测。',
          },
        });

        for await (const chunk of llmStream([
          { role: 'system', content: HYPOTHESIS_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ], {
          model: modelName,
          temperature: 0.4,
          maxTokens: 3000,
          signal: taskController.signal,
        }, undefined, runtimeConfig)) {
          rawOutput += chunk;
        }

        emit({
          progress: {
            stage: 'auditing',
            progress: 90,
            message: '假设已生成，正在检查结构、证据编号和可证伪边界。',
          },
        });

        let billing: { status: 'settled' } | { status: 'settle_failed'; code: string } | undefined;
        if (usageReservation) {
          try {
            await usageReservation.settle(rawOutput);
            reservationFinalized = true;
            billing = { status: 'settled' };
          } catch (billingError) {
            reservationFinalized = true;
            billing = {
              status: 'settle_failed',
              code: billingError instanceof AccountServiceError ? billingError.code : 'account_settle_failed',
            };
          }
        }

        let result;
        try {
          result = parseHypothesisGenerationOutput(rawOutput);
        } catch (parseError) {
          emit({
            error: parseError instanceof Error ? parseError.message : '模型返回的假设结构不完整。',
            errorType: 'hypothesis_generation_invalid_output',
            hypothesisStatus: {
              answerStatus: 'incomplete',
              retrievalLimits: ['模型输出未通过结构检查，未展示为可用假设卡片。'],
            },
            billing,
          });
          emit('[DONE]');
          if (!streamClosed) {
            streamClosed = true;
            controller.close();
          }
          return;
        }

        const invalidEvidenceMarkers = [...new Set(result.hypotheses.flatMap(item => item.evidenceMarkers))]
          .filter(marker => marker < 1 || marker > grounded.citations.length);
        const hypothesesWithValidEvidence = result.hypotheses.filter(item =>
          item.evidenceMarkers.some(marker => marker >= 1 && marker <= grounded.citations.length),
        ).length;
        const answerStatus = classifyHypothesisGeneration({
          hypothesisCount: result.hypotheses.length,
          validEvidenceMarkerCount: hypothesesWithValidEvidence,
        });

        emit({
          hypotheses: result.hypotheses,
          hypothesisStatus: {
            answerStatus: invalidEvidenceMarkers.length === 0 ? answerStatus : 'incomplete',
            invalidEvidenceMarkers,
            retrievalLimits: [
              '假设仅基于当前选定来源及其可检索片段。',
              '假设尚未经过实验、统计检验或新颖性审查。',
            ],
          },
          billing,
        });
        emit('[DONE]');
        if (!streamClosed) {
          streamClosed = true;
          controller.close();
        }
      } catch (error) {
        if (usageReservation && !reservationFinalized) {
          if (rawOutput) await usageReservation.settle(rawOutput).catch(() => undefined);
          else await usageReservation.release().catch(() => undefined);
        }
        const aborted = taskController.signal.aborted;
        emit({
          error: aborted
            ? '假设生成已停止或超过等待时间；未通过结构检查的内容不会展示为可用假设。'
            : error instanceof Error ? error.message : '假设生成失败。',
          errorType: aborted ? 'hypothesis_generation_interrupted' : 'hypothesis_generation_failed',
          hypothesisStatus: {
            answerStatus: 'incomplete',
            retrievalLimits: ['生成未完整结束，不能作为可用研究假设。'],
          },
        });
        if (!streamClosed) {
          streamClosed = true;
          controller.close();
        }
      } finally {
        clearTimeout(timeoutId);
        request.signal.removeEventListener('abort', abortFromRequest);
      }
    },
    cancel() {
      taskController.abort(new Error('hypothesis generation client cancelled'));
    },
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
