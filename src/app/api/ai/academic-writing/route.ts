import { NextRequest } from 'next/server';
import { llmStream } from '@/lib/ai-service';
import { accountUsageErrorMessage, reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  buildAcademicWritingMarkdown,
  buildAcademicWritingPrompt,
  classifyAcademicWritingDraft,
  hasSubstantiveWritingEvidence,
  parseAcademicWritingOutput,
  type AcademicWritingSection,
} from '@/lib/academic-writing-contract';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { createGroundedSseResponse, createUsageReservationFinalizer } from '@/lib/grounded-task-lifecycle';
import { createGroundedTaskObservation } from '@/lib/operational-observability';
import type { RagSourceInput } from '@/lib/rag';
import { resolveRequestRuntimeAIConfigResult } from '@/lib/bailian-provider-profile';
import type { RuntimeAIConfig } from '@/types';

type AcademicWritingRequest = {
  writingGoal?: string;
  targetSection?: AcademicWritingSection;
  audience?: string;
  requirements?: string;
  papers?: RagSourceInput[];
  notebookId?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
};

const SYSTEM_PROMPT = `你是一位严谨的学术章节写作助手。
只根据用户提供的证据片段输出严格 JSON，不输出 Markdown 或额外说明。
保持事实、术语和数字不变；每个 supported 段落和主张必须带证据编号。
不得编造研究数据、统计结论、引用、作者观点或新发现，不得声称引用已核验、期刊格式已适配或投稿已完成。`;

function jsonError(error: string, errorType: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ success: false, error, errorType, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isTargetSection(value: unknown): value is AcademicWritingSection {
  return value === 'introduction' || value === 'related-work' || value === 'discussion';
}

export async function POST(request: NextRequest) {
  let input: AcademicWritingRequest;
  try {
    input = await request.json() as AcademicWritingRequest;
  } catch {
    return jsonError('学术写作请求格式无效。', 'academic_writing_invalid_request', 400);
  }

  const writingGoal = input.writingGoal?.trim() || '';
  const audience = input.audience?.trim() || '';
  const requirements = input.requirements?.trim() || '';
  const papers = Array.isArray(input.papers) ? input.papers : [];
  if (!writingGoal) return jsonError('请先填写写作目标。', 'academic_writing_goal_required', 400);
  if (!isTargetSection(input.targetSection)) return jsonError('请选择引言、相关工作或讨论。', 'academic_writing_section_invalid', 400);
  if (papers.length === 0) return jsonError('请先在左侧文献本选择至少一个证据来源。', 'academic_writing_sources_required', 400);

  const scope = await resolveAccountNotebookScope(request, {
    notebookId: input.notebookId,
    loginMessage: '请先登录账号，再生成学术写作草稿。',
  });
  if (!scope.ok) return scope.response;

  const runtimeConfigResult = await resolveRequestRuntimeAIConfigResult(request, input.aiConfig);
  if (runtimeConfigResult instanceof Response) return runtimeConfigResult;
  const runtimeConfig = runtimeConfigResult;
  const grounded = await buildGroundedRetrievalContext(
    `写作目标：${writingGoal}\n目标章节：${input.targetSection}\n请匹配定义、关键主张、已有证据、争议和局限。`,
    papers,
    runtimeConfig,
    { topK: 12, ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId },
  );
  const retrieval = toRetrievalMetadata(grounded);
  if (!hasSubstantiveWritingEvidence(grounded.citations)) {
    return jsonError(
      '当前选定来源中没有可用证据片段，不能生成学术写作草稿。请等待解析完成、补充来源或收窄目标。',
      'academic_writing_no_evidence',
      422,
      { writingStatus: { answerStatus: 'no-evidence' }, citations: [], retrieval },
    );
  }

  const modelName = runtimeConfig.model?.trim() || 'doubao-seed-2-0-pro-260215';
  const prompt = buildAcademicWritingPrompt({
    writingGoal,
    targetSection: input.targetSection,
    audience,
    requirements,
    sourceCount: papers.length,
    evidenceContext: grounded.promptContext,
  });

  let reservation = null;
  try {
    reservation = await reserveAIUsage({
      route: 'academic-writing',
      modelName,
      inputText: writingGoal,
      promptContext: grounded.promptContext,
      memberId: scope.ownerMemberId,
      idempotencyKey: request.headers.get('idempotency-key') || undefined,
    });
  } catch (billingError) {
    const status = billingError instanceof AccountServiceError ? billingError.status : 402;
    const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
    return jsonError(accountUsageErrorMessage(billingError, '账号积分不足，请先充值，或联系管理员分配积分后再生成学术写作草稿。'), code, status);
  }

  const configuredTimeoutMs = Number(process.env.ACADEMIC_WRITING_LLM_TIMEOUT_MS || 120_000);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(30_000, configuredTimeoutMs) : 120_000;
  const taskObservation = createGroundedTaskObservation({
    requestId: request.headers.get('x-request-id'),
    tenantId: scope.tenantId,
    memberId: scope.ownerMemberId,
    taskType: 'academic-writing',
  });
  const reservationFinalizer = createUsageReservationFinalizer(reservation);
  let rawOutput = '';

  return createGroundedSseResponse({
    requestSignal: request.signal,
    timeoutMs,
    timeoutReason: 'academic writing timed out',
    cancelReason: 'academic writing client cancelled',
    async run({ emit, signal }) {
        taskObservation.running();
        emit({
          progress: { stage: 'evidence-ready', progress: 30, message: `已匹配 ${grounded.citations.length} 条证据，正在建立章节大纲与主张边界。` },
          citations: grounded.citations,
          retrieval,
          billing: reservation ? { status: 'reserved', estimatedUnits: reservation.estimatedUnits } : undefined,
        });
        emit({ progress: { stage: 'drafting', progress: 58, message: '正在按段落角色组织草稿和 Claim-Evidence 映射。' } });

        for await (const chunk of taskObservation.observeProvider(llmStream([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ], {
          model: modelName,
          temperature: 0.25,
          maxTokens: 4600,
          signal,
        }, undefined, runtimeConfig))) rawOutput += chunk;

        emit({ progress: { stage: 'auditing', progress: 90, message: '正在检查段落证据、未支持主张和引用边界。' } });
        const billing = await reservationFinalizer.settle(rawOutput);

        let draft;
        try {
          draft = parseAcademicWritingOutput(rawOutput);
        } catch (parseError) {
          taskObservation.failed('academic_writing_invalid_output', parseError);
          emit({
            error: parseError instanceof Error ? parseError.message : '模型返回的学术写作结构不完整。',
            errorType: 'academic_writing_invalid_output',
            writingStatus: { answerStatus: 'incomplete', retrievalLimits: ['模型输出未通过段落与证据结构检查，未展示为可用草稿。'] },
            billing,
          });
          emit('[DONE]');
          return;
        }

        const usedMarkers = [
          ...draft.paragraphs.flatMap(item => item.evidenceMarkers),
          ...draft.claimEvidenceMap.flatMap(item => item.evidenceMarkers),
        ];
        const invalidEvidenceMarkers = [...new Set(usedMarkers.filter(marker => marker < 1 || marker > grounded.citations.length))];
        const answerStatus = classifyAcademicWritingDraft({ draft, citationCount: grounded.citations.length });
        emit({
          draft,
          artifactMarkdown: buildAcademicWritingMarkdown(draft),
          artifactFileName: 'academic-section-draft.md',
          writingStatus: {
            answerStatus,
            invalidEvidenceMarkers,
            retrievalLimits: [
              '草稿仅基于当前选定来源及可检索片段。',
              '候选引用、事实与数字仍需回到原文核验；未完成期刊格式、Word/LaTeX 或投稿。',
            ],
          },
          billing,
        });
        taskObservation.succeeded();
        emit('[DONE]');
    },
    async onError(error, { emit, signal }) {
        await reservationFinalizer.finalizeFailure(rawOutput);
        const aborted = signal.aborted;
        if (aborted) taskObservation.cancelled('academic_writing_interrupted');
        else taskObservation.failed('academic_writing_failed', error);
        emit({
          error: aborted ? '学术写作已停止或超过等待时间；未通过完整检查的内容不会展示为可用草稿。' : error instanceof Error ? error.message : '学术写作生成失败。',
          errorType: aborted ? 'academic_writing_interrupted' : 'academic_writing_failed',
          writingStatus: { answerStatus: 'incomplete', retrievalLimits: ['生成未完整结束，不能作为可用学术草稿。'] },
        });
    },
  });
}
