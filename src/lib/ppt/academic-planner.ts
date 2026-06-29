import { buildPptStructureDraftFromOutline } from '@/lib/ppt/outline-draft';
import type { MinerUFigureInput } from '@/lib/ppt/mineru-figures';
import { llmInvokeObserved, markFallback, markJsonParsed, readPositiveIntEnv } from '@/lib/ppt/academic-observability';
import { buildContextualFallbackBullets, ensureSlideContentFromSources, mergeThinSlides } from '@/lib/ppt/academic-slide-quality';
import type { EnhancedSlideSpec, LayoutType, PaperInput, PptOptions, SlideSpec } from '@/lib/ppt/academic-types';
import type { RuntimeAIConfig } from '@/types';

/** Calculate target page count and hard cap based on presentation duration (minutes) */
function calcPageLimits(durationMin: number): { targetPages: number; hardCap: number } {
  let targetPages: number;
  if (durationMin <= 10) targetPages = 6;
  else if (durationMin <= 15) targetPages = 8;
  else if (durationMin <= 20) targetPages = Math.round(durationMin / 1.8);
  else if (durationMin <= 30) targetPages = Math.round(durationMin / 1.6);
  else targetPages = Math.round(durationMin / 1.5);
  targetPages = Math.min(targetPages, 18);
  return { targetPages, hardCap: Math.min(targetPages + 3, 21) };
}

// ============================================================
// ArcDeck-Enhanced Academic PPT Generation Pipeline
// Pipeline: Discourse Parse → Figure Inventory → Slide Plan → Critic → Refine
// PDF processing uses pdf-parse-fixed + MinerU (NOT Docling)
// ============================================================

// ── Discourse Section Type ──
interface DiscourseSection {
  type: 'background' | 'gap' | 'method' | 'result' | 'discussion' | 'conclusion' | 'other';
  heading: string;
  content: string;
  figureRefs: string[];  // e.g. ["Fig.1", "Fig.2"]
  importance: 'high' | 'medium' | 'low';
}

// ── Figure Inventory Item ──
interface FigureInventory {
  label: string;
  caption: string;
  pageIdx: number;
  matchedDiscourseIdx: number;  // index into discourse sections
  slideType: 'figure_overview' | 'figure_detail' | 'figure_evidence';
  importance: 'high' | 'medium' | 'low';
}

// ────────────────────────────────────────────────────────────────
// Stage 1: Discourse Parser
// Parse paper text into structured discourse sections
// This follows ArcDeck's section_discourse_parser pattern
// ────────────────────────────────────────────────────────────────
async function parseDiscourse(
  papers: PaperInput[],
  _runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<DiscourseSection[]> {
  const source = papers
    .map(p => [p.title, p.abstract, p.rawContent, p.content].filter(Boolean).join('\n'))
    .join('\n\n')
    .replace(/\s+/g, ' ')
    .trim() || '未提供可解析的资料正文。';
  const sentences = source
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  const chunks = sentences.length > 0
    ? sentences
    : Array.from({ length: Math.ceil(source.length / 180) }, (_, i) => source.slice(i * 180, (i + 1) * 180)).filter(Boolean);
  const specs: Array<{
    type: DiscourseSection['type'];
    heading: string;
    keywords: RegExp;
    importance: 'high' | 'medium' | 'low';
    offset: number;
  }> = [
    { type: 'background', heading: '背景与目标', keywords: /背景|目标|现状|重要|对齐|可信|NotebookLM/i, importance: 'medium', offset: 0 },
    { type: 'gap', heading: '问题与风险', keywords: /问题|风险|失败|降级|卡死|不足|痛点|瓶颈/i, importance: 'high', offset: 1 },
    { type: 'method', heading: '方法与流程', keywords: /方法|流程|机制|复用|grounded|context|上传|解析|检索|状态/i, importance: 'high', offset: 2 },
    { type: 'result', heading: '产物与验证', keywords: /结果|产物|PPT|播客|知识卡片|报告|smoke|生成|返回/i, importance: 'high', offset: 3 },
    { type: 'discussion', heading: '体验与发布讨论', keywords: /体验|等待|重试|超时|部署|服务器|Linux|health|smoke/i, importance: 'medium', offset: 4 },
    { type: 'conclusion', heading: '结论与下一步', keywords: /结论|下一步|交付|发布|必须|标准|完成/i, importance: 'medium', offset: 5 },
  ];
  const used = new Set<number>();
  const pickContent = (spec: typeof specs[number]) => {
    const matched: string[] = [];
    chunks.forEach((sentence, idx) => {
      if (matched.length >= 3 || used.has(idx)) return;
      if (spec.keywords.test(sentence)) {
        used.add(idx);
        matched.push(sentence);
      }
    });
    if (matched.length > 0) return matched.join(' ');
    const stride = Math.max(1, Math.floor(chunks.length / specs.length));
    const start = Math.min(Math.max(0, chunks.length - 1), spec.offset * stride);
    return chunks.slice(start, start + 2).join(' ') || source.slice(spec.offset * 160, spec.offset * 160 + 320) || source.slice(0, 320);
  };
  const figureRegex = /\b(?:Fig\.?|Figure)\s*\d+[A-Za-z]?|图\s*\d+[A-Za-z]?/gi;
  return specs.map(spec => {
    const content = pickContent(spec);
    return {
      type: spec.type,
      heading: spec.heading,
      content: content.slice(0, 900),
      figureRefs: Array.from(new Set(content.match(figureRegex) || [])),
      importance: spec.importance,
    };
  });
}

// ────────────────────────────────────────────────────────────────
// Stage 2: Figure Inventory & Matcher
// Build figure inventory and match each figure to a discourse section
// Uses MinerU-extracted figures + LLM for semantic matching
// ────────────────────────────────────────────────────────────────
async function matchFiguresToDiscourse(
  discourse: DiscourseSection[],
  mineruFigures: MinerUFigureInput[],
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<FigureInventory[]> {
  if (mineruFigures.length === 0) return [];

  const figureList = mineruFigures.map((f, i) =>
    `[${i}] ${f.label}: "${f.caption}" (page ${f.pageIdx})`
  ).join('\n');

  const discourseList = discourse.map((d, i) =>
    `[${i}] ${d.type}/${d.importance}: ${d.heading} — ${d.content.slice(0, 120)}... (refs: ${d.figureRefs.join(', ') || 'none'})`
  ).join('\n');

  const prompt = `你是一位学术图表分析专家。请将论文中的图表与论证结构进行语义匹配。

## 论文图表列表
${figureList}

## 论文论证结构
${discourseList}

## 任务
为每个图表找到最匹配的论证段落，并决定该图表在PPT中应以何种方式展示：
- **figure_overview**: 大图+简短结论，适合首次展示核心图表
- **figure_detail**: 图表+细节分析，适合深入解读特定实验条件
- **figure_evidence**: 聚焦数据证据，适合支撑某个论点

## 输出格式（严格 JSON 数组，每个图表一条）
[{"label":"Fig.1","matchedDiscourseIdx":3,"slideType":"figure_overview","importance":"high"}]

请直接输出 JSON 数组：`;

  try {
    const { raw, log: _log } = await llmInvokeObserved('matchFiguresToDiscourse', [{ role: 'user', content: prompt }], {
      model: 'doubao-seed-2-0-pro-260215',
      temperature: 0.2,
      timeoutMs: 45000,
      maxTokens: 900,
      runtimeConfig,
    });
    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) { markJsonParsed('matchFiguresToDiscourse', false); throw new Error('no JSON array found'); }
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) { markJsonParsed('matchFiguresToDiscourse', false); throw new Error('not an array'); }
    markJsonParsed('matchFiguresToDiscourse', true);

    const validSlideTypes = ['figure_overview', 'figure_detail', 'figure_evidence'];
    return arr.map((item: Record<string, unknown>, i: number): FigureInventory => {
      const fig = mineruFigures[i] || mineruFigures[0];
      return {
        // IMPORTANT: Always use MinerU's original label for matching, NOT the LLM's re-labeled version
        // The LLM may renumber (e.g., "Fig.1" instead of MinerU's "Fig.4"), which breaks findMinerUFigure
        label: fig?.label || String(item.label || `Fig.${i + 1}`),
        caption: fig?.caption || String(item.caption || ''),
        pageIdx: fig?.pageIdx ?? -1,
        matchedDiscourseIdx: typeof item.matchedDiscourseIdx === 'number' ? item.matchedDiscourseIdx : 0,
        slideType: validSlideTypes.includes(item.slideType as string) ? (item.slideType as FigureInventory['slideType']) : 'figure_overview',
        importance: ['high', 'medium', 'low'].includes(item.importance as string) ? (item.importance as 'high' | 'medium' | 'low') : 'medium',
      };
    });
  } catch (err) {
    console.error('[PPT-V2] Figure match error:', err instanceof Error ? err.message : err);
    markFallback('matchFiguresToDiscourse', err instanceof Error ? err.message : String(err));
    // Fallback: sequential matching
    return mineruFigures.map((fig, i) => ({
      label: fig.label,
      caption: fig.caption,
      pageIdx: fig.pageIdx,
      matchedDiscourseIdx: Math.min(i, discourse.length - 1),
      slideType: (i === 0 ? 'figure_overview' : i % 2 === 0 ? 'figure_detail' : 'figure_evidence') as FigureInventory['slideType'],
      importance: 'medium' as const,
    }));
  }
}

// ────────────────────────────────────────────────────────────────
// Stage 3: Slide Planner
// Based on ArcDeck's slide_planner - generates slides from discourse + figures
// Follows SKILL.md template standards
// ────────────────────────────────────────────────────────────────
async function planSlides(
  papers: PaperInput[],
  discourse: DiscourseSection[],
  figureInventory: FigureInventory[],
  options?: PptOptions,
): Promise<EnhancedSlideSpec[]> {
  // ── Phase 1: Draft structure (type + title only, no bullets) ──
  const structure = await draftStructure(papers, discourse, figureInventory, options);

  // ── Phase 1.5: Validate structure ──
  const validatedStructure = validateStructure(structure, options);

  // ── Phase 2: Fill content for each slide ──
  const slides = await fillSlideContent(validatedStructure, papers, discourse, figureInventory, options);

  return slides;
}

// ────────────────────────────────────────────────────────────────
// Phase 1: Draft Structure
// Only decides slide types, titles, order, and page count.
// No bullets, no layout — just the skeleton.
// ────────────────────────────────────────────────────────────────
type StructureDraft = {
  type: SlideSpec['type'];
  title: string;
  figureLabel?: string;
  discourseRef?: string;
};

async function draftStructure(
  papers: PaperInput[],
  discourse: DiscourseSection[],
  figureInventory: FigureInventory[],
  options?: PptOptions,
): Promise<StructureDraft[]> {
  const duration = options?.duration || 20;
  const audience = options?.audience || 'researchers';
  if (options?.outlineDraft?.length) {
    return validateStructure(buildPptStructureDraftFromOutline(options.outlineDraft), options);
  }
  // Target: ~2 min/slide standard pacing
  // Short talks get fewer but more substantial slides
  // Formula: clamp to reasonable range based on academic presentation norms
  let slideCountHint: number;
  if (duration <= 10) slideCountHint = 6;
  else if (duration <= 15) slideCountHint = 8;
  else if (duration <= 20) slideCountHint = Math.round(duration / 1.8);
  else if (duration <= 30) slideCountHint = Math.round(duration / 1.6);
  else slideCountHint = Math.round(duration / 1.5);
  // Cap at 18 pages max for readability
  slideCountHint = Math.min(slideCountHint, 18);
  // Maximum figure_ pages: proportional to total, but never more than 1/3
  const maxFigurePages = Math.min(Math.max(2, Math.floor(slideCountHint / 4)), 5);

  const paper = papers[0];
  const structure: StructureDraft[] = [
    { type: 'cover', title: paper?.title || '学术文献报告' },
    { type: 'background', title: discourse.find(d => d.type === 'background')?.heading || '研究背景与目标', discourseRef: 'background' },
    { type: 'gap', title: discourse.find(d => d.type === 'gap')?.heading || '现存问题与风险', discourseRef: 'gap' },
    { type: 'method', title: discourse.find(d => d.type === 'method')?.heading || '方法与流程设计', discourseRef: 'method' },
  ];

  const selectedFigures = figureInventory
    .filter(figure => figure.label)
    .slice(0, maxFigurePages)
    .map((figure): StructureDraft => ({
      type: figure.slideType,
      title: `${figure.label} 证据解读`,
      figureLabel: figure.label,
      discourseRef: `figure:${figure.matchedDiscourseIdx}`,
    }));
  if (selectedFigures.length > 0) {
    structure.push(...selectedFigures);
  }

  structure.push(
    { type: 'result', title: discourse.find(d => d.type === 'result')?.heading || '生成产物与验证结果', discourseRef: 'result' },
  );
  if (duration > 10 && slideCountHint >= 7) {
    structure.push({
      type: 'conclusion',
      title: discourse.find(d => d.type === 'conclusion')?.heading || '结论与下一步',
      discourseRef: 'conclusion',
    });
  }
  structure.push({ type: 'closing', title: '结论与下一步' });

  const hardLimit = Math.max(6, slideCountHint + 2);
  if (structure.length > hardLimit) {
    const cover = structure[0];
    const closing = structure[structure.length - 1];
    const middle = structure.slice(1, -1);
    const kept = middle.slice(0, hardLimit - 2);
    return [cover, ...kept, closing];
  }
  return structure;
}

// ────────────────────────────────────────────────────────────────
// Phase 1.5: Validate Structure
// Enforce hard constraints before content fill
// ────────────────────────────────────────────────────────────────
function validateStructure(
  structure: StructureDraft[],
  options?: PptOptions,
): StructureDraft[] {
  const duration = options?.duration || 20;
  const { hardCap: maxSlideCap } = calcPageLimits(duration);
  let result = [...structure];

  // Rule 1: Must start with cover
  if (result.length > 0 && result[0].type !== 'cover') {
    result.unshift({ type: 'cover', title: '学术文献报告' });
  }

  // Rule 2: Must end with closing
  if (result.length > 0 && result[result.length - 1].type !== 'closing') {
    result.push({ type: 'closing', title: '感谢聆听' });
  }

  // Rule 3: Hard cap on page count
  if (result.length > maxSlideCap) {
    // Keep cover + closing + trim middle
    const cover = result[0];
    const closing = result[result.length - 1];
    const middle = result.slice(1, -1);
    // Prioritize: figure_ > method/result/discussion > others
    const priority = (t: string): number => {
      if (t.startsWith('figure_')) return 0;
      if (['method', 'result', 'discussion'].includes(t)) return 1;
      if (['background', 'gap', 'mechanism', 'synthesis'].includes(t)) return 2;
      return 3;
    };
    const tagged = middle.map((s, i) => ({ s, p: priority(s.type), i }));
    tagged.sort((a, b) => a.p - b.p || a.i - b.i);
    const kept = tagged.slice(0, maxSlideCap - 2).sort((a, b) => a.i - b.i).map(t => t.s);
    result = [cover, ...kept, closing];
    console.log(`[PPT-V2] validateStructure: capped ${structure.length} → ${result.length} (maxCap=${maxSlideCap})`);
  }

  // Rule 4: Collapse consecutive same-type (≥3 → keep 2)
  const collapsed: StructureDraft[] = [];
  let consecutiveCount = 0;
  let lastType = '';
  for (const s of result) {
    if (s.type === lastType) {
      consecutiveCount++;
      if (consecutiveCount >= 3) continue; // skip 3rd+
    } else {
      consecutiveCount = 1;
      lastType = s.type;
    }
    collapsed.push(s);
  }

  return collapsed;
}

// ────────────────────────────────────────────────────────────────
// Phase 2: Fill Slide Content
// For each slide in the structure, generate bullets/layout/emphasis
// This is done in batches to avoid overloading the LLM
// ────────────────────────────────────────────────────────────────
async function fillSlideContent(
  structure: StructureDraft[],
  papers: PaperInput[],
  discourse: DiscourseSection[],
  figureInventory: FigureInventory[],
  options?: PptOptions,
): Promise<EnhancedSlideSpec[]> {
  const duration = options?.duration || 20;
  const audience = options?.audience || 'researchers';
  const audienceLabels: Record<string, string> = {
    researchers: '领域研究人员，关注技术细节和创新贡献',
    students: '研究生/本科生，需要背景铺垫和概念解释，减少专业术语',
    industry: '业界从业者，侧重实用结论和商业价值，偏好直观结论',
    general: '一般听众，需要通俗化讲解，强调研究意义和社会影响',
  };
  const audienceDesc = audienceLabels[audience] || audienceLabels.researchers;

  // Prepare paper content excerpts for reference
  const paperContent = papers.map((p) => {
    const content = (p.rawContent || p.content || '').slice(0, 2500);
    return `【${p.title}】\n${content}`;
  }).join('\n---\n');

  const discourseFull = discourse.map((d, i) =>
    `[D${i}] ${d.type}/${d.importance}: ${d.heading}\n${d.content.slice(0, 120)}\n图引用: ${d.figureRefs.join(', ') || '无'}`
  ).join('\n\n');

  const figureFull = figureInventory.length > 0
    ? figureInventory.map((f, i) =>
        `[F${i}] ${f.label} (${f.slideType}): ${f.caption}`
      ).join('\n')
    : '(No figures)';

  // Build the full slide list context for the LLM
  const structureSummary = structure.map((s, i) =>
    `[${i}] ${s.type}${s.figureLabel ? ' (' + s.figureLabel + ')' : ''}: ${s.title}`
  ).join('\n');
  const confirmedOutlineSection = options?.outlineDraftPrompt ? `\n## 用户确认的大纲（必须按顺序覆盖这些页面目标）\n${options.outlineDraftPrompt}\n` : '';

  // Fill one slide per call. Real Ark calls can exceed 70s on the first slide,
  // so keep the timeout configurable instead of treating slow calls as fallback.
  const BATCH_SIZE = 1;
  const fillSlideTimeoutMs = readPositiveIntEnv('PPT_V2_FILL_SLIDE_TIMEOUT_MS', 120_000);
  const allResults: EnhancedSlideSpec[] = [];

  const validTypes: SlideSpec['type'][] = ['cover','author','toc','background','gap','roadmap','method','result','discussion','conclusion','figure_overview','figure_detail','figure_evidence','mechanism','synthesis','citation','closing'];
  const validLayouts: LayoutType[] = ['full_text','text_right_figure_left','text_left_figure_right','figure_centered','two_column','title_only','bullet_heavy','quote_highlight'];

  const defaultBullets: Record<string, string[]> = {
    background: ['领域背景与重要性', '当前未解决的核心挑战', '本文提出的研究思路'],
    gap: ['现有研究的局限性', '核心挑战与科学空白', '本研究的机会与方向'],
    method: ['方法核心思路', '关键技术步骤', '实验设计方案'],
    result: ['核心实验发现', '与现有方法的对比', '数据的统计学意义'],
    discussion: ['结果的理论意义', '与相关工作的比较', '研究局限性分析'],
    conclusion: ['核心结论总结', '主要创新贡献', '未来研究方向'],
    mechanism: ['模型/算法设计', '关键技术细节', '工作机制解释'],
    synthesis: ['方法与结果汇总', '核心发现综合', '整体贡献评价'],
    figure_overview: ['图表展示了核心实验结果', '关键数据发现与趋势', '对研究结论的支撑作用'],
    figure_detail: ['图表的关键细节分析', '特定条件下的实验表现', '与预期结果的一致性'],
    figure_evidence: ['数据证据的核心结论', '统计显著性分析', '对研究假设的验证结果'],
  };

  for (let batchStart = 0; batchStart < structure.length; batchStart += BATCH_SIZE) {
    const batchStructure = structure.slice(batchStart, batchStart + BATCH_SIZE);
    const structureOnlyTypes: SlideSpec['type'][] = ['cover', 'author', 'toc', 'closing'];
    if (batchStructure.every(item => structureOnlyTypes.includes(item.type))) {
      allResults.push(...batchStructure.map(item => ({
        type: item.type,
        title: item.title,
        bullets: item.type === 'closing' ? ['核心结论已经形成可追溯验证链路', '后续重点是持续提升真实用户路径体验', '感谢关注灵笔的产品化演进'] : [],
        note: '',
        figureLabel: item.figureLabel,
        layout: (item.type === 'closing' ? 'quote_highlight' : 'title_only') as LayoutType,
      })));
      continue;
    }
    const batchSummary = batchStructure.map((s, i) =>
      `[${batchStart + i}] ${s.type}${s.figureLabel ? ' (' + s.figureLabel + ')' : ''}: ${s.title}`
    ).join('\n');

    const batchPrompt = `你是一位学术PPT内容撰写专家。请为以下PPT页面填写详细内容。

## 任务
为每页生成：bullets（要点）、layout（布局）、emphasisIndices（强调索引）、note（备注）。
**不修改 type 和 title，只填写内容字段。**

## 演讲约束
- 演讲时长：${duration} 分钟
- 目标受众：${audienceDesc}

## 本批PPT页面
${batchSummary}
${confirmedOutlineSection}

## 论文内容（节选）
${paperContent}

## 论证结构
${discourseFull}

## 可用图表
${figureFull}

## 内容密度规则（必须严格遵守）
- **每页生成 3 个 bullets**，封面和致谢页可以为空
- **每个 bullet 必须是完整陈述句（15-45字）**，禁止碎片化关键词
- **figure_ 类型页面必须有 3 个分析性要点**（"该图展示了X"、"关键发现是Y"、"数据表明Z"）
- **background 页面必须包含完整因果链**：领域价值→未解挑战→本文思路（3步，每步≥25字）
- **gap 页面必须包含 ≥3 个递进层次**：现有局限→核心挑战→研究机会
- **method 页面必须展开技术细节**：核心思路→关键步骤→实验设计

## 禁止模式
❌ bullets: ["背景", "方法", "结果"] （关键词碎片）
❌ bullets: ["本文提出了一种新方法"] （一句话概括）
❌ bullets: ["接下来看实验结果"] （过渡废话）
✅ bullets: ["本文提出的X方法通过Y机制解决了Z问题", "与baseline相比提升了A%", "在B数据集上达到SOTA"]

## 布局选择规则
- title_only: 封面、致谢
- full_text: 背景介绍、综合汇总
- bullet_heavy: 方法步骤、结果列表
- text_left_figure_right: 有 figureLabel 且为 figure_overview
- text_right_figure_left: 有 figureLabel 且为 figure_detail
- figure_centered: 有 figureLabel 且为 figure_evidence
- two_column: 对比分析、机制解释
- quote_highlight: 关键发现、研究意义

## 输出格式（严格 JSON 数组，保持页面顺序）
[
  {"type":"background","title":"研究背景","bullets":["因果链1","因果链2","因果链3"],"note":"一句讲解提示","emphasisIndices":[1],"layout":"full_text"}
]

请直接输出 JSON 数组：`;

    try {
      const { raw } = await llmInvokeObserved(
        `fillSlideContent_${batchStart}`,
        [{ role: 'user', content: batchPrompt }],
        {
          model: 'doubao-seed-2-0-pro-260215',
          temperature: 0.4,
          timeoutMs: fillSlideTimeoutMs,
          maxTokens: 700,
          runtimeConfig: options?.runtimeConfig,
        },
      );
      const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!jsonMatch) { markJsonParsed(`fillSlideContent_${batchStart}`, false); throw new Error('no JSON array found'); }

      // Attempt JSON parse with auto-repair for common LLM JSON errors
      const jsonText = jsonMatch[0];
      let arr: unknown[];
      try {
        arr = JSON.parse(jsonText);
      } catch {
        // Try to repair: remove trailing commas, fix unquoted values
        const repaired = jsonText
          .replace(/,\s*([}\]])/g, '$1')  // trailing commas
          .replace(/'/g, '"');              // single quotes
        arr = JSON.parse(repaired);
      }
      if (!Array.isArray(arr)) { markJsonParsed(`fillSlideContent_${batchStart}`, false); throw new Error('not an array'); }
      markJsonParsed(`fillSlideContent_${batchStart}`, true);

      const batchResults = (arr as Record<string, unknown>[]).map((s, idx): EnhancedSlideSpec => {
        const structItem = batchStructure[idx];
        return {
          type: validTypes.includes(s.type as SlideSpec['type']) ? (s.type as SlideSpec['type']) : (structItem?.type || 'synthesis'),
          title: String(s.title || structItem?.title || ''),
          bullets: Array.isArray(s.bullets) && s.bullets.length > 0
            ? s.bullets.map(String)
            : (structItem ? buildContextualFallbackBullets(structItem, papers, defaultBullets) : ['该页将基于资料证据继续展开']),
          note: String(s.note || ''),
          figureLabel: s.figureLabel ? String(s.figureLabel) : structItem?.figureLabel,
          emphasisIndices: Array.isArray(s.emphasisIndices) ? (s.emphasisIndices as number[]).map(Number) : undefined,
          layout: validLayouts.includes(s.layout as LayoutType) ? (s.layout as LayoutType) : undefined,
          discourseRef: s.discourseRef ? String(s.discourseRef) : structItem?.discourseRef,
        };
      });
      allResults.push(...batchResults);
    } catch (err) {
      console.error(`[PPT-V2] fillSlideContent batch ${batchStart} error:`, err instanceof Error ? err.message : err);
      markFallback(`fillSlideContent_${batchStart}`, err instanceof Error ? err.message : String(err));
      // Fallback for this batch: use default bullets
      const batchFallback = batchStructure.map((s): EnhancedSlideSpec => ({
        ...s,
        bullets: buildContextualFallbackBullets(s, papers, defaultBullets),
        note: s.type === 'closing' ? '已使用资料上下文生成降级页，避免空白占位。' : '该页使用资料上下文降级生成，建议下载后重点复核。',
        layout: s.type === 'cover' || s.type === 'closing' ? 'title_only' : 'full_text',
      }));
      allResults.push(...batchFallback);
    }
  }

  return allResults;
}
// ────────────────────────────────────────────────────────────────
// Stage 4: Design Critic
// Evaluate the slide plan for quality issues
// Based on ArcDeck's design_critic agent
// ────────────────────────────────────────────────────────────────
async function criticSlidePlan(
  slides: EnhancedSlideSpec[],
  discourse: DiscourseSection[],
  figureInventory: FigureInventory[],
  options?: PptOptions,
): Promise<{ issues: string[]; score: number }> {
  const duration = options?.duration || 20;
  const targetPages = Math.round(duration / 1.5);
  const maxPages = targetPages + 3;
  const issues: string[] = [];
  const requiredTypes: SlideSpec['type'][] = ['cover', 'background', 'method', 'result', 'conclusion'];
  const slideTypes = new Set(slides.map(s => s.type));
  for (const type of requiredTypes) {
    if (!slideTypes.has(type)) issues.push(`缺少 ${type} 类型页面`);
  }
  const thinSlides = slides.filter(s => s.type !== 'cover' && s.type !== 'closing' && (s.bullets.length < 2 || s.bullets.join('').length < 60));
  if (thinSlides.length > 0) issues.push(`存在 ${thinSlides.length} 页内容过薄，需要补足证据 bullet`);
  if (slides.length > maxPages) issues.push(`页数 ${slides.length} 超出 ${duration} 分钟建议上限 ${maxPages}`);
  if (slides.length < Math.max(4, targetPages - 2)) issues.push(`页数 ${slides.length} 低于 ${duration} 分钟建议目标 ${targetPages}`);
  const discourseTypes = new Set(discourse.map(d => d.type));
  for (const type of ['gap', 'method', 'result', 'conclusion'] as DiscourseSection['type'][]) {
    if (!discourseTypes.has(type)) issues.push(`论证结构缺少 ${type} 信息块`);
  }
  const missingFigures = figureInventory.filter(fig => !slides.some(s => s.figureLabel === fig.label));
  if (missingFigures.length > 0) issues.push(`有 ${missingFigures.length} 个图表未进入页面`);
  const score = Math.max(0, 10 - issues.length * 2);
  return { issues, score };
}

// ────────────────────────────────────────────────────────────────
// Stage 5: Slide Refiner
// Fix issues identified by the critic
// Based on ArcDeck's design_refiner agent
// ────────────────────────────────────────────────────────────────
function normalizeRawSlideArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const unwrapped = value.length === 1 && Array.isArray(value[0]) ? value[0] : value;
  return unwrapped.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[];
}

function mapRawSlidesToSpecs(rawSlides: Record<string, unknown>[]): EnhancedSlideSpec[] {
  const validTypes: SlideSpec['type'][] = ['cover','author','toc','background','gap','roadmap','method','result','discussion','conclusion','figure_overview','figure_detail','figure_evidence','mechanism','synthesis','citation','closing'];
  const validLayouts: LayoutType[] = ['full_text','text_right_figure_left','text_left_figure_right','figure_centered','two_column','title_only','bullet_heavy','quote_highlight'];

  return rawSlides.map((s): EnhancedSlideSpec => ({
    type: validTypes.includes(s.type as SlideSpec['type']) ? (s.type as SlideSpec['type']) : 'synthesis',
    title: String(s.title || ''),
    bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [],
    note: String(s.note || ''),
    figureLabel: s.figureLabel ? String(s.figureLabel) : undefined,
    emphasisIndices: Array.isArray(s.emphasisIndices) ? (s.emphasisIndices as number[]).map(Number) : undefined,
    layout: validLayouts.includes(s.layout as LayoutType) ? (s.layout as LayoutType) : undefined,
    discourseRef: s.discourseRef ? String(s.discourseRef) : undefined,
  }));
}

function isUnsafeRefinedPlan(refined: EnhancedSlideSpec[], original: EnhancedSlideSpec[]): string {
  const minSlides = Math.min(4, original.length);
  if (refined.length < minSlides) return `refined plan too short: ${refined.length}/${original.length}`;
  if (original.some(s => s.type === 'cover') && !refined.some(s => s.type === 'cover')) return 'refined plan dropped cover slide';
  if (original.some(s => s.type === 'closing') && !refined.some(s => s.type === 'closing')) return 'refined plan dropped closing slide';
  return '';
}

async function refineSlidePlan(
  slides: EnhancedSlideSpec[],
  issues: string[],
  discourse: DiscourseSection[],
  figureInventory: FigureInventory[],
  options?: PptOptions,
): Promise<EnhancedSlideSpec[]> {
  if (issues.length === 0) return slides;
  const currentCount = slides.length;
  const maxAllowed = Math.round((options?.duration || 20) / 1.5) + 3;

  const slideSummary = slides.map((s, i) =>
    `[${i}] ${s.type}: ${s.title} | bullets: ${JSON.stringify(s.bullets)}${s.figureLabel ? ' | ' + s.figureLabel : ''}${s.emphasisIndices ? ' | emphasis:' + JSON.stringify(s.emphasisIndices) : ''}`
  ).join('\n');

  const prompt = `你是一位学术PPT设计修正专家。请根据评审意见修正以下PPT大纲。

## 当前大纲（${currentCount}页）
${slideSummary}

## 评审发现的问题
${issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n')}

## 论文论证结构
${discourse.map((d, i) => `[D${i}] ${d.type}/${d.importance}: ${d.heading}`).join('\n')}

## 可用图表
${figureInventory.map(f => `${f.label} (${f.slideType})`).join(', ') || '无'}

## 修正要求（严格遵守）
1. 针对每个问题进行修正
2. 保持原有页面的核心内容，只做必要的调整
3. **页数绝对不得超过 ${maxAllowed} 页**（当前${currentCount}页，${currentCount > maxAllowed ? '需要减少' : '可以小幅调整'}）
4. **禁止新增页面**，只能合并或优化现有页面
5. 如果需要合并页面，确保不会信息过载

## 输出格式（严格 JSON 数组，与输入格式相同）
[{"type":"cover","title":"...","bullets":[],"note":"","layout":"title_only"}]

请直接输出修正后的完整 JSON 数组：`;

  try {
    const { raw, log: _log } = await llmInvokeObserved('refineSlidePlan', [{ role: 'user', content: prompt }], {
      model: 'doubao-seed-2-0-pro-260215',
      temperature: 0.3,
      timeoutMs: 90000,
      maxTokens: 1600,
      runtimeConfig: options?.runtimeConfig,
    });
    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) { markJsonParsed('refineSlidePlan', false); throw new Error('no JSON array found'); }
    const arr = normalizeRawSlideArray(JSON.parse(jsonMatch[0]));
    if (arr.length === 0) { markJsonParsed('refineSlidePlan', false); throw new Error('not an array'); }
    markJsonParsed('refineSlidePlan', true);

    const refined = mapRawSlidesToSpecs(arr);
    const unsafeReason = isUnsafeRefinedPlan(refined, slides);
    if (unsafeReason) throw new Error(unsafeReason);
    return refined;
  } catch (err) {
    console.error('[PPT-V2] Refine error:', err instanceof Error ? err.message : err);
    markFallback('refineSlidePlan', err instanceof Error ? err.message : String(err));
    return slides; // Return original on failure
  }
}

// ────────────────────────────────────────────────────────────────
// Stage 6: Commitment Check
// Verify the final slides are faithful to the original paper
// Based on ArcDeck's commitment_agent
// ────────────────────────────────────────────────────────────────
async function commitmentCheck(
  slides: EnhancedSlideSpec[],
  papers: PaperInput[],
  _runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<EnhancedSlideSpec[]> {
  const paperText = papers.map(p => [p.title, p.abstract, p.rawContent, p.content].filter(Boolean).join(' ')).join(' ').toLowerCase();
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ');
  const source = normalize(paperText);
  const getFragments = (value: string) => {
    const normalized = normalize(value);
    const latin = normalized.split(/\s+/).filter(token => token.length >= 4);
    const cjk = Array.from(new Set((normalized.match(/\p{Script=Han}{2,8}/gu) || []).filter(token => token.length >= 2)));
    return [...latin, ...cjk].slice(0, 24);
  };
  return slides.map(slide => {
    if (slide.type === 'cover' || slide.type === 'closing') {
      return { ...slide, commitmentCheck: 'pass', commitmentNote: '结构页不做逐条证据审查' };
    }
    const fragments = getFragments([slide.title, ...slide.bullets].join(' '));
    const hits = fragments.filter(fragment => source.includes(fragment)).length;
    const check = hits >= 2 || fragments.length <= 2 ? 'pass' : 'warning';
    return {
      ...slide,
      commitmentCheck: check,
      commitmentNote: check === 'pass'
        ? '页面内容与资料关键词存在可追溯重合'
        : '页面关键词与资料原文重合不足，建议人工复核',
    };
  });
}

// ────────────────────────────────────────────────────────────────
// Main pipeline: orchestrate all stages
// ────────────────────────────────────────────────────────────────
export async function genAcademicOutline(papers: PaperInput[], options?: PptOptions): Promise<EnhancedSlideSpec[]> {
  console.log('[PPT-V2] === ArcDeck-Enhanced Pipeline Start ===');
  const pipelineDuration = options?.duration || 20;
  const pipelineTargetPages = Math.max(6, Math.round(pipelineDuration <= 15 ? pipelineDuration / 2 : pipelineDuration / 1.5));
  const pipelineMaxPages = Math.max(8, pipelineTargetPages + 3);
  console.log(`[PPT-V2] Duration=${pipelineDuration}min → target=${pipelineTargetPages} pages, hardCap=${pipelineMaxPages} pages`);
  console.log(`[PPT-V2] Papers: ${papers.length}, First paper: ${papers[0]?.title?.slice(0, 60)}`);

  // Stage 1: Discourse Parser
  console.log('[PPT-V2] Stage 1: Parsing discourse structure...');
  const discourse = await parseDiscourse(papers, options?.runtimeConfig);
  console.log(`[PPT-V2] Discourse sections: ${discourse.length} (${discourse.map(d => d.type).join(' → ')})`);

  // Stage 2: Figure matching using MinerU figures from POST handler
  const mineruFigures = options?.mineruFigures || [];
  const figureInventory = await matchFiguresToDiscourse(discourse, mineruFigures, options?.runtimeConfig);
  console.log(`[PPT-V2] Figure inventory: ${figureInventory.length} figures matched (from ${mineruFigures.length} MinerU figures)`);

  // Stage 3: Slide planning — TWO-PHASE (structure + content)
  console.log('[PPT-V2] Stage 3: Planning slides (two-phase: structure → content)...');
  let slides = await planSlides(papers, discourse, figureInventory, options);
  console.log(`[PPT-V2] Initial plan: ${slides.length} slides`);

  // Stage 4: Design Critic (threshold raised to 8)
  console.log('[PPT-V2] Stage 4: Critic review...');
  const critique = await criticSlidePlan(slides, discourse, figureInventory, options);
  console.log(`[PPT-V2] Critic score: ${critique.score}/10, issues: ${critique.issues.length}`);

  // Stage 5: Refine only when the deterministic quality gate fails.
  if (critique.score < 8) {
    console.log('[PPT-V2] Stage 5: Refining slides...');
    let refined = await refineSlidePlan(slides, critique.issues, discourse, figureInventory, options);
    console.log(`[PPT-V2] Refined plan: ${refined.length} slides`);
    // If refine returned same slides (fallback), try one more time with simplified prompt
    if (refined === slides) {
      console.log('[PPT-V2] Refine fallback detected, retrying with simplified prompt...');
      try {
        const { raw } = await llmInvokeObserved('refineSlidePlanRetry', [{
          role: 'user',
          content: `修正以下PPT大纲的问题。只输出修正后的JSON数组，不要解释。\n\n问题：${critique.issues.join('；')}\n\n当前大纲：\n${slides.map((s, i) => `[${i}] ${s.type}: ${s.title} | ${s.bullets.join('; ')}`).join('\n')}\n\n输出格式：[{"type":"...","title":"...","bullets":["..."],"note":"","layout":"..."}]`
        }], {
          model: 'doubao-seed-2-0-pro-260215',
          temperature: 0.2,
          timeoutMs: 60000,
          maxTokens: 1200,
          runtimeConfig: options?.runtimeConfig,
        });
        const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const arr = normalizeRawSlideArray(JSON.parse(jsonMatch[0]));
          if (arr.length > 0) {
            markJsonParsed('refineSlidePlanRetry', true);
            const retryRefined = mapRawSlidesToSpecs(arr);
            const unsafeReason = isUnsafeRefinedPlan(retryRefined, slides);
            if (unsafeReason) {
              markFallback('refineSlidePlanRetry', unsafeReason);
            } else {
              refined = retryRefined;
              console.log(`[PPT-V2] Retry refine succeeded: ${refined.length} slides`);
            }
          } else { markJsonParsed('refineSlidePlanRetry', false); }
        } else { markJsonParsed('refineSlidePlanRetry', false); }
      } catch (retryErr) {
        console.error('[PPT-V2] Retry refine also failed:', retryErr instanceof Error ? retryErr.message : String(retryErr));
        markFallback('refineSlidePlanRetry', retryErr instanceof Error ? retryErr.message : String(retryErr));
      }
    }
    slides = refined;
  } else {
    console.log(`[PPT-V2] Stage 5: Skipped (score=${critique.score}/10, deterministic issues=${critique.issues.length})`);
  }

  // Post-plan: Merge thin slides (single-sentence or near-empty)
  // Based on ArcDeck's design principle: each slide must carry meaningful content
  const targetDuration = options?.duration || 20;
  const { targetPages, hardCap: maxSlideCap } = calcPageLimits(targetDuration);
  console.log(`[PPT-V2] Post-plan: Merging thin slides (target=${targetPages}, maxCap=${maxSlideCap} from ${targetDuration}min)...`);
  slides = mergeThinSlides(slides, maxSlideCap);
  console.log(`[PPT-V2] After merge: ${slides.length} slides (cap=${maxSlideCap})`);

  // Stage 6: Commitment check (non-blocking, skip on timeout)
  console.log('[PPT-V2] Stage 6: Commitment check...');
  try {
    slides = await commitmentCheck(slides, papers, options?.runtimeConfig);
    const warnings = slides.filter(s => s.commitmentCheck === 'warning' || s.commitmentCheck === 'fail');
    if (warnings.length > 0) {
      console.log(`[PPT-V2] Commitment warnings: ${warnings.length} slides`);
      warnings.forEach(s => console.log(`  - ${s.type}: ${s.title} → ${s.commitmentNote}`));
    } else {
      console.log('[PPT-V2] All slides pass commitment check');
    }
  } catch (err) {
    console.log(`[PPT-V2] Commitment check skipped (error/timeout): ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Stage 7: Auto-inject figure slides if LLM didn't include them ──
  // This is critical: the LLM may not generate figure_overview/figure_detail/figure_evidence
  // slides, so we inject them based on the figure inventory + discourse matching
  // IMPORTANT: Injection is capped by the duration-based hard limit
  const dur = options?.duration || 20;
  const { hardCap: HARD_CAP } = calcPageLimits(dur);
  const existingFigureSlides = slides.filter(s =>
    s.type === 'figure_overview' || s.type === 'figure_detail' || s.type === 'figure_evidence'
  );
  const existingFigureLabels = new Set(existingFigureSlides.map(s => s.figureLabel).filter(Boolean));

  if (figureInventory.length > 0 && existingFigureSlides.length < figureInventory.length) {
    const figuresToInject = figureInventory.filter(f => !existingFigureLabels.has(f.label));
    // How many figure slides can we inject without exceeding the hard cap?
    const remainingSlots = Math.max(0, HARD_CAP - slides.length);
    if (remainingSlots === 0) {
      console.log(`[PPT-V2] Stage 7: SKIPPED figure injection — already at hard cap (${slides.length}/${HARD_CAP})`);
    } else {
      const injectCount = Math.min(figuresToInject.length, remainingSlots);
      const toInject = figuresToInject.slice(0, injectCount);
      // Prioritize: inject high-importance figures first
      toInject.sort((a, b) => {
        const p = (f: FigureInventory) => f.importance === 'high' ? 0 : f.importance === 'medium' ? 1 : 2;
        return p(a) - p(b);
      });
      console.log(`[PPT-V2] Stage 7: Injecting ${injectCount}/${figuresToInject.length} figure slides (cap=${HARD_CAP}, current=${slides.length})`);

      for (const fig of toInject) {
        const discourseIdx = fig.matchedDiscourseIdx;
        const discourseSection = discourse[discourseIdx];

        let insertAfterIdx = slides.length - 1;
        for (let si = slides.length - 1; si >= 0; si--) {
          const slideType = slides[si].type;
          if (['method', 'result', 'discussion', 'background'].includes(slideType)) {
            insertAfterIdx = si;
            break;
          }
        }

        const figureSlide: EnhancedSlideSpec = {
          type: fig.slideType || 'figure_overview',
          title: `${fig.label}. ${fig.caption?.slice(0, 60) || '图表分析'}`,
          bullets: discourseSection
            ? [`如图${fig.label}所示，${discourseSection.content?.slice(0, 80) || '该图表展示了关键实验结果'}`,
               fig.caption ? `图注: ${fig.caption.slice(0, 100)}` : '详细数据见原文图表']
            : ['图表展示了关键实验结果和数据分析'],
          note: discourseSection?.content?.slice(0, 100) || '',
          figureLabel: fig.label,
          layout: fig.slideType === 'figure_evidence' ? 'text_left_figure_right'
            : fig.slideType === 'figure_detail' ? 'text_right_figure_left'
            : 'text_left_figure_right',
          commitmentCheck: undefined,
        };

        slides.splice(insertAfterIdx + 1, 0, figureSlide);
        console.log(`[PPT-V2] Injected figure slide: ${fig.label} at position ${insertAfterIdx + 1}`);
      }
    }
  } else {
    console.log(`[PPT-V2] Stage 7: No figure injection needed (${existingFigureSlides.length} figure slides already exist)`);
  }

  // ── FINAL HARD CAP — Absolute last resort ──
  // No matter what happened above, we NEVER exceed the duration-based limit
  if (slides.length > HARD_CAP) {
    const cover = slides.find(s => s.type === 'cover');
    const closing = slides.find(s => s.type === 'closing');
    const middle = slides.filter(s => s.type !== 'cover' && s.type !== 'closing');
    // Prioritize: figure_ > method/result/discussion > gap/conclusion > others
    const priority = (s: EnhancedSlideSpec): number => {
      if (s.type.startsWith('figure_')) return 0;
      if (['method', 'result', 'discussion'].includes(s.type)) return 1;
      if (['gap', 'conclusion', 'background', 'mechanism', 'synthesis'].includes(s.type)) return 2;
      return 3;
    };
    const tagged = middle.map((s, i) => ({ s, p: priority(s), i }));
    tagged.sort((a, b) => a.p - b.p || a.i - b.i);
    const keptCount = HARD_CAP - (cover ? 1 : 0) - (closing ? 1 : 0);
    const kept = tagged.slice(0, Math.max(keptCount, 0)).sort((a, b) => a.i - b.i).map(t => t.s);
    const final: EnhancedSlideSpec[] = [];
    if (cover) final.push(cover);
    final.push(...kept);
    if (closing) final.push(closing);
    console.log(`[PPT-V2] ⚠ FINAL HARD CAP: ${slides.length} → ${final.length} (cap=${HARD_CAP}, duration=${options?.duration || 20}min)`);
    slides = final;
  }

  slides = ensureSlideContentFromSources(slides, papers);

  console.log(`[PPT-V2] === Pipeline Complete: ${slides.length} slides (cap=${HARD_CAP}) ===`);
  return slides;
}
