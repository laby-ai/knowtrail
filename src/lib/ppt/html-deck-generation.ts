// Server-side helpers shared by the HTML deck generation and repair routes.
import { llmInvoke } from '@/lib/ai-service';
import type { RuntimeAIConfig } from '@/types';
import { HTML_SLIDE_HARD_CONTRACT } from '@/lib/ppt/html-deck-style';

export interface DeckOutlinePage {
  title: string;
  points: string[];
  layoutHint?: string;
  part?: string;
}

const LLM_TIMEOUT_MS = Number(process.env.PPT_LLM_TIMEOUT_MS || 240_000);

export function langInstruction(language: string): string {
  return language === 'en'
    ? 'All slide copy must be in English.'
    : '所有幻灯片文案使用中文(专有名词、指标名可保留英文)。';
}

export function extractHtmlDocument(raw: string): string | null {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const docMatch = candidate.match(/<!DOCTYPE html>[\s\S]*<\/html>/i) || candidate.match(/<html[\s\S]*<\/html>/i);
  if (!docMatch) return null;
  const html = docMatch[0];
  // Reject anything that could execute script or reach the network.
  if (/<script\b/i.test(html)) return null;
  if (/\bon[a-z]+\s*=/i.test(html)) return null;
  if (/@import|<link\b|<iframe\b|<object\b|<embed\b/i.test(html)) return null;
  if (/url\(\s*['"]?https?:/i.test(html) || /src\s*=\s*['"]https?:/i.test(html)) return null;
  return html;
}

export interface SlideRevisionContext {
  currentHtml: string;
  problem?: string;      // e.g. auto-detected overflow report
  instruction?: string;  // user's re-layout request
}

export async function generateSlideHtml(opts: {
  page: DeckOutlinePage;
  index: number;
  total: number;
  deckTitle: string;
  styleContract: string;
  evidence: string;
  language: string;
  runtimeConfig?: Partial<RuntimeAIConfig>;
  revision?: SlideRevisionContext;
}): Promise<string> {
  const { page, index, total, deckTitle, styleContract, evidence, language, runtimeConfig, revision } = opts;

  const revisionBlock = revision
    ? `
【这是一次修订任务】下面是该页当前版本的完整 HTML:
\`\`\`html
${revision.currentHtml.slice(0, 12_000)}
\`\`\`
${revision.problem ? `【自动质检发现的问题】${revision.problem}\n必须彻底解决该问题:压缩文字量、缩小字号/间距或简化布局,确保内容完全放进 1280×720。` : ''}
${revision.instruction ? `【用户的修改要求】${revision.instruction}\n在保持原有风格与未提及内容不变的前提下执行修改。` : ''}
基于当前版本重新输出修正后的完整 HTML 文档。`
    : '';

  const prompt = `你是一位世界级演示设计师,用纯 HTML+CSS 制作单页幻灯片。

【整份演示】${deckTitle},共 ${total} 页,当前是第 ${index + 1} 页。
【本页大纲】标题:${page.title}
要点:${(page.points || []).join(' / ')}
版式:${page.layoutHint || 'grid'}
${page.part ? `所属章节:${page.part}` : ''}

【视觉风格合同(必须严格遵守)】
${styleContract}

【硬性技术合同(必须逐条满足)】
${HTML_SLIDE_HARD_CONTRACT}
${evidence ? `
【可用证据(文案与数字只能来自这里)】
${evidence.slice(0, 6000)}` : ''}
${revisionBlock}
${langInstruction(language)}
直接输出完整 HTML 文档(以 <!DOCTYPE html> 开头,以 </html> 结束),不要输出任何解释。`;

  const attempts = 2;
  let lastRaw = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const raw = await llmInvoke(
      [{ role: 'user', content: prompt }],
      {
        model: runtimeConfig?.model,
        temperature: attempt === 1 ? 0.5 : 0.7,
        maxTokens: Number(process.env.PPT_HTML_SLIDE_MAX_TOKENS || 4000),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      },
      undefined,
      runtimeConfig,
    );
    lastRaw = raw;
    const html = extractHtmlDocument(raw);
    if (html) return html;
  }
  throw new Error(`第 ${index + 1} 页 HTML 生成失败(输出不符合合同):${lastRaw.slice(0, 120)}`);
}

export async function generateDeckNarrations(
  pages: DeckOutlinePage[],
  deckTitle: string,
  language: string,
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<string[]> {
  const outlineText = pages
    .map((p, i) => `${i + 1}. ${p.title}: ${(p.points || []).join(' / ')}`)
    .join('\n');
  const prompt = `为演示文稿《${deckTitle}》的每一页写口语化演讲稿。

大纲:
${outlineText}

要求:
- 输出 JSON 数组,恰好 ${pages.length} 个字符串,第 i 个是第 i 页的演讲稿。
- 每页 80-150 字,口语自然,承上启下,直接可念。
- 不要重复页面上已有的文字罗列,而是讲解、串联和强调。
${langInstruction(language)}
只输出 JSON 数组。`;

  try {
    const raw = await llmInvoke(
      [{ role: 'user', content: prompt }],
      {
        model: runtimeConfig?.model,
        temperature: 0.6,
        maxTokens: Number(process.env.PPT_NARRATION_MAX_TOKENS || 4000),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      },
      undefined,
      runtimeConfig,
    );
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return pages.map(() => '');
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    return pages.map((_, i) => (typeof parsed[i] === 'string' ? (parsed[i] as string) : ''));
  } catch (err) {
    console.warn('[PPT-HTML] narration generation failed:', err instanceof Error ? err.message : err);
    return pages.map(() => '');
  }
}
