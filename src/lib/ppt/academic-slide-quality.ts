import { markFallback } from '@/lib/ppt/academic-observability';
import type { EnhancedSlideSpec, PaperInput, SlideSpec } from '@/lib/ppt/academic-types';

type StructureDraftLike = {
  type: SlideSpec['type'];
  title: string;
  figureLabel?: string;
  discourseRef?: string;
};

function normalizePptSourceSentences(papers: PaperInput[]): string[] {
  const text = papers
    .map(p => [p.title, p.abstract, p.rawContent, p.content].filter(Boolean).join('\n'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  return text
    .split(/[。！？!?；;\n]/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 12)
    .slice(0, 24);
}

export function buildContextualFallbackBullets(
  slide: StructureDraftLike,
  papers: PaperInput[],
  defaultBullets: Record<string, string[]>,
): string[] {
  if (slide.type === 'cover') return [];

  const sentences = normalizePptSourceSentences(papers);
  const keywords = [
    slide.title,
    slide.type,
    slide.figureLabel || '',
    ...(defaultBullets[slide.type] || []),
  ]
    .join(' ')
    .split(/[\s、，,：:（）()]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);

  const scored = sentences
    .map(sentence => ({
      sentence,
      score: keywords.reduce((sum, keyword) => sum + (sentence.includes(keyword) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || b.sentence.length - a.sentence.length)
    .map(item => item.sentence);

  const selected = Array.from(new Set(scored.length ? scored : sentences))
    .slice(0, 3)
    .map(sentence => sentence.length > 54 ? `${sentence.slice(0, 52)}...` : sentence);

  if (selected.length >= 3) return selected;
  if (selected.length > 0) {
    return [
      ...selected,
      ...(defaultBullets[slide.type] || []).slice(0, 3 - selected.length),
    ];
  }

  if (slide.type === 'closing') {
    return ['本报告围绕资料源可信、引用可追溯和 Studio 产物闭环完成总结', '后续重点是减少长任务超时并提升真实 PPT 内容密度', '谢谢观看，欢迎基于引用来源继续追问'];
  }

  return defaultBullets[slide.type] || [
    `${slide.title} 需要结合上传资料和检索证据继续展开`,
    '当前页面由后端降级路径生成，仍保留可审计任务状态',
    '建议下一轮针对该页补充更具体的图表、数据或引用片段',
  ];
}

export function ensureSlideContentFromSources(slides: EnhancedSlideSpec[], papers: PaperInput[]): EnhancedSlideSpec[] {
  const defaultBullets: Record<string, string[]> = {
    background: ['资料源可信是资料工作台的基础能力', '中央对话与右侧 Studio 必须复用同一证据上下文', '失败降级和引用状态需要对用户可见'],
    gap: ['传统生成链路容易让不同产物引用不同上下文', '长任务缺少阶段反馈会让用户误以为系统卡死', '工程化交付需要真实模型、存储和健康检查共同闭环'],
    method: ['上传资料后进入持久化 source/chunk 数据结构', '基于 embedding 和 zvec 检索构建 grounded context', '知识卡片、报告、播客和 PPT 复用同一证据上下文'],
    result: ['真实 smoke 覆盖上传、向量检索和 Studio 多产物生成', '播客音频通过豆包语音合成真实生成并落到本地文件', 'PPTX 输出具备可解包的 slide XML 和正文内容'],
    discussion: ['真实服务超时仍需通过阶段提示和质量警告暴露给用户', 'fallback 内容必须来自资料原文而不是空白占位', '后续应继续减少大批量 LLM 调用导致的超时'],
    conclusion: ['资料、问答、Studio 产物和部署验证已经形成可审计链路', 'PPT/播客等长任务仍需持续压缩耗时并提升成稿质量', '下一阶段重点是浏览器端真实点击和文件质量验收'],
    synthesis: ['本页汇总资料源可信、引用可追溯和 Studio 产物复用机制', '生成结果保留后端观测信息，便于定位失败阶段', '面向发布需要继续强化真实服务和部署 smoke'],
  };

  return slides.map(slide => {
    if (slide.type === 'cover' || slide.table || slide.flow) return slide;
    if (slide.type === 'closing') {
      const closingBullets = slide.bullets?.filter(Boolean) || [];
      return {
        ...slide,
        bullets: closingBullets.length > 0 ? closingBullets : ['感谢聆听，敬请指正'],
        note: slide.note || '本报告基于真实资料和可追溯生成链路生成。',
      };
    }

    const bullets = (slide.bullets || []).map(String).filter(item => item.trim().length > 0);
    const contentLength = bullets.join('').length + (slide.note || '').trim().length;
    if (bullets.length >= 2 && contentLength >= 60) return slide;

    const fallback = buildContextualFallbackBullets(slide, papers, defaultBullets);
    const merged = Array.from(new Set([...bullets, ...fallback])).slice(0, 4);
    markFallback('finalSlideContentGuard', `${slide.title} had insufficient content and was hydrated from source evidence`);
    return {
      ...slide,
      bullets: merged,
      note: slide.note || '该页由最终质量闸使用资料上下文补足，避免真实 PPT 出现空白或占位页。',
      layout: slide.layout || 'full_text',
    };
  });
}

// ────────────────────────────────────────────────────────────────
// Post-plan: Merge thin slides (single-sentence or near-empty)
// Based on ArcDeck's design principle: each slide must carry meaningful content
// ────────────────────────────────────────────────────────────────
// ── Merge post-processing config (3 independent toggles) ──
// All disabled by default for debugging. Enable individually after validation.
const MERGE_CONFIG = {
  /** Merge thin slides (low content) into previous slide */
  enableThinMerge: false,
  /** Hard-cap total slides based on duration */
  enableHardCap: false,
  /** Collapse 3+ consecutive same-type slides to 2 */
  enableConsecutiveDedup: false,
};

/**
 * Types that should NEVER be merged even when thin merge is enabled.
 * Rationale: these types carry unique semantic weight in academic reports
 * — a short "gap" slide states the core problem, a short "conclusion" slide
 * delivers the takeaway. Length ≠ importance.
 */
const NEVER_MERGE_TYPES = new Set([
  'cover', 'author', 'closing', 'citation', 'toc',
  'gap', 'conclusion', 'roadmap',
]);

/**
 * Types that MAY be merged when thin, but only if the previous slide
 * is of a compatible (not conflicting) type.
 * e.g. two consecutive "synthesis" slides can merge, but a "gap" should
 * never merge into a "method".
 */
const MERGE_COMPATIBILITY: Record<string, Set<string>> = {
  synthesis: new Set(['synthesis', 'background', 'method', 'result', 'discussion']),
  background: new Set(['background', 'synthesis']),
  discussion: new Set(['discussion', 'synthesis', 'result']),
};

export function mergeThinSlides(slides: EnhancedSlideSpec[], maxSlides?: number): EnhancedSlideSpec[] {
  let result = [...slides];
  const PROTECTED_TYPES = new Set(['cover', 'closing', 'citation', 'author']);
  const FIGURE_TYPES = new Set(['figure_overview', 'figure_detail', 'figure_evidence']);

  // ── Pass 1: Thin slide merge (disabled by default) ──
  if (MERGE_CONFIG.enableThinMerge) {
    const merged: EnhancedSlideSpec[] = [];
    let pending: EnhancedSlideSpec | null = null;
    const flush = () => { if (pending) { merged.push(pending); pending = null; } };

    for (const slide of result) {
      // Never merge protected types
      if (PROTECTED_TYPES.has(slide.type) || NEVER_MERGE_TYPES.has(slide.type)) {
        flush();
        merged.push(slide);
        continue;
      }

      // Figure slides: keep separate, don't merge into non-figure
      if (FIGURE_TYPES.has(slide.type)) {
        flush();
        merged.push(slide);
        continue;
      }

      // ── Smarter thin detection ──
      // Old rule: contentLength < 60 → merge (too aggressive)
      // New rule: ALL of the following must be true:
      //   1. Total content < 80 chars (very little text)
      //   2. ≤ 2 bullets
      //   3. No emphasisIndices (not marking key content)
      //   4. Previous slide is a compatible type (if exists)
      //   5. This slide's title doesn't contain keywords suggesting unique value
      const contentLength = slide.bullets.map(b => b.length).reduce((a, b) => a + b, 0) + (slide.note?.length || 0);
      const bulletCount = slide.bullets.length;
      const hasEmphasis = (slide.emphasisIndices?.length ?? 0) > 0;
      const titleLower = slide.title.toLowerCase();
      const hasKeyKeywords = /关键|核心|重要|创新|贡献|limitation|challenge|novelty|key|core/i.test(titleLower);
      const isCompatibleWithPrev = pending
        ? (MERGE_COMPATIBILITY[slide.type]?.has(pending.type) ?? false)
        : true;

      const isGenuinelyThin = contentLength < 80
        && bulletCount <= 2
        && !hasEmphasis
        && !hasKeyKeywords
        && isCompatibleWithPrev;

      if (isGenuinelyThin) {
        if (pending) {
          pending.bullets.push(...slide.bullets);
          if (slide.note?.trim()) {
            pending.note = (pending.note || '') + '\n' + slide.note!.trim();
          }
          console.log(`[PPT-V2] Thin-merge: "${slide.title}" (${contentLength}ch/${bulletCount}b) → "${pending.title}"`);
        } else {
          pending = { ...slide };
          console.log(`[PPT-V2] Thin-pending: "${slide.title}" (${contentLength}ch/${bulletCount}b)`);
        }
      } else {
        flush();
        merged.push(slide);
      }
    }
    flush();
    if (merged.length !== result.length) {
      console.log(`[PPT-V2] Thin-merge: ${result.length} → ${merged.length} slides`);
    }
    result = merged;
  } else {
    console.log(`[PPT-V2] Thin-merge: DISABLED (keeping all ${result.length} slides)`);
  }

  // ── Pass 2: Hard cap (disabled by default) ──
  if (MERGE_CONFIG.enableHardCap && maxSlides && result.length > maxSlides) {
    const priority = (s: EnhancedSlideSpec): number => {
      if (PROTECTED_TYPES.has(s.type)) return 0;
      if (FIGURE_TYPES.has(s.type)) return 1;
      if (s.type === 'background' || s.type === 'method' || s.type === 'result') return 2;
      if (s.type === 'conclusion' || s.type === 'gap') return 3;
      return 4;
    };
    const tagged = result.map((s, i) => ({ slide: s, origIdx: i, pri: priority(s) }));
    tagged.sort((a, b) => a.pri - b.pri || a.origIdx - b.origIdx);
    const kept = tagged.slice(0, maxSlides);
    kept.sort((a, b) => a.origIdx - b.origIdx);
    const removed = result.length - maxSlides;
    result = kept.map(k => k.slide);
    console.log(`[PPT-V2] Hard-cap: removed ${removed} lowest-priority slides (max=${maxSlides})`);
  } else {
    console.log(`[PPT-V2] Hard-cap: ${MERGE_CONFIG.enableHardCap ? 'enabled but not needed' : 'DISABLED'} (${result.length} slides)`);
  }

  // ── Pass 3: Consecutive same-type dedup (disabled by default) ──
  if (MERGE_CONFIG.enableConsecutiveDedup) {
    let deduped: EnhancedSlideSpec[] = [];
    let runStart = 0;
    for (let i = 0; i < result.length; i++) {
      if (i > 0 && result[i].type !== result[i - 1].type) {
        deduped = deduped.concat(collapseConsecutiveRun(result.slice(runStart, i)));
        runStart = i;
      }
    }
    if (runStart < result.length) {
      deduped = deduped.concat(collapseConsecutiveRun(result.slice(runStart)));
    }
    if (deduped.length < result.length) {
      console.log(`[PPT-V2] Consecutive-dedup: ${result.length} → ${deduped.length} slides`);
      result = deduped;
    }
  } else {
    console.log(`[PPT-V2] Consecutive-dedup: DISABLED`);
  }

  console.log(`[PPT-V2] mergeThinSlides final: ${slides.length} → ${result.length} slides`);
  return result;

  /** Collapse a run of 3+ consecutive same-type slides by merging tail into head */
  function collapseConsecutiveRun(run: EnhancedSlideSpec[]): EnhancedSlideSpec[] {
    if (run.length <= 2) return run;
    const kept: EnhancedSlideSpec[] = [run[0], { ...run[1] }];
    for (let i = 2; i < run.length; i++) {
      kept[1].bullets.push(...run[i].bullets);
      if (run[i].note?.trim()) {
        kept[1].note = (kept[1].note || '') + '\n' + run[i].note!.trim();
      }
    }
    console.log(`[PPT-V2] Collapsed ${run.length}x "${run[0].type}" → 2 slides`);
    return kept;
  }
}
