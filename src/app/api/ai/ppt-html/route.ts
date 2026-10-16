import { parseDeckOutline } from '@/lib/ppt/deck-json';
import { deckEvidence, cancelDeckRequest, prepareDeckGeneration, ownedDeckSources, finishDeckGeneration, deckRequestFailure, type DeckPersistenceInput } from '@/lib/ppt/deck-generation-storage';
import type { HtmlDeckDocument } from '@/lib/ppt/deck-document';
import { NextRequest, NextResponse } from 'next/server';
import { llmInvoke } from '@/lib/ai-service';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { RagSourceInput } from '@/lib/rag';
import type { RuntimeAIConfig } from '@/types';
import { getHtmlDeckStyle } from '@/lib/ppt/html-deck-style';
import {
  generateDeckNarrations,
  generateSlideHtml,
  langInstruction,
  type DeckOutlinePage,
} from '@/lib/ppt/html-deck-generation';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  resolveStudioGenerationReadiness,
  studioGenerationUnavailablePayload,
} from '@/lib/studio-generation-readiness';

export const maxDuration = 600;

// ============================================================
// HTML-native deck generation (huashu-design route)
// Pipeline: grounded retrieval -> outline -> per-slide HTML (parallel)
//           -> speaker narrations
// Slides are self-contained 1280x720 HTML documents rendered in
// sandboxed iframes on the client and reconstructed into editable
// PPTX by walking the live DOM (see lib/ppt/html-deck-export.ts).
// ============================================================

interface HtmlPptRequest extends DeckPersistenceInput {
  papers: RagSourceInput[];
  styleId?: string;
  pageCount?: number;
  language?: 'zh' | 'en';
  aiConfig?: Partial<RuntimeAIConfig>;
  notebookId?: string;
}

const LLM_TIMEOUT_MS = Number(process.env.PPT_LLM_TIMEOUT_MS || 240_000);
const SLIDE_CONCURRENCY = Math.max(1, Number(process.env.PPT_HTML_CONCURRENCY || 4));

async function genOutline(
  ideaPrompt: string,
  pageCount: number,
  language: string,
  styleLabel: string,
  runtimeConfig?: Partial<RuntimeAIConfig>,
  signal?: AbortSignal,
): Promise<DeckOutlinePage[]> {
  const prompt = `你是一位顶级演示文稿策划。基于给定资料,为一份「${styleLabel}」风格的演示文稿规划大纲。

输出一个 JSON 对象 {"pages":[...]},其中 pages 数组恰好 ${pageCount} 个元素,每个元素:
{"title": "该页标题(有观点的完整短句优先)", "points": ["该页要呈现的要点/数据,2-4条,必须来自资料"], "layoutHint": "该页版式提示,从这些里选一个: cover | section | keynumber | comparison | grid | chart | quote | closing"}

规划规则:
- 第 1 页 layoutHint 必须是 cover,只含资料标题、文献作者和发表年份（原文明示时）。未提供的字段不填，不把文献作者当成汇报人或制作人，不把发表年份当数据采集年份。
- 最后一页呈现资料支持的结论或使用边界，不加通用致谢、口号或无依据的展望。
- 中间页面版式要有节奏变化,不要连续三页相同 layoutHint。
- 数据密集的要点标 keynumber 或 chart;对立观点标 comparison;多要点并列标 grid。
- 要点里的数字、结论必须能在资料中找到依据,禁止编造。
${langInstruction(language)}

资料:
${ideaPrompt}

只输出上述 JSON 对象,不要其他文字。`;

  const result = await llmInvoke(
    [{ role: 'user', content: prompt }],
    {
      model: runtimeConfig?.model,
      temperature: 0.4,
      maxTokens: Math.min(6000, Math.max(Number(process.env.PPT_OUTLINE_MAX_TOKENS || 0), 1600 + pageCount * 200)),
      jsonMode: true,
      thinking: 'disabled',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(LLM_TIMEOUT_MS)]),
    },
    undefined,
    runtimeConfig,
  );

  return parseDeckOutline(result, pageCount);
}

async function genSlidesParallel(
  pages: DeckOutlinePage[],
  deckTitle: string,
  styleContract: string,
  evidence: string,
  language: string,
  runtimeConfig: Partial<RuntimeAIConfig> | undefined,
  onProgress: (completed: number, total: number) => void,
  signal: AbortSignal,
): Promise<Array<{ html: string | null; error?: string }>> {
  const results: Array<{ html: string | null; error?: string }> = pages.map(() => ({ html: null }));
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < pages.length) {
      signal.throwIfAborted();
      const i = cursor++;
      try {
        results[i] = {
          html: await generateSlideHtml({
            page: pages[i], index: i, total: pages.length,
            deckTitle, styleContract, evidence, language, runtimeConfig, signal,
          }),
        };
      } catch (err) {
        results[i] = { html: null, error: err instanceof Error ? err.message : String(err) };
      }
      completed++;
      onProgress(completed, pages.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(SLIDE_CONCURRENCY, pages.length) }, () => worker()));
  return results;
}

export async function POST(request: NextRequest) {
  try { return await generate(request); } catch (error) { return deckRequestFailure(error); }
}

async function generate(request: NextRequest) {
  const body: HtmlPptRequest = await request.json();
  const { styleId, pageCount = 10, language = 'zh', aiConfig } = body;
  let papers = body.papers;
  const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);

  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号,再生成演示文稿。',
    requireAuthenticatedPaperHost: true,
  });
  if (!scope.ok) return scope.response;

  if (!papers || papers.length === 0) {
    return NextResponse.json({ error: '请先选择要生成简报的资料' }, { status: 400 });
  }

  const readiness = resolveStudioGenerationReadiness().htmlPpt;
  if (!readiness.ready) {
    return NextResponse.json(studioGenerationUnavailablePayload(readiness), { status: 503 });
  }

  const style = getHtmlDeckStyle(styleId);
  const boundedPageCount = Math.min(20, Math.max(3, pageCount));

  const persistence = await prepareDeckGeneration(body, 'html-deck', scope);
  if (persistence?.previous) {
    return new Response(`data: ${JSON.stringify({ stage: 'done', status: 'done', ...persistence.previous.data.deck, document: persistence.previous })}\n\n`, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store' } });
  }
  try {
  if (persistence) papers = await ownedDeckSources(papers, persistence.scope);
  const fullEvidence = persistence ? deckEvidence(papers) : '';
  const grounded = await buildGroundedRetrievalContext(
    '生成演示文稿大纲、每页核心论点、关键数据、图表线索和可引用结论',
    papers,
    runtimeConfig,
    { topK: 12, ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId },
  );

  const paperSummaries = papers.map(p => {
    const authors = Array.isArray(p.authors) ? p.authors.join(', ') : '';
    return `标题:${p.title || p.fileName || p.id || '未命名资料'}${authors ? `\n作者:${authors}` : ''}${p.year ? `\n年份:${p.year}` : ''}`;
  }).join('\n---\n');

  const ideaPrompt = fullEvidence || (grounded.promptContext
    ? `${paperSummaries}\n\n【检索证据】\n${grounded.promptContext}`
    : papers.map(p => {
      const parts = [`标题:${p.title}`];
      if (p.abstract) parts.push(`摘要:${p.abstract}`);
      if (p.rawContent) parts.push(`内容:${p.rawContent.slice(0, 6000)}`);
      else if (p.content) parts.push(`内容:${p.content.slice(0, 6000)}`);
      return parts.join('\n');
    }).join('\n\n---\n\n'));

  const deckTitle = papers[0]?.title || papers[0]?.fileName || '资料简报';

  console.log(`[PPT-HTML] ▶ 开始生成 | 风格:${style.id} | 页数:${boundedPageCount} | 语言:${language}`);

  const cancellation = new AbortController();
  const generationSignal = AbortSignal.any([request.signal, cancellation.signal, ...(persistence?.signal ? [persistence.signal] : [])]);
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: object) => {
        if (closed || generationSignal.aborted) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        sendEvent({
          stage: 'evidence',
          status: 'done',
          message: '已准备可追溯证据链',
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
        });

        sendEvent({ stage: 'outline', status: 'generating', message: '正在规划简报大纲...' });
        const pages = await genOutline(ideaPrompt, boundedPageCount, language, style.label, runtimeConfig, generationSignal);
        if (pages.length !== boundedPageCount) throw new Error(`大纲页数不完整（${pages.length}/${boundedPageCount}），本次未保存。`);
        sendEvent({
          stage: 'outline',
          status: 'done',
          message: `大纲完成,共 ${pages.length} 页`,
          outline: pages.map(p => ({ title: p.title, layoutHint: p.layoutHint })),
        });

        sendEvent({ stage: 'html', status: 'generating', message: '正在并行排版每页幻灯片...', slideTotal: pages.length });
        const results = await genSlidesParallel(
          pages, deckTitle, style.contract, ideaPrompt, language, runtimeConfig,
          (completed, total) => {
            sendEvent({ stage: 'html', status: 'progress', message: `页面排版中... ${completed}/${total}`, slideCompleted: completed, slideTotal: total });
          }, generationSignal,
        );

        const failures = results.filter(r => !r.html).length;
        if (failures > 0) {
          const firstError = results.find(r => r.error)?.error;
          throw new Error(`${failures}/${results.length} 页生成失败。${firstError ? `首个错误:${firstError}` : ''}`);
        }
        sendEvent({ stage: 'html', status: 'done', message: `全部 ${results.length} 页排版完成` });

        sendEvent({ stage: 'narration', status: 'generating', message: '正在生成每页演讲稿...' });
        const narrations = await generateDeckNarrations(pages, deckTitle, language, runtimeConfig, generationSignal);
        sendEvent({ stage: 'narration', status: 'done', message: '演讲稿生成完成' });

        const slides = pages.map((page, i) => ({
          title: page.title,
          layoutHint: page.layoutHint || 'grid',
          html: results[i].html as string,
          narration: narrations[i] || '',
          outline: { title: page.title, points: page.points || [], layoutHint: page.layoutHint, part: page.part },
        }));

        const deckData: HtmlDeckDocument = { runId: body.runId || null, deck: { deckTitle, slides, activeIndex: 0, styleId: style.id, language, citations: grounded.citations, retrieval: toRetrievalMetadata(grounded) } };
        const saved = await finishDeckGeneration(body, 'html-deck', persistence?.scope, deckData, generationSignal);
        sendEvent({
          stage: 'done',
          status: 'done',
          message: 'HTML 简报生成完成!',
          ...saved,
          deckTitle,
          styleId: style.id,
          slides,
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
        });
        if (!closed) { closed = true; controller.close(); }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'HTML 简报生成失败';
        if (generationSignal.aborted) return;
        console.error('[PPT-HTML] Generation error:', message);
        sendEvent({ stage: 'error', status: 'error', message });
        if (!closed) { closed = true; controller.close(); }
      }
      finally { persistence?.release(); if (!closed) { closed = true; controller.close(); } }
    },
    cancel() { closed = true; cancellation.abort(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store',
      'Connection': 'keep-alive',
    },
  });
  } catch (error) { persistence?.release(); throw error; }
}

export async function DELETE(request: NextRequest) { return cancelDeckRequest(request, 'html-deck'); }
