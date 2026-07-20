import { NextRequest } from 'next/server';
import { llmStream, SYSTEM_PROMPTS } from '@/lib/ai-service';
import { accountUsageErrorMessage, reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { auditCitationMarkers, auditCitationSectionCoverage } from '@/lib/citation-audit';
import {
  DEEP_RESEARCH_REQUIRED_SECTIONS,
  buildDeepResearchPrompt,
  buildDeepResearchRepairPrompt,
  classifyDeepResearchAnswer,
  hasSubstantiveDeepResearchEvidence,
  removeUncitedDeepResearchClaims,
} from '@/lib/deep-research-contract';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { createGroundedSseResponse, createUsageReservationFinalizer } from '@/lib/grounded-task-lifecycle';
import { createGroundedTaskObservation } from '@/lib/operational-observability';
import type { RagSourceInput } from '@/lib/rag';
import { resolveRequestRuntimeAIConfigResult } from '@/lib/bailian-provider-profile';
import type { RuntimeAIConfig } from '@/types';

type DeepResearchRequest = {
  question?: string;
  papers?: RagSourceInput[];
  notebookId?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
};

function jsonError(error: string, errorType: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({
    success: false,
    error,
    errorType,
    ...extra,
  }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  let input: DeepResearchRequest;
  try {
    input = await request.json() as DeepResearchRequest;
  } catch {
    return jsonError('深度研究请求格式无效。', 'deep_research_invalid_request', 400);
  }

  const question = input.question?.trim() || '';
  const papers = Array.isArray(input.papers) ? input.papers : [];
  if (!question) {
    return jsonError('请先填写需要研究的问题。', 'deep_research_question_required', 400);
  }
  if (papers.length === 0) {
    return jsonError('请先在左侧文献库选择至少一个证据来源。', 'deep_research_sources_required', 400);
  }

  const scope = await resolveAccountNotebookScope(request, {
    notebookId: input.notebookId,
    loginMessage: '请先登录账号，再进行深度研究。',
  });
  if (!scope.ok) return scope.response;

  const runtimeConfigResult = await resolveRequestRuntimeAIConfigResult(request, input.aiConfig);
  if (runtimeConfigResult instanceof Response) return runtimeConfigResult;
  const runtimeConfig = runtimeConfigResult;
  const retrievalQuery = `深度研究问题：${question}\n请检索与研究边界、主要结论、争议和待核验问题有关的证据。`;
  const grounded = await buildGroundedRetrievalContext(retrievalQuery, papers, runtimeConfig, {
    topK: 12,
    ownerMemberId: scope.ownerMemberId,
    notebookId: scope.notebookId,
  });
  const retrieval = toRetrievalMetadata(grounded);
  if (!hasSubstantiveDeepResearchEvidence(grounded.citations)) {
    return jsonError(
      '当前选定来源中没有可用证据片段，不能生成研究报告。请等待资料解析完成、补充来源或收窄问题。',
      'deep_research_no_evidence',
      422,
      { answerStatus: 'no-evidence', citations: [], retrieval },
    );
  }

  const modelName = runtimeConfig.model?.trim() || 'doubao-seed-2-0-pro-260215';
  const prompt = buildDeepResearchPrompt({
    question,
    evidenceContext: grounded.promptContext,
    sourceCount: papers.length,
  });

  let usageReservation = null;
  try {
    usageReservation = await reserveAIUsage({
      route: 'deep-research',
      modelName,
      inputText: question,
      promptContext: grounded.promptContext,
      memberId: scope.ownerMemberId,
      idempotencyKey: request.headers.get('idempotency-key') || undefined,
    });
  } catch (billingError) {
    const status = billingError instanceof AccountServiceError ? billingError.status : 402;
    const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
    return jsonError(
      accountUsageErrorMessage(billingError, '账号积分不足，请先充值，或联系管理员分配积分后再使用深度研究。'),
      code,
      status,
    );
  }

  const configuredTimeoutMs = Number(process.env.DEEP_RESEARCH_LLM_TIMEOUT_MS || 120_000);
  const timeoutMs = Number.isFinite(configuredTimeoutMs)
    ? Math.max(30_000, configuredTimeoutMs)
    : 120_000;
  const taskObservation = createGroundedTaskObservation({
    requestId: request.headers.get('x-request-id'),
    tenantId: scope.tenantId,
    memberId: scope.ownerMemberId,
    taskType: 'deep-research',
  });
  const reservationFinalizer = createUsageReservationFinalizer(usageReservation);
  let answerText = '';

  return createGroundedSseResponse({
    requestSignal: request.signal,
    timeoutMs,
    timeoutReason: 'deep research timed out',
    cancelReason: 'deep research client cancelled',
    async run({ emit, signal }) {
        taskObservation.running();
        emit({
          progress: {
            stage: 'evidence-ready',
            progress: 28,
            message: `已从选定来源匹配 ${grounded.citations.length} 条证据，正在组织研究结构。`,
          },
          citations: grounded.citations,
          retrieval,
          billing: usageReservation
            ? { status: 'reserved', estimatedUnits: usageReservation.estimatedUnits }
            : undefined,
        });
        emit({
          progress: {
            stage: 'writing',
            progress: 52,
            message: '正在按研究问题、证据、争议和待核验项生成报告。',
          },
        });

        for await (const chunk of taskObservation.observeProvider(llmStream([
          { role: 'system', content: SYSTEM_PROMPTS.reportGeneration },
          { role: 'user', content: prompt },
        ], {
          model: modelName,
          temperature: 0.35,
          maxTokens: 3200,
          signal,
        }, undefined, runtimeConfig))) {
          answerText += chunk;
          emit({ content: chunk });
        }

        emit({
          progress: {
            stage: 'auditing',
            progress: 90,
            message: '正文已生成，正在检查章节与引用覆盖。',
          },
        });
        let citationAudit = auditCitationMarkers(answerText, grounded.citations);
        let sectionCoverage = auditCitationSectionCoverage(answerText, [...DEEP_RESEARCH_REQUIRED_SECTIONS]);
        let removedUncitedClaims = 0;
        let repairAttempted = false;
        if (sectionCoverage.status === 'missing-claim-citations') {
          const sanitized = removeUncitedDeepResearchClaims(answerText, sectionCoverage);
          if (sanitized.removedCount > 0) {
            answerText = sanitized.answer;
            removedUncitedClaims = sanitized.removedCount;
            citationAudit = auditCitationMarkers(answerText, grounded.citations);
            sectionCoverage = auditCitationSectionCoverage(answerText, [...DEEP_RESEARCH_REQUIRED_SECTIONS]);
            emit({ replaceContent: answerText });
          }
        }
        let answerStatus = classifyDeepResearchAnswer({
          citationCount: grounded.citations.length,
          citationAuditStatus: citationAudit.status,
          sectionCoverageStatus: sectionCoverage.status,
        });
        if (answerStatus !== 'complete') {
          repairAttempted = true;
          emit({
            progress: {
              stage: 'repairing',
              progress: 94,
              message: '引用覆盖未通过，正在基于原始证据进行一次保守重写。',
            },
          });
          let repairedAnswer = '';
          const repairPrompt = buildDeepResearchRepairPrompt({
            question,
            evidenceContext: grounded.promptContext,
            sourceCount: papers.length,
          });
          for await (const chunk of taskObservation.observeProvider(llmStream([
            { role: 'system', content: SYSTEM_PROMPTS.reportGeneration },
            { role: 'user', content: repairPrompt },
          ], {
            model: modelName,
            temperature: 0.1,
            maxTokens: 2400,
            signal,
          }, undefined, runtimeConfig))) {
            repairedAnswer += chunk;
          }
          citationAudit = auditCitationMarkers(repairedAnswer, grounded.citations);
          sectionCoverage = auditCitationSectionCoverage(repairedAnswer, [...DEEP_RESEARCH_REQUIRED_SECTIONS]);
          if (sectionCoverage.status === 'missing-claim-citations') {
            const sanitizedRepair = removeUncitedDeepResearchClaims(repairedAnswer, sectionCoverage);
            repairedAnswer = sanitizedRepair.answer;
            removedUncitedClaims += sanitizedRepair.removedCount;
            citationAudit = auditCitationMarkers(repairedAnswer, grounded.citations);
            sectionCoverage = auditCitationSectionCoverage(repairedAnswer, [...DEEP_RESEARCH_REQUIRED_SECTIONS]);
          }
          answerText = repairedAnswer;
          answerStatus = classifyDeepResearchAnswer({
            citationCount: grounded.citations.length,
            citationAuditStatus: citationAudit.status,
            sectionCoverageStatus: sectionCoverage.status,
          });
          emit({ replaceContent: answerText });
        }

        const billing = await reservationFinalizer.settle(answerText);
        emit({
          citationAudit,
          researchStatus: {
            answerStatus,
            sectionCoverage,
            removedUncitedClaims,
            repairAttempted,
            retrievalLimits: [
              '报告仅基于当前选定来源及其可检索片段。',
              '引用线索未替代全文核验。',
            ],
          },
          billing,
        });
        taskObservation.succeeded();
        emit('[DONE]');
    },
    async onError(error, { emit, signal }) {
        await reservationFinalizer.finalizeFailure(answerText);
        const aborted = signal.aborted;
        if (aborted) taskObservation.cancelled('deep_research_interrupted');
        else taskObservation.failed('deep_research_failed', error);
        emit({
          error: aborted
            ? '深度研究已停止或超过等待时间；已返回的证据和正文片段仍可保留核验。'
            : error instanceof Error ? error.message : '深度研究生成失败。',
          errorType: aborted ? 'deep_research_interrupted' : 'deep_research_failed',
          researchStatus: {
            answerStatus: answerText ? 'incomplete' : 'no-evidence',
            retrievalLimits: ['生成未完整结束，不能作为完整研究报告。'],
          },
        });
    },
  });
}
