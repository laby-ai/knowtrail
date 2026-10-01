import { NextRequest } from 'next/server';
import { llmStream } from '@/lib/ai-service';
import { accountUsageErrorMessage, reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  buildExperimentDesignPrompt,
  buildPreregistrationMarkdown,
  classifyExperimentDesign,
  hasSubstantiveExperimentEvidence,
  parseExperimentDesignOutput,
} from '@/lib/experiment-design-contract';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { createGroundedSseResponse, createUsageReservationFinalizer } from '@/lib/grounded-task-lifecycle';
import { createGroundedTaskObservation } from '@/lib/operational-observability';
import type { RagSourceInput } from '@/lib/rag';
import { resolveRequestRuntimeAIConfigResult } from '@/lib/bailian-provider-profile';
import type { RuntimeAIConfig } from '@/types';

type ExperimentDesignRequest = {
  question?: string;
  hypothesis?: string;
  experimentalUnit?: string;
  arms?: string[];
  primaryOutcome?: string;
  constraints?: string;
  alpha?: number;
  targetPower?: number;
  papers?: RagSourceInput[];
  notebookId?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
};

const EXPERIMENT_DESIGN_SYSTEM_PROMPT = `你是一位严谨的采集前实验设计助手。
只根据用户提供的证据片段输出严格 JSON，不输出 Markdown 或额外说明。
协议必须明确独立实验单位、处理与对照、主要结局、随机化、区组/盲法、混杂控制、样本量依据、分析计划、停止规则和伦理待办。
不得猜测样本量 N，不得声称伦理已审批、实验已执行、统计显著或因果已证实。`;

function jsonError(error: string, errorType: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ success: false, error, errorType, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function cleanArms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function POST(request: NextRequest) {
  let input: ExperimentDesignRequest;
  try {
    input = await request.json() as ExperimentDesignRequest;
  } catch {
    return jsonError('实验设计请求格式无效。', 'experiment_design_invalid_request', 400);
  }

  const question = input.question?.trim() || '';
  const hypothesis = input.hypothesis?.trim() || '';
  const experimentalUnit = input.experimentalUnit?.trim() || '';
  const arms = cleanArms(input.arms);
  const primaryOutcome = input.primaryOutcome?.trim() || '';
  const constraints = input.constraints?.trim() || '';
  const papers = Array.isArray(input.papers) ? input.papers : [];
  const alpha = typeof input.alpha === 'number' ? input.alpha : 0.05;
  const targetPower = typeof input.targetPower === 'number' ? input.targetPower : 0.8;

  if (!question) return jsonError('请先填写研究问题。', 'experiment_design_question_required', 400);
  if (!hypothesis) return jsonError('请先填写待验证假设。', 'experiment_design_hypothesis_required', 400);
  if (!experimentalUnit) return jsonError('请明确真正独立的实验单位。', 'experiment_design_unit_required', 400);
  if (arms.length < 2) return jsonError('请至少填写一个处理组和一个对照组。', 'experiment_design_arms_required', 400);
  if (!primaryOutcome) return jsonError('请定义唯一主要结局。', 'experiment_design_outcome_required', 400);
  if (!(alpha > 0 && alpha < 1) || !(targetPower > 0 && targetPower < 1)) {
    return jsonError('alpha 和目标 power 必须在 0 与 1 之间。', 'experiment_design_power_parameters_invalid', 400);
  }
  if (papers.length === 0) {
    return jsonError('请先在左侧文献本选择至少一个证据来源。', 'experiment_design_sources_required', 400);
  }

  const scope = await resolveAccountNotebookScope(request, {
    notebookId: input.notebookId,
    loginMessage: '请先登录账号，再生成实验设计协议。',
  });
  if (!scope.ok) return scope.response;

  const runtimeConfigResult = await resolveRequestRuntimeAIConfigResult(request, input.aiConfig);
  if (runtimeConfigResult instanceof Response) return runtimeConfigResult;
  const runtimeConfig = runtimeConfigResult;
  const retrievalQuery = `研究问题：${question}\n待验证假设：${hypothesis}\n请检索与实验单位、处理/对照、主要结局、偏倚、混杂和可行性相关的证据。`;
  const grounded = await buildGroundedRetrievalContext(retrievalQuery, papers, runtimeConfig, {
    topK: 12,
    ownerMemberId: scope.ownerMemberId,
    notebookId: scope.notebookId,
  });
  const retrieval = toRetrievalMetadata(grounded);
  if (!hasSubstantiveExperimentEvidence(grounded.citations)) {
    return jsonError(
      '当前选定来源中没有可用证据片段，不能生成实验设计协议。请等待资料解析完成、补充来源或收窄问题。',
      'experiment_design_no_evidence',
      422,
      { designStatus: { answerStatus: 'no-evidence' }, citations: [], retrieval },
    );
  }

  const modelName = runtimeConfig.model?.trim() || 'doubao-seed-2-0-pro-260215';
  const prompt = buildExperimentDesignPrompt({
    question,
    hypothesis,
    experimentalUnit,
    arms,
    primaryOutcome,
    constraints,
    alpha,
    targetPower,
    sourceCount: papers.length,
    evidenceContext: grounded.promptContext,
  });

  let usageReservation = null;
  try {
    usageReservation = await reserveAIUsage({
      route: 'experiment-design',
      modelName,
      inputText: `${question}\n${hypothesis}`,
      promptContext: grounded.promptContext,
      memberId: scope.ownerMemberId,
      idempotencyKey: request.headers.get('idempotency-key') || undefined,
    });
  } catch (billingError) {
    const status = billingError instanceof AccountServiceError ? billingError.status : 402;
    const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
    return jsonError(accountUsageErrorMessage(billingError, '账号积分不足，请先充值，或联系管理员分配积分后再生成实验设计协议。'), code, status);
  }

  const configuredTimeoutMs = Number(process.env.EXPERIMENT_DESIGN_LLM_TIMEOUT_MS || 120_000);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(30_000, configuredTimeoutMs) : 120_000;
  const taskObservation = createGroundedTaskObservation({
    requestId: request.headers.get('x-request-id'),
    tenantId: scope.tenantId,
    memberId: scope.ownerMemberId,
    taskType: 'experiment-design',
  });
  const reservationFinalizer = createUsageReservationFinalizer(usageReservation);
  let rawOutput = '';

  return createGroundedSseResponse({
    requestSignal: request.signal,
    timeoutMs,
    timeoutReason: 'experiment design timed out',
    cancelReason: 'experiment design client cancelled',
    async run({ emit, signal }) {
        taskObservation.running();
        emit({
          progress: {
            stage: 'evidence-ready',
            progress: 30,
            message: `已从选定来源匹配 ${grounded.citations.length} 条证据，正在核对实验单位、结局和偏倚来源。`,
          },
          citations: grounded.citations,
          retrieval,
          billing: usageReservation ? { status: 'reserved', estimatedUnits: usageReservation.estimatedUnits } : undefined,
        });
        emit({
          progress: {
            stage: 'designing',
            progress: 56,
            message: '正在组织处理与对照、随机化、区组、盲法和采集前分析计划。',
          },
        });

        for await (const chunk of taskObservation.observeProvider(llmStream([
          { role: 'system', content: EXPERIMENT_DESIGN_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ], {
          model: modelName,
          temperature: 0.25,
          maxTokens: 4600,
          signal,
        }, undefined, runtimeConfig))) {
          rawOutput += chunk;
        }

        emit({
          progress: {
            stage: 'auditing',
            progress: 90,
            message: '协议已生成，正在检查独立重复、证据编号、样本量边界和预注册字段。',
          },
        });

        const billing = await reservationFinalizer.settle(rawOutput);

        let protocol;
        try {
          protocol = parseExperimentDesignOutput(rawOutput);
        } catch (parseError) {
          taskObservation.failed('experiment_design_invalid_output', parseError);
          emit({
            error: parseError instanceof Error ? parseError.message : '模型返回的实验设计结构不完整。',
            errorType: 'experiment_design_invalid_output',
            designStatus: {
              answerStatus: 'incomplete',
              retrievalLimits: ['模型输出未通过协议结构检查，未展示为可用实验设计。'],
            },
            billing,
          });
          emit('[DONE]');
          return;
        }

        const invalidEvidenceMarkers = protocol.evidenceMarkers
          .filter(marker => marker < 1 || marker > grounded.citations.length);
        const answerStatus = classifyExperimentDesign({ protocol, citationCount: grounded.citations.length });
        const artifactMarkdown = buildPreregistrationMarkdown(protocol, { alpha, targetPower });

        emit({
          protocol,
          artifactMarkdown,
          artifactFileName: 'experiment-preregistration.md',
          designStatus: {
            answerStatus,
            invalidEvidenceMarkers,
            retrievalLimits: [
              '协议仅基于当前选定来源及其可检索片段。',
              '未执行功效计算、伦理审批、实验、统计分析或因果验证。',
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
        if (aborted) taskObservation.cancelled('experiment_design_interrupted');
        else taskObservation.failed('experiment_design_failed', error);
        emit({
          error: aborted
            ? '实验设计生成已停止或超过等待时间；未通过完整结构检查的内容不会展示为可用协议。'
            : error instanceof Error ? error.message : '实验设计生成失败。',
          errorType: aborted ? 'experiment_design_interrupted' : 'experiment_design_failed',
          designStatus: {
            answerStatus: 'incomplete',
            retrievalLimits: ['生成未完整结束，不能作为可用实验设计协议。'],
          },
        });
    },
  });
}
