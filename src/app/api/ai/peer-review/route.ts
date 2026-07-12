import { NextRequest } from 'next/server';
import { llmStream } from '@/lib/ai-service';
import { accountUsageErrorMessage, reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { createGroundedSseResponse, createUsageReservationFinalizer } from '@/lib/grounded-task-lifecycle';
import { createGroundedTaskObservation } from '@/lib/operational-observability';
import {
  auditPeerReviewReport,
  buildPeerReviewMarkdown,
  buildPeerReviewPrompt,
  parsePeerReviewOutput,
  type PeerReviewPerspective,
} from '@/lib/peer-review-contract';
import type { RagSourceInput } from '@/lib/rag';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';

type PeerReviewRequest = {
  manuscript?: string;
  scope?: string;
  perspective?: PeerReviewPerspective;
  papers?: RagSourceInput[];
  notebookId?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
};

const SYSTEM_PROMPT = `你是一位严谨、克制的论文审查员。
只输出严格 JSON。审查只读，不直接改稿，不模拟多个审稿人，也不给接收、拒稿、大小修推荐或分数。
每条意见必须引用稿件中的确切片段，说明位置、问题、重要性和建议动作。
只有外部来源明确支持时才标 source-supported；无法核验的内容必须标 needs-verification。
不得编造审稿意见、实验缺陷、引用、数据、统计结论、伦理结论或作者意图。`;

function jsonError(error: string, errorType: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ success: false, error, errorType, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isPerspective(value: unknown): value is PeerReviewPerspective {
  return value === 'overall' || value === 'methodology' || value === 'evidence' || value === 'clarity';
}

export async function POST(request: NextRequest) {
  let input: PeerReviewRequest;
  try {
    input = await request.json() as PeerReviewRequest;
  } catch {
    return jsonError('论文审查请求格式无效。', 'peer_review_invalid_request', 400);
  }

  const manuscript = input.manuscript?.trim() || '';
  const scope = input.scope?.trim() || '';
  const papers = Array.isArray(input.papers) ? input.papers : [];
  if (manuscript.length < 100) return jsonError('请粘贴至少 100 个字符的稿件文本。', 'peer_review_manuscript_required', 400);
  if (manuscript.length > 30_000) return jsonError('单次审查稿件不能超过 30000 个字符。', 'peer_review_manuscript_too_long', 413);
  if (scope.length < 2) return jsonError('请填写本次审查范围。', 'peer_review_scope_required', 400);
  if (!isPerspective(input.perspective)) return jsonError('请选择有效的审查视角。', 'peer_review_perspective_invalid', 400);

  const reviewPerspective = input.perspective;

  const accountScope = await resolveAccountNotebookScope(request, {
    notebookId: input.notebookId,
    loginMessage: '请先登录账号，再审查论文稿件。',
  });
  if (!accountScope.ok) return accountScope.response;

  const runtimeConfig = resolveServerRuntimeAIConfig(input.aiConfig);
  const grounded = papers.length > 0
    ? await buildGroundedRetrievalContext(
      `论文审查范围：${scope}\n审查视角：${reviewPerspective}\n请匹配与稿件方法、结果解释、证据边界和可复现性相关的来源片段。`,
      papers,
      runtimeConfig,
      { topK: 10, ownerMemberId: accountScope.ownerMemberId, notebookId: accountScope.notebookId },
    )
    : null;
  const citations = grounded?.citations || [];
  const retrieval = grounded ? toRetrievalMetadata(grounded) : null;
  const prompt = buildPeerReviewPrompt({
    manuscript,
    scope,
    perspective: reviewPerspective,
    sourceCount: papers.length,
    evidenceContext: grounded?.promptContext || '',
  });

  const modelName = runtimeConfig.model?.trim() || 'doubao-seed-2-0-pro-260215';
  let reservation = null;
  try {
    reservation = await reserveAIUsage({
      route: 'peer-review',
      modelName,
      inputText: manuscript,
      promptContext: `${scope}\n${grounded?.promptContext || 'no external sources selected'}`,
      memberId: accountScope.ownerMemberId,
      idempotencyKey: request.headers.get('idempotency-key') || undefined,
    });
  } catch (billingError) {
    const status = billingError instanceof AccountServiceError ? billingError.status : 402;
    const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
    return jsonError(accountUsageErrorMessage(billingError, '账号积分不足，请先充值，或联系管理员分配积分后再审查论文。'), code, status);
  }

  const configuredTimeoutMs = Number(process.env.PEER_REVIEW_LLM_TIMEOUT_MS || 120_000);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(30_000, configuredTimeoutMs) : 120_000;
  const taskObservation = createGroundedTaskObservation({
    requestId: request.headers.get('x-request-id'),
    tenantId: accountScope.tenantId,
    memberId: accountScope.ownerMemberId,
    taskType: 'peer-review',
  });
  const reservationFinalizer = createUsageReservationFinalizer(reservation);
  let rawOutput = '';

  return createGroundedSseResponse({
    requestSignal: request.signal,
    timeoutMs,
    timeoutReason: 'peer review timed out',
    cancelReason: 'peer review client cancelled',
    async run({ emit, signal }) {
        taskObservation.running();
        emit({
          progress: {
            stage: 'reading',
            progress: 24,
            message: `正在按“${scope}”范围建立稿件定位索引。`,
          },
          citations,
          retrieval,
          billing: reservation ? { status: 'reserved', estimatedUnits: reservation.estimatedUnits } : undefined,
        });
        emit({
          progress: {
            stage: 'reviewing',
            progress: 58,
            message: citations.length > 0
              ? `正在结合 ${citations.length} 条来源线索形成可定位意见。`
              : '未选择外部来源；正在区分稿件内问题与待核验事项。',
          },
        });

        for await (const chunk of taskObservation.observeProvider(llmStream([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ], {
          model: modelName,
          temperature: 0.15,
          maxTokens: 5200,
          signal,
        }, undefined, runtimeConfig))) rawOutput += chunk;

        emit({ progress: { stage: 'auditing', progress: 91, message: '正在核对稿件片段、证据编号和审查边界。' } });
        const billing = await reservationFinalizer.settle(rawOutput);

        let report;
        try {
          report = parsePeerReviewOutput(rawOutput);
        } catch (parseError) {
          taskObservation.failed('peer_review_invalid_output', parseError);
          emit({
            error: parseError instanceof Error ? parseError.message : '模型返回的论文审查结构不完整。',
            errorType: 'peer_review_invalid_output',
            billing,
          });
          emit('[DONE]');
          return;
        }
        const audit = auditPeerReviewReport(manuscript, report, citations.length);
        if (!audit.safe) {
          taskObservation.failed('peer_review_unsafe_output', new Error('UnsafeOutput'));
          emit({
            error: '审查报告包含无法定位的意见、无效证据或编辑评分，已拒绝展示。请重试或收窄审查范围。',
            errorType: 'peer_review_unsafe_output',
            audit,
            billing,
          });
          emit('[DONE]');
          return;
        }
        emit({
          report,
          audit,
          citations,
          retrieval,
          artifactMarkdown: buildPeerReviewMarkdown(report, audit),
          artifactFileName: 'peer-review-report.md',
          reviewLimits: [
            '报告只覆盖用户提供的稿件文本；不会直接修改稿件。',
            '外部来源线索仍需回到原文核验；未检查原始数据、代码、完整图表、伦理文件或引用格式。',
            '本报告不包含接收、拒稿、大小修推荐或编辑评分。',
          ],
          billing,
        });
        taskObservation.succeeded();
        emit('[DONE]');
    },
    async onError(error, { emit, signal }) {
        await reservationFinalizer.finalizeFailure(rawOutput);
        const aborted = signal.aborted;
        if (aborted) taskObservation.cancelled('peer_review_interrupted');
        else taskObservation.failed('peer_review_failed', error);
        emit({
          error: aborted
            ? '论文审查已停止或超过等待时间；未通过完整定位检查的报告不会展示。'
            : error instanceof Error ? error.message : '论文审查失败。',
          errorType: aborted ? 'peer_review_interrupted' : 'peer_review_failed',
        });
    },
  });
}
