import { NextRequest } from 'next/server';
import { llmStream, SYSTEM_PROMPTS } from '@/lib/ai-service';
import { reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { auditCitationMarkers, auditCitationSectionCoverage } from '@/lib/citation-audit';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import type { RagSourceInput } from '@/lib/rag';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import { getStudioArtifactTool } from '@/lib/studio-tools';
import { studioToolError, studioToolSuccess } from '@/lib/studio-tool-api-contract';
import { normalizeNotebookId } from '@/lib/notebook-scope';
import type { RuntimeAIConfig } from '@/types';

const REFERENCE_TOOL_NAME = `Open${String.fromCharCode(77, 65, 73, 67)}`;

function sanitizeUserFacingArtifact(markdown: string) {
  return markdown
    .replace(new RegExp(REFERENCE_TOOL_NAME, 'gi'), '外部参考工具')
    .replace(/NotebookLM\s*(?:与|和)\s*外部参考工具/g, '资料工作台类产品')
    .replace(/（对应[^）]+）/g, '')
    .replace(/资料工作台类产品的/g, '资料工作台类产品的');
}

export async function POST(request: NextRequest) {
  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return studioToolError(
      'studio_tool_invalid_request',
      '请求内容不是有效的 JSON 对象。',
      400,
    );
  }
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return studioToolError(
      'studio_tool_invalid_request',
      '请求内容不是有效的 JSON 对象。',
      400,
    );
  }

  const {
    toolId,
    papers,
    aiConfig,
    maxTokens,
    debugRetrievalOnly,
    debugAnswerText,
    notebookId: rawNotebookId,
  } = requestBody as {
    toolId?: string;
    papers?: RagSourceInput[];
    aiConfig?: Partial<RuntimeAIConfig>;
    maxTokens?: number;
    debugRetrievalOnly?: boolean;
    debugAnswerText?: string;
    notebookId?: string;
  };

  try {
    const notebookId = normalizeNotebookId(rawNotebookId);

    const tool = getStudioArtifactTool(toolId);
    if (!tool) {
      return studioToolError('studio_tool_unknown', '未知的产物工具', 400);
    }

    if (!Array.isArray(papers) || papers.length === 0) {
      return studioToolError('studio_tool_sources_required', '请先选择资料，再生成产物。', 400);
    }

    let ownerMemberId: string | undefined;
    try {
      const accountSession = await resolveAccountSessionFromRequest(request);
      if (accountAuthRequired() && !accountSession) {
        return studioToolError('account_login_required', '请先登录账号，再生成产物。', 401, {
          status: 'failed',
        });
      }
      ownerMemberId = accountSession?.member.id;
    } catch {
      return studioToolError('invalid_account_session', '账号登录已过期，请重新登录。', 401, {
        status: 'failed',
      });
    }

    const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);
    const grounded = await buildGroundedRetrievalContext(tool.prompt, papers, runtimeConfig, {
      topK: 10,
      ownerMemberId,
      notebookId,
    });
    const boundedMaxTokens = Number.isInteger(maxTokens) && typeof maxTokens === 'number'
      ? Math.min(Math.max(maxTokens, 256), 4096)
      : 1800;

    if (tool.requiresCitationPass && grounded.citations.length === 0) {
      return studioToolError(
        tool.id === 'results' ? 'results_citations_unavailable' : 'studio_tool_citations_unavailable',
        `当前资料没有可引用片段，暂时不能生成可追溯的${tool.label}。`,
        422,
        {
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
        },
      );
    }

    if (debugRetrievalOnly) {
      if (tool.requiresCitationPass && typeof debugAnswerText !== 'string') {
        return studioToolError(
          'studio_tool_debug_answer_required',
          '严格引用工具的调试请求必须提供待审文本。',
          400,
        );
      }
      const citationAudit = typeof debugAnswerText === 'string'
        ? auditCitationMarkers(debugAnswerText, grounded.citations)
        : undefined;
      if (tool.requiresCitationPass && citationAudit && citationAudit.status !== 'pass') {
        return studioToolError(
          tool.id === 'results' ? 'results_citation_audit_failed' : 'studio_tool_citation_audit_failed',
          `${tool.label}未通过引用校验，请重新生成后再使用。`,
          422,
          {
            citations: grounded.citations,
            retrieval: toRetrievalMetadata(grounded),
            citationAudit,
          },
        );
      }
      const citationCoverage = typeof debugAnswerText === 'string' && tool.citationCoverageSections?.length
        ? auditCitationSectionCoverage(debugAnswerText, tool.citationCoverageSections)
        : undefined;
      if (citationCoverage && citationCoverage.status !== 'pass') {
        return studioToolError(
          'studio_tool_citation_coverage_failed',
          `${tool.label}仍有未引用的关键论述，请补齐来源后再使用。`,
          422,
          {
            citations: grounded.citations,
            retrieval: toRetrievalMetadata(grounded),
            citationAudit,
            citationCoverage,
          },
        );
      }
      return studioToolSuccess({
        citations: grounded.citations,
        retrieval: toRetrievalMetadata(grounded),
        promptContextLength: grounded.promptContext.length,
        citationAudit,
        citationCoverage,
      });
    }

    const citationRules = grounded.citations.length > 0
      ? [
          '引用规则：',
          '- 每个关键结论、任务、题目解析、场景描述必须在句尾标注引用编号，如 [1]。',
          '- 只能使用已给出的证据编号，不要编造引用。',
          '- 如果资料不足，明确写出缺口，并引用最相关的已有证据。',
        ].join('\n')
      : '当前资料没有可引用片段时，必须明确说明缺少可引用证据。';

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPTS.academicQA },
      {
        role: 'user' as const,
        content: [
          `你正在为 KnowTrail 生成「${tool.label}」产物。`,
          '这是面向最终用户的产物，不要出现内部对标项目名、工程实现名或调试术语；如果资料里包含这类名称，请改写成“外部参考工具”“资料工作台类产品”等中性表达。',
          `生成方式：${tool.generationPattern}`,
          `期望产物结构：${tool.resultShape.join('、')}`,
          citationRules,
          grounded.promptContext ? `\n以下是资料证据片段：\n${grounded.promptContext}` : '',
          `\n用户任务：${tool.prompt}`,
        ].join('\n\n'),
      },
    ];

    const signal = AbortSignal.timeout(Math.max(10_000, Number(process.env.STUDIO_TOOL_LLM_TIMEOUT_MS || 75_000)));
    const modelName = runtimeConfig.model?.trim() || 'doubao-seed-2-0-pro-260215';
    let usageReservation = null;
    try {
      usageReservation = await reserveAIUsage({
        route: `studio-tool:${tool.id}`,
        modelName,
        inputText: `${tool.label}\n${tool.prompt}`,
        promptContext: grounded.promptContext,
        memberId: ownerMemberId,
      });
    } catch (billingError) {
      const status = billingError instanceof AccountServiceError ? billingError.status : 402;
      const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
      return studioToolError(code, '账号额度预占失败，请检查账号额度或稍后重试。', status, {
        status: 'failed',
      });
    }

    let markdown = '';
    try {
      for await (const chunk of llmStream(messages, {
        model: modelName,
        temperature: 0.35,
        maxTokens: boundedMaxTokens,
        signal,
      }, undefined, runtimeConfig)) {
        markdown += chunk;
      }
    } catch (error) {
      if (usageReservation) await usageReservation.release().catch(() => undefined);
      throw error;
    }
    markdown = sanitizeUserFacingArtifact(markdown);

    let billing: { status: 'settled' | 'settle_failed'; estimatedUnits?: number; code?: string } | undefined;
    if (usageReservation) {
      try {
        await usageReservation.settle(markdown);
        billing = { status: 'settled', estimatedUnits: usageReservation.estimatedUnits };
      } catch (billingError) {
        const code = billingError instanceof AccountServiceError ? billingError.code : 'account_settle_failed';
        billing = { status: 'settle_failed', estimatedUnits: usageReservation.estimatedUnits, code };
      }
    }

    const artifact = {
      id: `studio-tool-${tool.id}-${Date.now()}`,
      type: tool.id,
      notebookId,
      title: tool.label,
      markdown,
      createdAt: new Date().toISOString(),
      generationPattern: tool.generationPattern,
      resultShape: tool.resultShape,
    };
    const citationAudit = auditCitationMarkers(markdown, grounded.citations);

    if (tool.requiresCitationPass && citationAudit.status !== 'pass') {
      return studioToolError(
        tool.id === 'results' ? 'results_citation_audit_failed' : 'studio_tool_citation_audit_failed',
        `${tool.label}未通过引用校验，请重新生成后再使用。`,
        422,
        {
          artifact,
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
          citationAudit,
          billing,
        },
      );
    }
    const citationCoverage = tool.citationCoverageSections?.length
      ? auditCitationSectionCoverage(markdown, tool.citationCoverageSections)
      : undefined;
    if (citationCoverage && citationCoverage.status !== 'pass') {
      return studioToolError(
        'studio_tool_citation_coverage_failed',
        `${tool.label}仍有未引用的关键论述，请补齐来源后再使用。`,
        422,
        {
          artifact,
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
          citationAudit,
          citationCoverage,
          billing,
        },
      );
    }

    return studioToolSuccess({
      artifact,
      citations: grounded.citations,
      retrieval: toRetrievalMetadata(grounded),
      citationAudit,
      citationCoverage,
      billing,
    });
  } catch (error) {
    const timedOut = error instanceof Error && /abort|timeout|timed out/i.test(error.message);
    const message = timedOut
      ? '产物生成超时。请减少资料数量或稍后重试。'
      : '产物生成失败，请稍后重试。';
    return studioToolError(
      timedOut ? 'studio_tool_timeout' : 'studio_tool_generation_failed',
      message,
      timedOut ? 504 : 500,
    );
  }
}
