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

interface HtmlPptRequest {
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
): Promise<DeckOutlinePage[]> {
  const prompt = `你是一位顶级演示文稿策划。基于给定资料,为一份「${styleLabel}」风格的演示文稿规划大纲。

输出 JSON 数组,恰好 ${pageCount} 个元素,每个元素:
{"title": "该页标题(有观点的完整短句优先)", "points": ["该页要呈现的要点/数据,2-4条,必须来自资料"], "layoutHint": "该页版式提示,从这些里选一个: cover | section | keynumber | comparison | grid | chart | quote | closing"}

规划规则:
- 第 1 页 layoutHint 必须是 cover,只含主标题、副标题、汇报人位。
- 最后一页 layoutHint 是 closing(结论/致谢)。
- 中间页面版式要有节奏变化,不要连续三页相同 layoutHint。
- 数据密集的要点标 keynumber 或 chart;对立观点标 comparison;多要点并列标 grid。
- 要点里的数字、结论必须能在资料中找到依据,禁止编造。
${langInstruction(language)}

资料:
${ideaPrompt}

只输出 JSON 数组,不要其他文字。`;

  const result = await llmInvoke(
    [{ role: 'user', content: prompt }],
    {
      model: runtimeConfig?.model,
      temperature: 0.4,
      maxTokens: Number(process.env.PPT_OUTLINE_MAX_TOKENS || 1600),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    },
    undefined,
    runtimeConfig,
  );

  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('大纲生成失败:无法解析 JSON');
  const pages = JSON.parse(jsonMatch[0]) as DeckOutlinePage[];
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('大纲生成失败:结果为空');
  return pages.slice(0, pageCount);
}

async function genSlidesParallel(
  pages: DeckOutlinePage[],
  deckTitle: string,
  styleContract: string,
  evidence: string,
  language: string,
  runtimeConfig: Partial<RuntimeAIConfig> | undefined,
  onProgress: (completed: number, total: number) => void,
): Promise<Array<{ html: string | null; error?: string }>> {
  const results: Array<{ html: string | null; error?: string }> = pages.map(() => ({ html: null }));
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < pages.length) {
      const i = cursor++;
      try {
        results[i] = {
          html: await generateSlideHtml({
            page: pages[i], index: i, total: pages.length,
            deckTitle, styleContract, evidence, language, runtimeConfig,
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
  const body: HtmlPptRequest = await request.json();
  const { papers, styleId, pageCount = 10, language = 'zh', aiConfig } = body;
  const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);

  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号,再生成演示文稿。',
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

  const ideaPrompt = grounded.promptContext
    ? `${paperSummaries}\n\n【检索证据】\n${grounded.promptContext}`
    : papers.map(p => {
      const parts = [`标题:${p.title}`];
      if (p.abstract) parts.push(`摘要:${p.abstract}`);
      if (p.rawContent) parts.push(`内容:${p.rawContent.slice(0, 6000)}`);
      else if (p.content) parts.push(`内容:${p.content.slice(0, 6000)}`);
      return parts.join('\n');
    }).join('\n\n---\n\n');

  const deckTitle = papers[0]?.title || papers[0]?.fileName || '资料简报';

  console.log(`[PPT-HTML] ▶ 开始生成 | 风格:${style.id} | 页数:${boundedPageCount} | 语言:${language}`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: object) => {
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
        const pages = await genOutline(ideaPrompt, boundedPageCount, language, style.label, runtimeConfig);
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
          },
        );

        const failures = results.filter(r => !r.html).length;
        if (failures > 0) {
          const firstError = results.find(r => r.error)?.error;
          throw new Error(`${failures}/${results.length} 页生成失败。${firstError ? `首个错误:${firstError}` : ''}`);
        }
        sendEvent({ stage: 'html', status: 'done', message: `全部 ${results.length} 页排版完成` });

        sendEvent({ stage: 'narration', status: 'generating', message: '正在生成每页演讲稿...' });
        const narrations = await generateDeckNarrations(pages, deckTitle, language, runtimeConfig);
        sendEvent({ stage: 'narration', status: 'done', message: '演讲稿生成完成' });

        const slides = pages.map((page, i) => ({
          title: page.title,
          layoutHint: page.layoutHint || 'grid',
          html: results[i].html as string,
          narration: narrations[i] || '',
          outline: { title: page.title, points: page.points || [], layoutHint: page.layoutHint, part: page.part },
        }));

        sendEvent({
          stage: 'done',
          status: 'done',
          message: 'HTML 简报生成完成!',
          deckTitle,
          styleId: style.id,
          slides,
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
        });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'HTML 简报生成失败';
        console.error('[PPT-HTML] Generation error:', message);
        sendEvent({ stage: 'error', status: 'error', message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
