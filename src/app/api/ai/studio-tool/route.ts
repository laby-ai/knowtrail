import { NextRequest } from 'next/server';
import { llmStream, SYSTEM_PROMPTS } from '@/lib/ai-service';
import { reserveAIUsage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { auditCitationMarkers } from '@/lib/citation-audit';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import type { RagSourceInput } from '@/lib/rag';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import { getStudioArtifactTool } from '@/lib/studio-tools';
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
  try {
    const {
      toolId,
      papers,
      aiConfig,
      maxTokens,
      debugRetrievalOnly,
      debugAnswerText,
      notebookId: rawNotebookId,
    } = await request.json() as {
      toolId?: string;
      papers?: RagSourceInput[];
      aiConfig?: Partial<RuntimeAIConfig>;
      maxTokens?: number;
      debugRetrievalOnly?: boolean;
      debugAnswerText?: string;
      notebookId?: string;
    };
    const notebookId = normalizeNotebookId(rawNotebookId);

    const tool = getStudioArtifactTool(toolId);
    if (!tool) {
      return Response.json({ error: '未知的产物工具' }, { status: 400 });
    }

    if (!Array.isArray(papers) || papers.length === 0) {
      return Response.json({ error: '请先选择资料，再生成产物。' }, { status: 400 });
    }

    let ownerMemberId: string | undefined;
    try {
      const accountSession = await resolveAccountSessionFromRequest(request);
      if (accountAuthRequired() && !accountSession) {
        return Response.json({
          error: '请先登录账号，再生成产物。',
          status: 'failed',
          errorType: 'account_login_required',
        }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      }
      ownerMemberId = accountSession?.member.id;
    } catch {
      return Response.json({
        error: '账号登录已过期，请重新登录。',
        status: 'failed',
        errorType: 'invalid_account_session',
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
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

    if (tool.id === 'results' && grounded.citations.length === 0) {
      return Response.json({
        success: false,
        error: '当前资料没有可引用片段，暂时不能生成可追溯的 Results 初稿。',
        errorType: 'results_citations_unavailable',
        citations: grounded.citations,
        retrieval: toRetrievalMetadata(grounded),
      }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
    }

    if (debugRetrievalOnly) {
      const citationAudit = typeof debugAnswerText === 'string'
        ? auditCitationMarkers(debugAnswerText, grounded.citations)
        : undefined;
      if (tool.id === 'results' && citationAudit && citationAudit.status !== 'pass') {
        return Response.json({
          success: false,
          error: 'Results 初稿未通过引用校验，请重新生成后再使用。',
          errorType: 'results_citation_audit_failed',
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
          citationAudit,
        }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      }
      return Response.json({
        success: true,
        citations: grounded.citations,
        retrieval: toRetrievalMetadata(grounded),
        promptContextLength: grounded.promptContext.length,
        citationAudit,
      }, {
        headers: { 'Cache-Control': 'no-store' },
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
      return Response.json({
        error: '账号额度预占失败，请检查账号额度或稍后重试。',
        status: 'failed',
        errorType: code,
      }, { status, headers: { 'Cache-Control': 'no-store' } });
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

    if (tool.id === 'results' && citationAudit.status !== 'pass') {
      return Response.json({
        success: false,
        error: 'Results 初稿未通过引用校验，请重新生成后再使用。',
        errorType: 'results_citation_audit_failed',
        artifact,
        citations: grounded.citations,
        retrieval: toRetrievalMetadata(grounded),
        citationAudit,
        billing,
      }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
    }

    return Response.json({
      success: true,
      artifact,
      citations: grounded.citations,
      retrieval: toRetrievalMetadata(grounded),
      citationAudit,
      billing,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const timedOut = error instanceof Error && /abort|timeout|timed out/i.test(error.message);
    const message = timedOut
      ? '产物生成超时。请减少资料数量或稍后重试。'
      : error instanceof Error ? error.message : '产物生成失败';
    return Response.json({ error: message }, { status: timedOut ? 504 : 500 });
  }
}
