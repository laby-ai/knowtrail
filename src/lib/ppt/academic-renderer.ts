import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import PptxGenJS from 'pptxgenjs';
import { findMinerUFigurePath, type MinerUFigureInput } from '@/lib/ppt/mineru-figures';
import type { PaperInput, PptOptions, SlideSpec, SpeakerNotesGenerator } from '@/lib/ppt/academic-types';

// ── Color palette (from SKILL.md template spec) ──
const C = {
  primary: '054E9F',     // 主蓝
  secondary: '0276BE',   // 次蓝
  dark: '004889',        // 深蓝
  cover: '1E649E',       // 封面蓝
  white: 'FFFFFF',
  black: '1A1A1A',
  red: 'CC0000',         // 科学强调红（仅用于gap/challenge）
  gray: '666666',
  lightGray: 'F5F5F5',
  rule: '054E9F',        // 分隔线
  subtleGray: 'E8E8E8',
};

// ── Asset paths (relative to public/) ──
const ASSETS = {
  logos: {
    ustcHorizontal: 'public/assets/logos/uestc-horizontal.png',
    ustcRoundSeal: 'public/assets/logos/uestc-round-seal.png',
    ucasHorizontal: 'public/assets/logos/ucas-horizontal.png',
    ucasRoundSeal: 'public/assets/logos/ucas-round-seal-blue.png',
    ipcLogoLarge: 'public/assets/logos/ipc-logo-large.png',
    ipcHorizontal: 'public/assets/logos/ipc-horizontal.png',
    ustcSuzhouHorizontal: 'public/assets/logos/uestc-suzhou-institute-horizontal.png',
    campusBackground: 'public/assets/logos/campus-wide-background.jpeg',
    campusBuilding: 'public/assets/logos/campus-building-photo.jpeg',
    thanksCalligraphy: 'public/assets/logos/thanks-calligraphy.png',
  },
};

// Helper: Add page number badge (MiniMax/Claude style — circle badge, bottom-right)
function addPageNumberBadge(slide: PptxGenJS.Slide, pageNum: number, accentColor: string): void {
  const badgeX = 9.3;
  const badgeY = 5.1;
  const badgeSize = 0.36;
  slide.addShape('ellipse' as PptxGenJS.ShapeType, {
    x: badgeX, y: badgeY, w: badgeSize, h: badgeSize,
    fill: { color: accentColor },
  });
  slide.addText(String(pageNum), {
    x: badgeX, y: badgeY, w: badgeSize, h: badgeSize,
    fontSize: 9, fontFace: 'Arial',
    color: 'FFFFFF', bold: true,
    align: 'center', valign: 'middle',
  });
}

// Helper: Add placeholder when no MinerU figure is available
// Add figure placeholder or actual image to a slide
// If imgPath is a valid local file path, insert the actual image; otherwise show placeholder
function addFigurePlaceholder(
  slide: PptxGenJS.Slide,
  imgPath: string | null,
  x: number, y: number, w: number, h: number,
  pptxInstance: PptxGenJS,
  figureLabel?: string,
): void {
  // Check if the image file exists
  const imgExists = imgPath && existsSync(imgPath);

  if (imgExists && imgPath) {
    // Insert actual image from MinerU
    try {
      console.log(`[PPT-V2] Inserting image: ${imgPath} (label=${figureLabel || 'none'})`);
      slide.addImage({
        path: imgPath,
        x, y, w, h,
        sizing: { type: 'contain', w, h },
      });
      // Thin border around image
      slide.addShape(pptxInstance.ShapeType.rect, {
        x, y, w, h,
        line: { color: C.subtleGray, width: 0.75 },
        fill: { type: 'none' },
        rectRadius: 0.04,
      });
    } catch (err) {
      console.log(`[PPT-V2] Image insert failed: ${err instanceof Error ? err.message : String(err)}`);
      // Image insert failed, fall through to placeholder
      addFigurePlaceholderBox(slide, x, y, w, h, pptxInstance, figureLabel);
    }
  } else {
    console.log(`[PPT-V2] No image file for figure (label=${figureLabel || 'none'}, path=${imgPath || 'null'})`);
    // Show dashed placeholder box
    addFigurePlaceholderBox(slide, x, y, w, h, pptxInstance, figureLabel);
  }
}

// Dashed placeholder box when no MinerU figure is available
function addFigurePlaceholderBox(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  pptxInstance: PptxGenJS,
  figureLabel?: string,
): void {
  slide.addShape(pptxInstance.ShapeType.rect, {
    x, y, w, h,
    fill: { color: C.lightGray }, rectRadius: 0.08,
  });
  slide.addShape(pptxInstance.ShapeType.rect, {
    x, y, w, h,
    line: { color: C.primary, dashType: 'dash', width: 1.5 },
    fill: { type: 'none' },
  });
  slide.addText([
    { text: '📊 ', options: { fontSize: 20 } },
    { text: figureLabel ? `${figureLabel} 论文原图区域` : '论文图表区域', options: { fontSize: 12, color: C.gray } },
    { text: '\n\n', options: {} },
    { text: 'MinerU 未提取到此图表\n请在 PowerPoint 中手动替换', options: { fontSize: 10, color: C.gray } },
  ], {
    x, y, w, h,
    align: 'center', valign: 'middle', fontFace: 'Microsoft YaHei',
  });
}

// ============================================================
// Step 2: Build PPTX with pptxgenjs
// Full implementation of SKILL.md layout specifications
// ============================================================
export async function buildAcademicPptx(
  papers: PaperInput[],
  slides: SlideSpec[],
  options?: PptOptions,
  mineruFiguresForBuild?: MinerUFigureInput[],
  speakerNotesGenerator?: SpeakerNotesGenerator,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in = 16:9
  pptx.author = 'EvidenceTalk Academic Assistant';
  pptx.title = papers.map(p => p.title).join(' / ');
  pptx.subject = '学术文献报告';

  const inst = options?.institution || 'generic';
  const closeStyle = options?.closingStyle || 'blue';

  // ── Resolve logo path helper ──
  async function getAssetPath(assetRelPath: string): Promise<string | null> {
    try {
      const fullPath = path.join(process.cwd(), assetRelPath);
      await readFile(fullPath); // verify exists
      return fullPath;
    } catch {
      return null;
    }
  }

  // ── Reusable style objects (ArcDeck visuals.py + SKILL.md spec) ──
  const TITLE_FONT = 'SimSun'; // Serif for academic titles (SKILL.md §1)
  const BODY_FONT = 'Microsoft YaHei'; // Sans-serif body (readability)
  const CAPTION_FONT = 'Arial'; // Italic captions (SKILL.md §4.3)
  const CITATION_FONT = 'Arial'; // Italic citations (SKILL.md §4.2)

  const headerTitleOpts: PptxGenJS.TextPropsOptions = {
    fontSize: 28, bold: true, color: C.primary, align: 'center',
    fontFace: TITLE_FONT, valign: 'middle', // Serif title per SKILL.md
  };
  const subTitleOpts: PptxGenJS.TextPropsOptions = {
    fontSize: 18, bold: false, color: C.primary, align: 'left',
    fontFace: BODY_FONT, valign: 'middle', italic: true,
  };
  const bodyOpts: PptxGenJS.TextPropsOptions = {
    fontSize: 14, color: C.black, fontFace: BODY_FONT,
    lineSpacingMultiple: 1.5, valign: 'top',
  };
  const bulletOpts: PptxGenJS.TextPropsOptions = {
    fontSize: 14, color: C.black, fontFace: BODY_FONT,
    lineSpacingMultiple: 1.45, bullet: { type: 'bullet' },
  };
  const emphasisOpts: PptxGenJS.TextPropsOptions = {
    fontSize: 15, bold: true, color: C.primary, fontFace: BODY_FONT,
    lineSpacingMultiple: 1.45, bullet: { type: 'bullet' },
  };
  const captionOpts: PptxGenJS.TextPropsOptions = {
    fontSize: 11, color: C.gray, fontFace: BODY_FONT, italic: true,
    align: 'center', valign: 'bottom',
  };
  const citeOpts: PptxGenJS.TextPropsOptions = {
    fontSize: 10, color: C.gray, fontFace: 'Arial', italic: true,
  };

  // ── Build citation string (SKILL.md §4.2: CASSI format) ──
  // Format: "Zhang Y.; Li X*. et al. J Clin Invest 2024; 134(5): e123456."
  const mainPaper = papers[0];
  const buildCitation = (): string => {
    if (!mainPaper) return '';
    const authors = mainPaper.authors.filter(author => author.trim() && !/^(unknown|未解析作者|未知作者)$/i.test(author.trim()));
    return [authors.join(', '), mainPaper.title, mainPaper.journal,
      mainPaper.year ? String(mainPaper.year) : '', mainPaper.doi ? `doi:${mainPaper.doi}` : '']
      .filter(Boolean).join('. ');
  };
  const citation = buildCitation();

  // ── Helper: add academic header (title + blue rule + optional seal) ──
  function addAcademicHeader(
    slide: PptxGenJS.Slide,
    titleText: string,
    showSeal: boolean = false,
  ) {
    // Title centered at top
    slide.addText(titleText, {
      x: 0.5, y: 0.25, w: 12.33, h: 0.55,
      ...headerTitleOpts,
    });
    // Thin blue rule below title (template spec: y~67px ≈ 0.93in)
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: 0.85, w: 12.33, h: 0.05,
      fill: { color: C.rule },
    });
    // Optional round seal at upper right
    if (showSeal) {
      const sealPath = inst === 'ustc' ? ASSETS.logos.ustcRoundSeal
        : inst === 'ustc-suzhou' ? ASSETS.logos.ustcRoundSeal
        : inst === 'ucas' ? ASSETS.logos.ucasRoundSeal
        : inst === 'ipc' ? ASSETS.logos.ipcLogoLarge
        : null;
      if (sealPath && existsSync(path.join(process.cwd(), sealPath))) {
        slide.addImage({
          path: path.join(process.cwd(), sealPath),
          x: 12.0, y: 0.1, w: 0.85, h: 0.75,
          sizing: { type: 'contain', w: 0.85, h: 0.75 },
        });
      }
    }
  }

  // ── Helper: add citation footer (SKILL.md §4.2) ──
  function addCitationFooter(slide: PptxGenJS.Slide) {
    if (!citation) return;
    slide.addText(citation, {
      x: 0.5, y: 7.05, w: 10.0, h: 0.35,
      ...citeOpts, fontSize: 9, fontFace: CITATION_FONT,
    });
  }

  // ── Helper: add page number ──
  function addPageNumber(slide: PptxGenJS.Slide, num: number, total: number) {
    slide.addText(`${num} / ${total}`, {
      x: 11.8, y: 7.05, w: 1.0, h: 0.35,
      fontSize: 9, color: C.gray, fontFace: CAPTION_FONT, align: 'right',
    });
  }

  // ════════════════════════════════════════════════════════
  // BUILD EACH SLIDE
  // ════════════════════════════════════════════════════════
  const totalSlides = slides.length;
  const figureSlideCounter = 0; // Track how many figure slides we've processed for fallback matching
  const usedFigurePaths = new Set<string>(); // Dedup: prevent same image inserted on multiple slides
  const pptxSlideRefs: PptxGenJS.Slide[] = []; // Collect slide refs for speaker notes

  for (let idx = 0; idx < slides.length; idx++) {
    const spec = slides[idx];
    const slide = pptx.addSlide();
    const pageNum = idx + 1;
    console.log(`[PPT-V2] Building slide ${pageNum}: type=${spec.type}, title=${(spec.title||'').slice(0,40)}, figureLabel=${spec.figureLabel||'none'}`);

    // ═══════════════════════════════════════════════════════════════
    // UNIFIED ACADEMIC SLIDE RENDERER (SKILL.md compliant)
    // 3 renderers: renderCover / renderContent / renderClosing
    // ═══════════════════════════════════════════════════════════════

    // UNIFIED ACADEMIC SLIDE RENDERER (SKILL.md compliant)
    // 3 renderers: renderCover / renderContent / renderClosing

    slide.background = { color: C.white }; // SKILL.md: white background

    // ── COVER PAGE ──
    if (spec.type === 'cover') {
      // Top blue banner (SKILL.md §2: institution color band)
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: C.primary } });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.1, w: '100%', h: 0.04, fill: { color: C.rule } });
      // Institution name in banner
      const instName = { generic: '学术文献报告', ustc: '中国科学技术大学', 'ustc-suzhou': '中国科大苏州', ucas: '中国科学院大学', ipc: '中科院物理所' }[options?.institution || 'generic'] || '学术文献报告';
      slide.addText(instName, { x: 0.8, y: 0.3, w: 8.4, h: 0.5, fontSize: 14, fontFace: BODY_FONT, color: C.white, bold: true });
      // Title
      const paperTitle = spec.title || papers[0]?.title;
      slide.addText(paperTitle, { x: 0.8, y: 1.6, w: 8.4, h: 1.6, fontSize: 26, fontFace: TITLE_FONT, color: C.black, bold: true, lineSpacingMultiple: 1.3 });
      // Metadata table
      const metaRows: Record<string, unknown>[][] = [];
      if (papers[0]?.authors?.length) metaRows.push([{ text: '作者: ', options: { fontSize: 11, fontFace: BODY_FONT, color: C.gray, bold: true } }, { text: papers[0].authors.join(', '), options: { fontSize: 11, fontFace: BODY_FONT, color: C.dark } }]);
      if (options?.presenterName) metaRows.push([{ text: '汇报人: ', options: { fontSize: 11, fontFace: BODY_FONT, color: C.gray, bold: true } }, { text: options.presenterName, options: { fontSize: 11, fontFace: BODY_FONT, color: C.dark } }]);
      if (options?.advisorName) metaRows.push([{ text: '指导老师: ', options: { fontSize: 11, fontFace: BODY_FONT, color: C.gray, bold: true } }, { text: options.advisorName, options: { fontSize: 11, fontFace: BODY_FONT, color: C.dark } }]);
      if (papers[0]?.year) metaRows.push([{ text: '年份: ', options: { fontSize: 11, fontFace: BODY_FONT, color: C.gray, bold: true } }, { text: String(papers[0].year), options: { fontSize: 11, fontFace: BODY_FONT, color: C.dark } }]);
      if (metaRows.length > 0) {
        slide.addTable(metaRows, { x: 0.8, y: 3.6, w: 8.4, colW: [1.5, 6.9], border: { type: 'none' }, rowH: [0.32] });
      }
      // Bottom blue line
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 5.15, w: '100%', h: 0.04, fill: { color: C.primary } });
      pptxSlideRefs.push(slide);
      continue;
    }

    // ── AUTHOR PAGE ──
    if (spec.type === 'author') {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.04, fill: { color: C.primary } });
      slide.addText(spec.title || '作者信息', { x: 0.8, y: 0.3, w: 8.4, h: 0.7, fontSize: 24, fontFace: TITLE_FONT, color: C.primary, bold: true });
      slide.addShape(pptx.ShapeType.rect, { x: 0.8, y: 1.0, w: 1.2, h: 0.04, fill: { color: C.rule } });
      const authorBullets = (spec.bullets || []).map(b => ({ text: b, options: { fontSize: 13, fontFace: BODY_FONT, color: C.dark, bullet: { type: 'number' as const }, lineSpacingMultiple: 1.6, paraSpaceAfter: 4 } }));
      if (authorBullets.length > 0) slide.addText(authorBullets as PptxGenJS.TextProps[], { x: 0.8, y: 1.3, w: 8.4, h: 3.5, valign: 'top' });
      addPageNumberBadge(slide, pageNum, C.rule);
      pptxSlideRefs.push(slide);
      continue;
    }

    // ── CLOSING PAGE ──
    if (spec.type === 'closing') {
      slide.background = { color: C.primary };
      const closingBullets = (spec.bullets || []).slice(0, 3);
      slide.addText(spec.title || '结论与下一步', { x: 0.7, y: 0.65, w: 8.6, h: 0.6, fontSize: 28, fontFace: TITLE_FONT, color: C.white, bold: true, align: 'center' });
      slide.addShape(pptx.ShapeType.rect, { x: 1.05, y: 1.45, w: 7.9, h: 0.02, fill: { color: 'FFFFFF', transparency: 35 } });
      closingBullets.forEach((bullet, i) => {
        slide.addText(`${i + 1}`, {
          x: 1.05,
          y: 1.75 + i * 0.72,
          w: 0.38,
          h: 0.38,
          fontSize: 12,
          fontFace: TITLE_FONT,
          color: C.primary,
          bold: true,
          align: 'center',
          valign: 'middle',
          fill: { color: C.white, transparency: 0 },
          margin: 0.03,
        });
        slide.addText(bullet, {
          x: 1.55,
          y: 1.68 + i * 0.72,
          w: 7.1,
          h: 0.55,
          fontSize: 15,
          fontFace: BODY_FONT,
          color: C.white,
          breakLine: false,
          fit: 'shrink',
        });
      });
      if (options?.presenterName) {
        slide.addText(`汇报人: ${options.presenterName}`, { x: 1, y: 4.65, w: 8, h: 0.4, fontSize: 12, fontFace: BODY_FONT, color: 'FFFFFF', transparency: 40, align: 'center' });
      }
      pptxSlideRefs.push(slide);
      continue;
    }

    // ── CITATION PAGE ──
    if (spec.type === 'citation') {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.04, fill: { color: C.primary } });
      slide.addText(spec.title || '参考文献', { x: 0.8, y: 0.3, w: 8.4, h: 0.7, fontSize: 24, fontFace: TITLE_FONT, color: C.primary, bold: true });
      slide.addShape(pptx.ShapeType.rect, { x: 0.8, y: 1.0, w: 1.2, h: 0.04, fill: { color: C.rule } });
      const citBullets = (spec.bullets || []).map(b => ({ text: b, options: { fontSize: 9, fontFace: CITATION_FONT, color: C.gray, bullet: { type: 'number' as const }, lineSpacingMultiple: 1.4, paraSpaceAfter: 3 } }));
      if (citBullets.length > 0) slide.addText(citBullets as PptxGenJS.TextProps[], { x: 0.8, y: 1.2, w: 8.4, h: 3.8, valign: 'top' });
      addPageNumberBadge(slide, pageNum, C.rule);
      pptxSlideRefs.push(slide);
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // UNIFIED CONTENT PAGE RENDERER
    // All content pages share: header + accent bar + content + footer + page badge
    // ═══════════════════════════════════════════════════════════════

    // Type-specific config
    const TYPE_CONFIG: Record<string, { accentColor: string; sectionLabel: string; icon: string }> = {
      toc:         { accentColor: C.dark,       sectionLabel: '目录',     icon: '' },
      background:  { accentColor: C.rule,       sectionLabel: '研究背景', icon: '' },
      gap:         { accentColor: 'DC2626',      sectionLabel: '研究问题', icon: '' },
      roadmap:     { accentColor: C.rule,       sectionLabel: '论文概览', icon: '' },
      method:      { accentColor: C.primary,    sectionLabel: '研究方法', icon: '' },
      result:      { accentColor: '16A34A',      sectionLabel: '结果与证据', icon: '' },
      discussion:  { accentColor: '7C3AED',      sectionLabel: '讨论分析', icon: '' },
      conclusion:  { accentColor: C.dark,       sectionLabel: '核心结论', icon: '' },
      mechanism:   { accentColor: C.rule,       sectionLabel: '机制原理', icon: '' },
      synthesis:   { accentColor: C.primary,    sectionLabel: '综合分析', icon: '' },
      figure_overview:  { accentColor: C.rule,  sectionLabel: '图表分析', icon: '' },
      figure_detail:    { accentColor: C.rule,  sectionLabel: '图表解读', icon: '' },
      figure_evidence:  { accentColor: C.rule,  sectionLabel: '数据证据', icon: '' },
    };
    const cfg = TYPE_CONFIG[spec.type] || { accentColor: C.rule, sectionLabel: '', icon: '' };

    // ── Header: top line + section label + title + accent bar ──
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.04, fill: { color: C.primary } });
    if (cfg.sectionLabel) {
      slide.addText(cfg.sectionLabel, { x: 0.8, y: 0.2, w: 2.5, h: 0.35, fontSize: 10, fontFace: BODY_FONT, color: cfg.accentColor, bold: true });
    }
    slide.addText(spec.title, { x: 0.8, y: 0.5, w: 8.4, h: 0.65, fontSize: 22, fontFace: TITLE_FONT, color: C.black, bold: true });
    // Accent bar under title
    slide.addShape(pptx.ShapeType.rect, { x: 0.8, y: 1.15, w: 1.2, h: 0.05, fill: { color: cfg.accentColor } });

    // Keep comparison cells and simple sequential relations editable in the exported file.
    if (spec.table || spec.flow) {
      const caption = (spec.bullets || []).join('\n');
      if (caption) slide.addText(caption, { x: 0.8, y: 1.4, w: 11.7, h: 1.1, fontFace: BODY_FONT, fontSize: 16, color: C.gray, valign: 'top', paraSpaceAfter: 3 });
      if (spec.table) {
        const rows: PptxGenJS.TableRow[] = [
          spec.table.headers.map(text => ({ text, options: { bold: true, color: C.white, fill: C.primary } })),
          ...spec.table.rows.map(row => row.map(text => ({ text }))),
        ];
        slide.addTable(rows, { x: 0.8, y: 2.65, w: 11.7, colW: Array(spec.table.headers.length).fill(11.7 / spec.table.headers.length), rowH: 0.6, autoPage: false, fontFace: BODY_FONT, fontSize: 15, color: C.dark, margin: 0.08, border: { type: 'solid', color: C.subtleGray, pt: 1 }, valign: 'middle' });
      } else if (spec.flow) {
        const gap = 0.38;
        const width = (11.7 - gap * (spec.flow.steps.length - 1)) / spec.flow.steps.length;
        spec.flow.steps.forEach((step, i) => {
          const x = 0.8 + i * (width + gap);
          slide.addShape(pptx.ShapeType.roundRect, { x, y: 3.1, w: width, h: 1.6, fill: { color: C.lightGray }, line: { color: C.primary, width: 1.2 } });
          slide.addText(step, { x: x + 0.1, y: 3.25, w: width - 0.2, h: 1.3, fontFace: BODY_FONT, fontSize: 18, color: C.dark, align: 'center', valign: 'middle', margin: 0.05 });
          if (i < spec.flow!.steps.length - 1) slide.addShape(pptx.ShapeType.line, { x: x + width, y: 3.9, w: gap, h: 0, line: { color: C.primary, width: 1.5, endArrowType: 'triangle' } });
        });
      }
      slide.addNotes((spec.table || spec.flow)!.sourceText);
      addCitationFooter(slide);
      addPageNumber(slide, idx + 1, slides.length);
      pptxSlideRefs.push(slide);
      continue;
    }

    // ── Figure handling (if this page has a figure) ──
    const figPath = findMinerUFigurePath(options?.mineruFigures ?? [], spec.figureLabel, idx);
    let figureUsed = false;
    if (figPath && !usedFigurePaths.has(figPath)) {
      usedFigurePaths.add(figPath);
      figureUsed = true;
    } else if (figPath && usedFigurePaths.has(figPath)) {
      figureUsed = false; // dedup: skip, show text only
    }

    // ── Content area: figure + text, or text only ──
    const contentTop = 1.4;
    const contentBottom = 4.7;
    const contentHeight = contentBottom - contentTop;

    if (figureUsed) {
      // LEFT: text, RIGHT: figure (SKILL.md standard)
      const textW = 4.8;
      const figW = 3.8;
      const figX = 5.4;
      const textX = 0.8;
      // Text bullets
      const bullets = (spec.bullets || []).map((b: string, bi: number) => {
        const isEmph = spec.emphasisIndices?.includes(bi);
        return {
          text: b,
          options: {
            fontSize: isEmph ? 14 : 12,
            fontFace: BODY_FONT,
            color: isEmph ? cfg.accentColor : C.dark,
            bold: isEmph,
            bullet: isEmph ? { type: 'bullet', characterCode: '25CF', indent: 12 } : { type: 'bullet', characterCode: '25CB', indent: 12 },
            lineSpacingMultiple: 1.5,
            paraSpaceAfter: 3,
          },
        };
      });
      if (bullets.length > 0) {
        slide.addText(bullets as PptxGenJS.TextProps[], { x: textX, y: contentTop, w: textW, h: contentHeight, valign: 'top' });
      }
      // Figure image
      addFigurePlaceholder(slide, figPath, figX, contentTop, figW, contentHeight * 0.85, pptx);
      // Figure caption (SKILL.md §4.3)
      const figCaption = spec.figureLabel ? `${spec.figureLabel}` : '';
      if (figCaption) {
        slide.addText(figCaption, { x: figX, y: contentTop + contentHeight * 0.88, w: figW, h: 0.3, fontSize: 8, fontFace: CAPTION_FONT, color: C.gray, italic: true, align: 'center' });
      }
    } else {
      // TEXT ONLY: full-width bullets
      const bullets = (spec.bullets || []).map((b: string, bi: number) => {
        const isEmph = spec.emphasisIndices?.includes(bi);
        return {
          text: b,
          options: {
            fontSize: isEmph ? 14 : 12,
            fontFace: BODY_FONT,
            color: isEmph ? cfg.accentColor : C.dark,
            bold: isEmph,
            bullet: isEmph ? { type: 'bullet', characterCode: '25CF', indent: 12 } : { type: 'bullet', characterCode: '25CB', indent: 12 },
            lineSpacingMultiple: 1.5,
            paraSpaceAfter: 4,
          },
        };
      });
      if (bullets.length > 0) {
        slide.addText(bullets as PptxGenJS.TextProps[], { x: 0.8, y: contentTop, w: 8.4, h: contentHeight, valign: 'top' });
      }
    }

    // ── Citation footer (SKILL.md §4.2) ──
    addCitationFooter(slide);

    // ── Page number badge (bottom-right, SKILL.md mandatory) ──
    addPageNumber(slide, idx + 1, slides.length);

    pptxSlideRefs.push(slide);
  }

  // ── Generate speaker notes if requested (ArcDeck Phase 8 optional) ──
  if (options?.speakerNotes) {
    console.log('[PPT-V2] Generating speaker notes for all slides...');
    try {
      if (!speakerNotesGenerator) {
        console.log('[PPT-V2] Speaker notes requested but no generator was provided.');
        throw new Error('speakerNotesGenerator not provided');
      }
      const notes = await speakerNotesGenerator(papers, slides, options?.runtimeConfig);
      // Apply notes to each pptxgenjs slide we collected during build
      for (let ni = 0; ni < notes.length && ni < pptxSlideRefs.length; ni++) {
        pptxSlideRefs[ni].addNotes(notes[ni]);
      }
      console.log(`[PPT-V2] Speaker notes added to ${Math.min(notes.length, pptxSlideRefs.length)} slides`);
    } catch (err) {
      console.log(`[PPT-V2] Speaker notes generation failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Export to buffer
  const out = await pptx.write({ outputType: 'nodebuffer' }) as unknown as Buffer;
  return out;
}
