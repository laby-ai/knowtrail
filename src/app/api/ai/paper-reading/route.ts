import { NextRequest } from 'next/server';
import { accountUsageErrorMessage, reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { llmStream } from '@/lib/ai-service';
import { auditCitationMarkers } from '@/lib/citation-audit';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { createGroundedSseResponse, createUsageReservationFinalizer } from '@/lib/grounded-task-lifecycle';
import { createGroundedTaskObservation } from '@/lib/operational-observability';
import {
  buildPaperReadingMarkdown,
  buildPaperReadingPrompt,
  classifyPaperReadingResult,
  parsePaperReadingOutput,
  type PaperReadingMode,
} from '@/lib/paper-reading-contract';
import type { RagSourceInput } from '@/lib/rag';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';

type PaperReadingRequest = {
  mode?: PaperReadingMode;
  sourceLanguage?: string;
  targetLanguage?: string;
  papers?: RagSourceInput[];
  notebookId?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
};

const SYSTEM_PROMPT = `你是一位严谨的论文精读助手。
只根据提供的证据片段输出严格 JSON，不输出 Markdown 或额外说明。
翻译必须忠实保留原意和术语；总结必须区分背景、问题、方法、发现、贡献与局限。
不得编造实验、数据、统计结论、作者观点、引用或未出现的章节。`;

function jsonError(error: string, errorType: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ success: false, error, errorType, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isMode(value: unknown): value is PaperReadingMode {
  return value === 'translation' || value === 'paragraph-summary' || value === 'full-summary';
}

function hasSubstantiveEvidence(citations: Array<{ excerpt?: string; snippet?: string }>) {
  return citations.some(citation => (citation.excerpt || citation.snippet || '').replace(/\s+/g, ' ').trim().length >= 40);
}

export async function POST(request: NextRequest) {
  let input: PaperReadingRequest;
  try {
    input = await request.json() as PaperReadingRequest;
  } catch {
    return jsonError('论文精读请求格式无效。', 'paper_reading_invalid_request', 400);
  }

  const papers = Array.isArray(input.papers) ? input.papers : [];
  if (!isMode(input.mode)) return jsonError('请选择外文翻译、逐段总结或全文结构化总结。', 'paper_reading_mode_invalid', 400);
  if (papers.length === 0) return jsonError('请先在左侧文献本选择至少一个来源。', 'paper_reading_sources_required', 400);
  if (input.mode === 'translation' && papers.length !== 1) {
    return jsonError('外文翻译一次只处理一个来源，请仅选择一篇论文。', 'paper_reading_translation_single_source', 400);
  }

  const scope = await resolveAccountNotebookScope(request, {
    notebookId: input.notebookId,
    loginMessage: '请先登录账号，再使用论文精读。',
  });
  if (!scope.ok) return scope.response;

  const runtimeConfig = resolveServerRuntimeAIConfig(input.aiConfig);
  const sourceTitle = papers.length === 1 ? papers[0].title || papers[0].fileName || '当前论文' : `${papers.length} 个已选来源`;
  const sourceLanguage = input.sourceLanguage?.trim() || '自动识别';
  const targetLanguage = input.targetLanguage?.trim() || '简体中文';
  const taskLabel = input.mode === 'translation'
    ? '忠实翻译选定论文段落并保留术语'
    : input.mode === 'paragraph-summary'
      ? '按章节和段落顺序概括研究内容'
      : '提炼研究背景、问题、方法、发现、贡献与局限';
  const grounded = await buildGroundedRetrievalContext(
    `${taskLabel}。来源：${sourceTitle}`,
    papers,
    runtimeConfig,
    { topK: 16, ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId },
  );
  const retrieval = toRetrievalMetadata(grounded);
  if (!hasSubstantiveEvidence(grounded.citations)) {
    return jsonError(
      '当前来源没有可用的正文证据，不能生成精读结果。请等待解析完成或重新上传文献。',
      'paper_reading_no_evidence',
      422,
      { readingStatus: { answerStatus: 'no-evidence' }, citations: [], retrieval },
    );
  }

  const prompt = buildPaperReadingPrompt({
    mode: input.mode,
    sourceTitle,
    sourceLanguage,
    targetLanguage,
    sourceCount: papers.length,
    evidenceContext: grounded.promptContext,
  });
  const modelName = runtimeConfig.model?.trim() || 'account-managed-text';

  let reservation = null;
  try {
    reservation = await reserveAIUsage({
      route: 'paper-reading',
      modelName,
      inputText: `${input.mode}:${sourceTitle}`,
      promptContext: grounded.promptContext,
      memberId: scope.ownerMemberId,
      idempotencyKey: request.headers.get('idempotency-key') || undefined,
    });
  } catch (billingError) {
    const status = billingError instanceof AccountServiceError ? billingError.status : 402;
    const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
    return jsonError(
      accountUsageErrorMessage(billingError, '账号积分不足，请先充值，或联系管理员分配积分后再使用论文精读。'),
      code,
      status,
    );
  }

  const timeoutValue = Number(process.env.PAPER_READING_LLM_TIMEOUT_MS || 120_000);
  const timeoutMs = Number.isFinite(timeoutValue) ? Math.max(30_000, timeoutValue) : 120_000;
  const taskObservation = createGroundedTaskObservation({
    requestId: request.headers.get('x-request-id'),
    tenantId: scope.tenantId,
    memberId: scope.ownerMemberId,
    taskType: 'paper-reading',
  });
  const reservationFinalizer = createUsageReservationFinalizer(reservation);
  let rawOutput = '';

  return createGroundedSseResponse({
    requestSignal: request.signal,
    timeoutMs,
    timeoutReason: 'paper reading timed out',
    cancelReason: 'paper reading client cancelled',
    async run({ emit, signal }) {
      taskObservation.running();
      emit({
        progress: { stage: 'evidence-ready', progress: 32, message: `已匹配 ${grounded.citations.length} 条正文证据。` },
        citations: grounded.citations,
        retrieval,
        billing: reservation ? { status: 'reserved', estimatedUnits: reservation.estimatedUnits } : undefined,
      });
      emit({ progress: { stage: 'generating', progress: 62, message: '正在生成并校验精读结构。' } });

      for await (const chunk of taskObservation.observeProvider(llmStream([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ], {
        temperature: input.mode === 'translation' ? 0.1 : 0.25,
        maxTokens: 5200,
        signal,
      }, undefined, runtimeConfig))) rawOutput += chunk;

      emit({ progress: { stage: 'auditing', progress: 90, message: '正在检查结构、证据编号和人工核验边界。' } });
      const billing = await reservationFinalizer.settle(rawOutput);
      let result;
      try {
        result = parsePaperReadingOutput(rawOutput);
      } catch (parseError) {
        taskObservation.failed('paper_reading_invalid_output', parseError);
        emit({
          error: parseError instanceof Error ? parseError.message : '模型返回的精读结构不完整。',
          errorType: 'paper_reading_invalid_output',
          readingStatus: { answerStatus: 'incomplete' },
          billing,
        });
        emit('[DONE]');
        return;
      }

      const answerStatus = classifyPaperReadingResult({ result, citationCount: grounded.citations.length });
      const auditText = result.sections.map(section => section.content).join('\n');
      emit({
        result,
        artifactMarkdown: buildPaperReadingMarkdown(result),
        artifactFileName: `paper-reading-${input.mode}.md`,
        citationAudit: auditCitationMarkers(auditText, grounded.citations),
        readingStatus: {
          answerStatus,
          retrievalLimits: [
            '结果仅覆盖当前已选来源及可检索正文片段。',
            '翻译、事实、数字和候选引用仍需回到原文核验。',
          ],
        },
        billing,
      });
      taskObservation.succeeded();
      emit('[DONE]');
    },
    async onError(error, { emit, signal }) {
      await reservationFinalizer.finalizeFailure(rawOutput);
      const interrupted = signal.aborted;
      if (interrupted) taskObservation.cancelled('paper_reading_interrupted');
      else taskObservation.failed('paper_reading_failed', error);
      emit({
        error: interrupted ? '论文精读已停止或超过等待时间，未完成结果不会展示。' : error instanceof Error ? error.message : '论文精读生成失败。',
        errorType: interrupted ? 'paper_reading_interrupted' : 'paper_reading_failed',
        readingStatus: { answerStatus: 'incomplete' },
      });
    },
  });
}
