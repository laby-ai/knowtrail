import { NextRequest, NextResponse } from 'next/server';
import { llmInvoke, SYSTEM_PROMPTS } from '@/lib/ai-service';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import type { RagSourceInput } from '@/lib/rag';
import type { RuntimeAIConfig } from '@/types';
import { auditCitationMarkers } from '@/lib/citation-audit';
import { resolveRequestRuntimeAIConfigResult } from '@/lib/bailian-provider-profile';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  resolveStudioGenerationReadiness,
  studioGenerationUnavailablePayload,
} from '@/lib/studio-generation-readiness';

export async function POST(request: NextRequest) {
  try {
    const { papers, outline, customOutline, aiConfig, debugRetrievalOnly, debugAnswerText, notebookId: rawNotebookId } = await request.json() as {
      papers?: string | RagSourceInput[];
      outline?: string;
      customOutline?: string;
      aiConfig?: Partial<RuntimeAIConfig>;
      debugRetrievalOnly?: boolean;
      debugAnswerText?: string;
      notebookId?: string;
    };
    const scope = await resolveAccountNotebookScope(request, {
      notebookId: rawNotebookId,
      loginMessage: '请先登录账号，再生成资料报告。',
    });
    if (!scope.ok) return scope.response;

    const readiness = resolveStudioGenerationReadiness().researchChat;
    if (!debugRetrievalOnly && !readiness.ready) {
      return NextResponse.json(studioGenerationUnavailablePayload(readiness), { status: 503 });
    }

    if (!papers || (Array.isArray(papers) && papers.length === 0) || (typeof papers === 'string' && !papers.trim())) {
      return NextResponse.json({ error: '请先选择至少一篇论文' }, { status: 400 });
    }

    // Handle both string and object array formats
    let paperContext: string;
    let paperCount: number;
    let requestSources: RagSourceInput[];
    if (typeof papers === 'string') {
      paperContext = papers;
      paperCount = papers.split('---').length;
      requestSources = [];
    } else {
      requestSources = papers;
      paperContext = papers
        .map((p: RagSourceInput, i: number) => {
          const shortName = p.shortName || `${p.authors?.[0] || '未知'}. ${p.year || '?'}`;
          const aiSummary = p.content || p.abstract || '无内容';
          const rawText = p.rawContent || '';
          const rawSection = rawText ? `\n原始文档文本：\n${rawText.slice(0, 10000)}` : '';
          return `[文献${i + 1}] ${shortName} - ${p.title || '无标题'}\n关键词: ${p.keywords?.join(', ') || '无'}\n摘要: ${p.abstract || '无'}\n详细内容：${aiSummary}${rawSection}`;
        })
        .join('\n\n---\n\n');
      paperCount = papers.length;
    }

    const reportOutline = customOutline || outline || '研究背景与目的、核心论点对比分析、实验方法汇总、研究成果总结、研究局限与展望';
    const runtimeConfigResult = await resolveRequestRuntimeAIConfigResult(request, aiConfig);
    if (runtimeConfigResult instanceof Response) return runtimeConfigResult;
    const runtimeConfig = runtimeConfigResult;
    const grounded = await buildGroundedRetrievalContext(`围绕以下大纲生成综述报告：${reportOutline}`, requestSources, runtimeConfig, {
      topK: 10,
      ownerMemberId: scope.ownerMemberId,
      notebookId: scope.notebookId,
    });
    const evidenceContext = grounded.promptContext || paperContext;

    if (debugRetrievalOnly) {
      return NextResponse.json({
        success: true,
        citations: grounded.citations,
        retrieval: toRetrievalMetadata(grounded),
        promptContextLength: grounded.promptContext.length,
        citationAudit: typeof debugAnswerText === 'string'
          ? auditCitationMarkers(debugAnswerText, grounded.citations)
          : undefined,
      });
    }

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPTS.reportGeneration },
      { role: 'user' as const, content: `请根据以下${paperCount}篇论文，生成一篇结构化的跨文献总结报告。

报告大纲：${reportOutline}

检索证据：
${evidenceContext}

要求：
1. 每个核心观点必须标注上角标数字脚注，如：内容[1]
2. 文末按脚注顺序生成参考文献列表
3. 每个脚注必须对应上方检索证据中的编号、sourceId 或 chunkId，不要编造来源
4. 使用 Markdown 格式，包含标题层级` },
    ];

    // Stream response as SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let reportText = '';
          if (grounded.citations.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              citations: grounded.citations,
              retrieval: toRetrievalMetadata(grounded),
            })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            progress: {
              stage: 'generating',
              message: '正在基于已检索证据生成报告，长文本生成可能需要几十秒。',
            },
          })}\n\n`));
          reportText = await llmInvoke(messages, {
            model: 'doubao-seed-2-0-pro-260215',
            temperature: 0.5,
            maxTokens: 1800,
          }, undefined, runtimeConfig);
          for (let i = 0; i < reportText.length; i += 240) {
            const chunk = reportText.slice(i, i + 240);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            citationAudit: auditCitationMarkers(reportText, grounded.citations),
          })}\n\n`));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : '报告生成失败';
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
