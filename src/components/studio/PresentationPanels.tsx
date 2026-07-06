'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Presentation,
  Volume2,
  Layers,
  Download,
  Clock,
  TrendingUp,
  Sparkles,
  Loader2,
  Square,
  Circle,
  Wand2,
  ThumbsUp,
  Bookmark,
  Share2,
  Eye,
  Send,
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  Monitor,
  FileText,
  Languages,
  Layout,
  BookOpen,
  Cpu,
  Lightbulb,
  ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { Citation, RetrievalMetadata } from '@/types';
import NarrationPlayer from './NarrationPlayer';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';
import { PresentationModeSelector, type PresentationMode } from './PresentationModeSelector';
import { StructuredPresentationPanel } from './StructuredPresentationPanel';
import { HtmlPresentationPanel } from './HtmlPresentationPanel';
import { SlideAnnotationEditor } from './SlideAnnotationEditor';

export function PresentationWorkspacePanel({ initialMode = 'image' }: { initialMode?: PresentationMode }) {
  const [mode, setMode] = useState<PresentationMode>(initialMode);

  return (
    <div className="space-y-5" data-testid="presentation-workspace-panel">
      <PresentationModeSelector mode={mode} onModeChange={setMode} />

      {mode === 'image' ? <PresentationPanel /> : mode === 'html' ? <HtmlPresentationPanel /> : <StructuredPresentationPanel />}
    </div>
  );
}

/* ============ 演示文稿面板 ============ */

// ─── 8 种预设视觉风格（对齐 banana-slides presetStyles.ts） ───
interface PresetStyle {
  id: string;
  label: string;
  color: string;
  visualPrompt: string; // 完整视觉描述，直接传给生图模型
}

const PRESET_STYLES: PresetStyle[] = [
  { id: 'academic', label: '学术严谨', color: '#1E3A5F', visualPrompt: 'Classic academic paper / high-quality printed research report style, pure white background (#FFFFFF), black (#000000) and charcoal gray (#374151) as primary colors, deep navy blue (#1E3A5F) accent only under 5% usage, Times New Roman or Garamond serif font family, wide margins with left-right column layout or strict top-bottom alignment, thin black divider lines, three-line academic tables, B&W line art illustrations, no book edges no curled corners no shadows no borders no 3D backgrounds' },
  { id: 'modern', label: '现代简约', color: '#6B7280', visualPrompt: 'Ultra-minimalist modernist presentation, pure white background (#FFFFFF), deep gray (#111827) text, medium gray (#6B7280) secondary info, single accent color in deep blue or black with minimal usage, generous whitespace, large clean sans-serif typography (Inter/Helvetica), one core idea per slide, Apple/Stripe level simplicity, no gradients no patterns no textures' },
  { id: 'tech', label: '科技未来', color: '#7C3AED', visualPrompt: 'Futuristic tech aesthetic, dark midnight background (#0B0F19), neon electric blue (#00A3FF) and cyber purple (#7C3AED) linear gradients, glowing grid lines, holographic glassmorphism cards, 3D wireframe geometric elements, volumetric lighting, C4D render style, digital interface feel' },
  { id: 'nature', label: '自然清新', color: '#14532D', visualPrompt: 'Nature-fresh organic style, warm beige background (#EAD9C6), forest green (#14532D), earth brown (#7A4E2D), sky blue (#38BDF8), natural textures like recycled paper grain and plant veins, extended green plant leaves as background decoration, round friendly typography, slightly loose organic layout, soft natural shadows, macro photography meets 3D render, subsurface scattering on plant surfaces' },
  { id: 'elegant', label: '优雅经典', color: '#D4AF37', visualPrompt: 'Luxury premium presentation, deep charcoal background (#1C1917), gold (#D4AF37) and champagne (#F7E7CE) accents, elegant serif typography for titles, generous white space, metallic textures, marble and silk material feel, symmetric layout, Vogue magazine style' },
  { id: 'creative', label: '创意趣味', color: '#FF6A00', visualPrompt: 'Creative playful design, bright warm white background (#FFF7ED), vibrant orange (#FF6A00) primary accent, bright blue (#0EA5E9) and fresh green (#22C55E) secondary colors, rounded shapes, hand-drawn illustrations, fun and energetic atmosphere, doodle elements, youth-friendly appearance' },
];

type PPTStyleId = typeof PRESET_STYLES[number]['id'];

// ─── 细节等级（对齐 banana-slides DETAIL_LEVEL_SPECS） ───
interface DetailLevel {
  id: string;
  label: string;
  desc: string;
}

const DETAIL_LEVELS: DetailLevel[] = [
  { id: 'concise', label: '精简', desc: '极致压缩，核心数据' },
  { id: 'default', label: '标准', desc: '清晰明了，15-20字/条' },
  { id: 'detailed', label: '详实', desc: '内容丰富，逻辑完整' },
] as const;

type DetailLevelId = typeof DETAIL_LEVELS[number]['id'];

// ─── 语言选项（对齐 banana-slides） ───
const LANG_OPTIONS = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
] as const;

type LangId = typeof LANG_OPTIONS[number]['id'];

// ─── 宽高比选项（只保留常用两种） ───
const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9 宽屏' },
  { id: '4:3', label: '4:3 标准' },
];

function PresentationPanel() {
  const { slides, setSlides, getSelectedPapers, aiConfig, storageScopeKey } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressStage, setProgressStage] = useState('');
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [selectedStyle, setSelectedStyle] = useState<PPTStyleId>('academic');
  const [selectedDetailLevel, setSelectedDetailLevel] = useState<DetailLevelId>('default');
  const [selectedLang, setSelectedLang] = useState<LangId>('zh');
  const [pageCount, setPageCount] = useState(8);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('16:9');
  const [isExporting, setIsExporting] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [annotatingIdx, setAnnotatingIdx] = useState<number | null>(null);
  // Per-slide previous image versions (annotation revisions), for rollback.
  const [revisionHistory, setRevisionHistory] = useState<Record<string, string[]>>({});
  const [imageCompleted, setImageCompleted] = useState(0);
  const [imageTotal, setImageTotal] = useState(0);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [pptCitations, setPptCitations] = useState<Citation[]>([]);
  const [pptRetrieval, setPptRetrieval] = useState<RetrievalMetadata | null>(null);
  const thumbnailScrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get selected style's visual prompt
  const currentStyleVisualPrompt = PRESET_STYLES.find(s => s.id === selectedStyle)?.visualPrompt || PRESET_STYLES[0].visualPrompt;

  // Lightbox keyboard navigation
  useEffect(() => {
    if (lightboxIdx === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      if (e.key === 'ArrowLeft' && lightboxIdx > 0) setLightboxIdx(lightboxIdx - 1);
      if (e.key === 'ArrowRight' && lightboxIdx < slides.length - 1) setLightboxIdx(lightboxIdx + 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIdx, slides.length]);

  const handleGenerate = useCallback(async () => {
    const papers = getSelectedPapers();
    if (papers.length === 0) {
      alert('请先在左侧选择要生成 PPT 的资料');
      return;
    }
    // Clear current PPT and reset
    setSlides([]);
    setActiveSlideIdx(0);
    setLightboxIdx(null);
    setImageCompleted(0);
    setImageTotal(0);
    setGenerationNotice(null);
    setGenerationError(null);
    setPptCitations([]);
    setPptRetrieval(null);
    setIsGenerating(true);
    setProgressStage('outline');
    setProgressMsg('正在生成 PPT 大纲...');
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/ai/ppt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          notebookId,
          papers: papers.map(p => ({
            id: p.id,
            title: p.title,
            authors: p.authors,
            year: p.year,
            shortName: p.shortName,
            fileName: p.fileName,
            fileType: p.fileType,
            abstract: p.abstract,
            content: p.content,
            rawContent: p.rawContent,
          })),
          aiConfig,
          pageCount,
          templateStyle: currentStyleVisualPrompt,
          style: selectedStyle,
          detailLevel: selectedDetailLevel,
          language: selectedLang,
          aspectRatio: selectedAspectRatio,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('PPT 生成请求失败');
      }

      // Read SSE stream for progress
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalSlides: { title: string; content: string; imageUrl: string | null; narration?: string; part?: string }[] = [];
      let responseCitations: Citation[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          try {
            const data = JSON.parse(payload);
            if (Array.isArray(data.citations)) {
              responseCitations = data.citations as Citation[];
              setPptCitations(responseCitations);
            }
            if (data.retrieval) {
              setPptRetrieval(data.retrieval as RetrievalMetadata);
            }
            if (data.stage === 'outline') {
              setProgressStage('outline');
              setProgressMsg(data.message);
            } else if (data.stage === 'description') {
              setProgressStage('description');
              setProgressMsg(data.message);
            } else if (data.stage === 'image') {
              setProgressStage('image');
              setProgressMsg(data.message);
              if (data.imageTotal) setImageTotal(data.imageTotal);
              if (data.imageCompleted !== undefined) setImageCompleted(data.imageCompleted);
            } else if (data.stage === 'narration') {
              setProgressStage('narration');
              setProgressMsg(data.message);
            } else if (data.stage === 'done') {
              finalSlides = data.slides || [];
            } else if (data.stage === 'error') {
              throw new Error(data.message);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'PPT 生成请求失败') throw e;
          }
        }
      }

      // Set slides in context
      const newSlides: typeof slides = finalSlides.map((slide, i) => ({
        id: `slide-${Date.now()}-${i}`,
        order: i,
        title: slide.title,
        content: slide.content,
        imageUrl: slide.imageUrl,
        narration: slide.narration || '',
        citations: responseCitations,
      }));
      setSlides(newSlides);
      setActiveSlideIdx(0);
      setProgressMsg('');
      setProgressStage('');
    } catch (err) {
      const aborted = abortController.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      if (aborted) {
        setGenerationNotice('已取消生成，可以调整资料、页数或风格后重新开始。');
      } else {
        setGenerationError(err instanceof Error ? err.message : 'PPT 生成失败');
      }
      setProgressMsg('');
      setProgressStage('');
      setImageCompleted(0);
    } finally {
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, [getSelectedPapers, aiConfig, notebookId, pageCount, currentStyleVisualPrompt, selectedStyle, selectedDetailLevel, selectedLang, selectedAspectRatio, setSlides]);

  const handleCancelGenerate = useCallback(() => {
    if (!isGenerating) return;
    setProgressMsg('正在取消生成...');
    abortControllerRef.current?.abort();
  }, [isGenerating]);

  // Export to PPTX
  const handleExportPPTX = useCallback(async () => {
    if (slides.length === 0) return;
    setIsExporting(true);
    try {
      const PptxGenJS = (await import('pptxgenjs')).default;
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_16x9';

      for (const slide of slides) {
        const pptSlide = pptx.addSlide();
        if (slide.imageUrl) {
          pptSlide.addImage({
            path: slide.imageUrl,
            x: 0, y: 0, w: '100%', h: '100%',
          });
        } else {
          pptSlide.background = { color: '1a1a2e' };
          pptSlide.addText(slide.title, {
            x: 0.8, y: 0.6, w: '80%', h: 1.2,
            fontSize: 28, color: 'FFFFFF', bold: true,
          });
          pptSlide.addText(slide.content, {
            x: 0.8, y: 2.0, w: '80%', h: 3.5,
            fontSize: 14, color: 'CCCCCC', lineSpacing: 22,
          });
        }
      }

      await pptx.writeFile({ fileName: `${slides[0]?.title || 'presentation'}.pptx` });
    } catch (err) {
      console.error('[PPT] Export error:', err);
      alert('导出失败：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setIsExporting(false);
    }
  }, [slides]);

  const currentSlide = slides[activeSlideIdx];
  const hasSelectedPapers = getSelectedPapers().length > 0;

  return (
    <div className="relative space-y-4" data-testid="image-ppt-panel">
      {/* Apple-style ambient glow */}
      <div className="absolute -top-20 left-[10%] w-[80%] h-48 bg-blue-600/[0.04] blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute top-32 -right-10 w-[50%] h-36 bg-amber-500/[0.03] blur-[100px] rounded-full pointer-events-none" />

      {/* ── Style selector ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-[12px] font-semibold text-[var(--text-secondary)]">
          <span className="flex items-center gap-2">
          <Layout size={13} /> 简报风格
          </span>
          <span className="text-[10px] font-medium text-[var(--text-quaternary)]">选择一种</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PRESET_STYLES.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedStyle(s.id)}
              className={`presentation-template-card spotlight-glass-card group flex min-h-[42px] items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
                selectedStyle === s.id
                  ? 'presentation-template-card-selected text-[var(--text-primary)]'
                  : 'text-[var(--text-primary)]'
              }`}
            >
              <span className="flex h-7 w-4 shrink-0 items-center justify-center">
                <span
                  className="h-6 w-1.5 rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                  style={{ backgroundColor: s.color }}
                />
              </span>
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate text-[12px] font-semibold leading-tight">
                  {s.label}
                </span>
                {selectedStyle === s.id && (
                  <Check size={13} className="shrink-0 text-blue-500" />
                )}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Settings grid ── */}
      <div className="liquid-glass-card p-4 space-y-4">
        {/* Aspect Ratio + Detail Level */}
        <div className="grid grid-cols-2 gap-4">
          {/* Aspect Ratio */}
          <div className="space-y-3">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
              <Monitor className="w-3.5 h-3.5" /> 画面比例
            </label>
            <div className="bg-[var(--glass-subtle)] p-1 rounded-2xl flex gap-1">
              {ASPECT_RATIOS.map(ar => (
                <button
                  key={ar.id}
                  onClick={() => setSelectedAspectRatio(ar.id)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    selectedAspectRatio === ar.id
                      ? 'bg-[var(--glass-active)] text-[var(--text-primary)] ring-1 ring-blue-500/30 shadow-sm'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          </div>

          {/* Detail Level */}
          <div className="space-y-3">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
              <FileText className="w-3.5 h-3.5" /> 内容详略
            </label>
            <div className="bg-[var(--glass-subtle)] p-1 rounded-2xl flex gap-1">
              {DETAIL_LEVELS.map(d => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDetailLevel(d.id as DetailLevelId)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    selectedDetailLevel === d.id
                      ? 'bg-[var(--glass-active)] text-[var(--text-primary)] ring-1 ring-blue-500/30 shadow-sm'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Language + Page Count */}
        <div className="grid grid-cols-2 gap-4">
          {/* Language */}
          <div className="space-y-3">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
              <Languages className="w-3.5 h-3.5" /> 输出语言
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {LANG_OPTIONS.map(l => (
                <button
                  key={l.id}
                  onClick={() => setSelectedLang(l.id as LangId)}
                  className={`py-2.5 rounded-xl text-xs font-medium border transition-all ${
                    selectedLang === l.id
                      ? 'bg-[var(--glass-active)] text-[var(--text-primary)] border-blue-500/30 shadow-sm'
                      : 'bg-[var(--glass-subtle)] border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--glass-hover)]'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Page count */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
                <Layers className="w-3.5 h-3.5" /> 页数
              </label>
              <span className="text-sm text-[var(--text-primary)] font-semibold tabular-nums bg-[var(--glass-hover)] px-2.5 py-0.5 rounded-lg">{pageCount}</span>
            </div>
            <div className="pt-1">
              <input
                data-testid="image-ppt-page-count"
                type="range"
                min={4}
                max={16}
                value={pageCount}
                step={1}
                onChange={(e) => setPageCount(Number(e.target.value))}
                className="w-full h-1.5 bg-[var(--border-subtle)] rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-blue-600
                  [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(255,255,255,0.3)]
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-webkit-slider-thumb]:border-2
                  [&::-webkit-slider-thumb]:border-[var(--bg-primary)]
                  [&::-moz-range-thumb]:w-4
                  [&::-moz-range-thumb]:h-4
                  [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-blue-600
                  [&::-moz-range-thumb]:border-2
                  [&::-moz-range-thumb]:border-[var(--bg-primary)]
                  [&::-moz-range-thumb]:cursor-pointer"
              />
              <div className="flex justify-between mt-1 text-[10px] text-[var(--text-tertiary)] font-mono">
                <span>4</span><span>16</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Generate button ── */}
      {generationNotice && !isGenerating && (
        <div className="liquid-glass-card p-3 text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)]">
          {generationNotice}
        </div>
      )}

      {generationError && !isGenerating && (
        <div
          data-testid="image-ppt-error"
          className="liquid-glass-card p-4 space-y-3 border border-rose-400/35 bg-rose-500/10"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">图片 PPT 生成失败</p>
              <p className="break-words text-xs leading-relaxed text-[var(--text-secondary)]">
                {generationError}
              </p>
              <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                文本模型已进入生成流程，但账号绑定的图片模型暂时不可用。请稍后重试或联系服务方检查模型配置。
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="image-ppt-retry"
            onClick={handleGenerate}
            disabled={!hasSelectedPapers}
            className="liquid-glass-btn px-3 py-2 text-xs text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            重试生成
          </button>
        </div>
      )}

      <button
        data-testid="image-ppt-generate"
        onClick={handleGenerate}
        disabled={isGenerating || !hasSelectedPapers}
        className={`w-full py-4 rounded-2xl font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2 ${
          isGenerating || !hasSelectedPapers
            ? 'liquid-glass-btn text-[var(--text-tertiary)] cursor-not-allowed'
            : 'liquid-glass-btn !rounded-2xl !bg-gradient-to-r !from-amber-500 !to-amber-600 hover:!from-amber-400 hover:!to-amber-500 !text-black !border-0 active:scale-[0.98]'
        }`}
        title={hasSelectedPapers ? '一键生成图片简报' : '请先在左侧选择资料'}
      >
        {isGenerating ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> {progressMsg || 'AI 生成中...'}</>
        ) : !hasSelectedPapers ? (
          <><Sparkles className="h-4 w-4" /> 先选择资料</>
        ) : (
          <><Sparkles className="h-4 w-4" /> 生成图片简报</>
        )}
      </button>

      {/* ── Progress steps ── */}
      {isGenerating && (
        <div className="liquid-glass-card p-5 space-y-4" data-testid="image-ppt-progress">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
              正在生成演示文稿，可随时取消后调整资料、页数或风格重新开始。
            </p>
            <button
              type="button"
              onClick={handleCancelGenerate}
              className="liquid-glass-btn shrink-0 px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              取消生成
            </button>
          </div>
          {['outline', 'description', 'image', 'narration'].map((stage, idx) => {
            const stageNames = ['生成大纲', '生成描述', '生成图片', '生成演讲词'];
            const stageEmojis = ['📋', '✍️', '🎨', '🎤'];
            const isActive = progressStage === stage;
            const isDone = progressStage && ['outline', 'description', 'image', 'narration'].indexOf(progressStage) > idx;
            const stages = ['outline', 'description', 'image', 'narration'];
            return (
              <div key={stage} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-500 ${
                  isDone
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : isActive
                      ? 'bg-[var(--glass-active)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
                      : 'bg-[var(--glass-subtle)] text-[var(--text-tertiary)]'
                }`}>
                  {isDone ? <Check className="h-4 w-4" /> : stageEmojis[idx]}
                </div>
                <div className="flex-1">
                  <span className={`text-[13px] font-medium transition-colors ${
                    isActive ? 'text-[var(--text-primary)]' : isDone ? 'text-emerald-400/80' : 'text-[var(--text-tertiary)]'
                  }`}>
                    {stageNames[idx]}
                  </span>
                </div>
                {isActive && stage === 'image' && (
                  <span className="text-xs text-[var(--text-tertiary)] font-mono">{imageCompleted}/{imageTotal}</span>
                )}
                {isActive && stage !== 'image' && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" />
                )}
                {/* Connector line */}
                {idx < 2 && (
                  <div className="hidden">{/* spacer */}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Slides preview ── */}
      {slides.length > 0 ? (
        <div className="space-y-4">
          {/* Main preview */}
          {currentSlide && (
            <div
              className="aspect-video rounded-2xl overflow-hidden cursor-pointer group relative liquid-glass-inset"
              onClick={() => setLightboxIdx(activeSlideIdx)}
            >
              {currentSlide.imageUrl ? (
                <img
                  src={currentSlide.imageUrl}
                  alt={currentSlide.title}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6">
                  <p className="text-sm font-medium text-[var(--text-primary)] text-center">{currentSlide.title}</p>
                  <div className="mt-3 text-[12px] text-[var(--text-tertiary)] whitespace-pre-line text-center leading-relaxed">
                    {currentSlide.content}
                  </div>
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/40 opacity-0 group-hover:opacity-100 transition-all duration-300">
                <div className="flex items-center gap-2 text-[var(--text-primary)] text-sm font-medium">
                  <Eye className="h-5 w-5" />
                  <span>查看大图</span>
                </div>
              </div>
            </div>
          )}

          {/* Thumbnails */}
          <div
            ref={thumbnailScrollRef}
            className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin"
            onWheel={(e: React.WheelEvent<HTMLDivElement>) => {
              const el = e.currentTarget;
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                el.scrollLeft += e.deltaY;
                e.preventDefault();
              }
            }}
          >
            {slides.map((slide, idx) => (
              <button
                key={slide.id}
                onClick={() => setActiveSlideIdx(idx)}
                className={`flex-shrink-0 w-[88px] h-[50px] rounded-xl border-2 transition-all duration-300 cursor-pointer overflow-hidden ${
                  idx === activeSlideIdx
                    ? 'border-[var(--text-primary)] shadow-[0_0_12px_rgba(255,255,255,0.08)]'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-subtle)]'
                } bg-[var(--bg-card)]/60 backdrop-blur-md`}
              >
                {slide.imageUrl ? (
                  <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--text-tertiary)] font-medium">
                    {idx + 1}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Slide info + page count + annotate */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-[var(--text-secondary)] truncate flex-1">{currentSlide?.title}</p>
            {currentSlide && (revisionHistory[currentSlide.id]?.length ?? 0) > 0 && (
              <button
                onClick={() => {
                  const slideId = currentSlide.id;
                  const history = revisionHistory[slideId] || [];
                  const previous = history[history.length - 1];
                  if (!previous) return;
                  setSlides(slides.map(s => (s.id === slideId ? { ...s, imageUrl: previous } : s)));
                  setRevisionHistory(prev => ({ ...prev, [slideId]: history.slice(0, -1) }));
                }}
                data-testid="image-ppt-rollback"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-all hover:border-amber-400/40 hover:text-amber-400"
                title="撤销最近一次标注修改,回到上一版"
              >
                回滚上一版
              </button>
            )}
            {currentSlide?.imageUrl && (
              <button
                onClick={() => setAnnotatingIdx(activeSlideIdx)}
                data-testid="image-ppt-annotate"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-all hover:border-red-400/40 hover:text-red-400"
                title="在页面上圈点标注,让 AI 重新生成这一页"
              >
                <Wand2 className="h-3.5 w-3.5" /> 标注修改
              </button>
            )}
            <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">{activeSlideIdx + 1} / {slides.length}</span>
          </div>

          <StudioEvidenceStatusPanel citations={pptCitations} retrieval={pptRetrieval} />

          {/* Narration / Speaker Notes with TTS */}
          {currentSlide?.narration && (
            <div className="liquid-glass-inset !border-amber-500/15 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400/80 uppercase tracking-widest">
                  <Volume2 className="h-3.5 w-3.5" /> 演讲稿
                </div>
                <span className="text-[10px] text-[var(--text-quaternary)]">{currentSlide.narration.length}字</span>
              </div>
              <NarrationPlayer key={activeSlideIdx} text={currentSlide.narration} />
            </div>
          )}

          <button
            onClick={handleExportPPTX}
            disabled={isExporting}
            className="w-full py-3 rounded-2xl liquid-glass-btn text-[var(--text-primary)] text-[13px] font-medium flex items-center justify-center gap-2"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isExporting ? '导出中...' : '导出 PPTX'}
          </button>
        </div>
      ) : !isGenerating ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-[20px] liquid-glass-inset flex items-center justify-center mx-auto mb-4">
            <Presentation className="h-7 w-7 text-[var(--text-tertiary)]" />
          </div>
          <p className="text-[13px] text-[var(--text-tertiary)] font-medium">暂无演示文稿</p>
          <p className="text-[12px] text-[var(--text-tertiary)]/60 mt-1.5">选择资料后，点击上方按钮一键生成 PPT</p>
        </div>
      ) : null}

      {/* ── Lightbox ── */}
      {lightboxIdx !== null && slides[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 bg-[var(--bg-primary)]/95 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          {/* Close */}
          <button
            className="absolute top-5 right-5 w-10 h-10 rounded-full bg-[var(--glass-active)] hover:bg-[var(--glass-active)] flex items-center justify-center transition-colors z-20"
            onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
          >
            <X className="h-5 w-5 text-[var(--text-primary)]" />
          </button>

          {/* Prev */}
          {lightboxIdx > 0 && (
            <button
              className="absolute left-5 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-[var(--glass-hover)] hover:bg-[var(--glass-active)] flex items-center justify-center transition-all duration-300 opacity-30 hover:opacity-100 z-10"
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
            >
              <ChevronLeft className="h-6 w-6 text-[var(--text-primary)]" />
            </button>
          )}

          {/* Next */}
          {lightboxIdx < slides.length - 1 && (
            <button
              className="absolute right-5 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-[var(--glass-hover)] hover:bg-[var(--glass-active)] flex items-center justify-center transition-all duration-300 opacity-30 hover:opacity-100 z-10"
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
            >
              <ChevronRight className="h-6 w-6 text-[var(--text-primary)]" />
            </button>
          )}

          {/* Image */}
          <div
            className="max-w-[90vw] max-h-[85vh] relative"
            onClick={(e) => e.stopPropagation()}
          >
            {slides[lightboxIdx].imageUrl ? (
              <img
                src={slides[lightboxIdx].imageUrl}
                alt={slides[lightboxIdx].title}
                className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl"
              />
            ) : (
              <div className="w-[80vw] h-[60vh] liquid-glass-inset flex flex-col items-center justify-center p-8">
                <p className="text-lg font-medium text-[var(--text-primary)] text-center">{slides[lightboxIdx].title}</p>
                <div className="mt-4 text-sm text-[var(--text-tertiary)] whitespace-pre-line text-center leading-relaxed">
                  {slides[lightboxIdx].content}
                </div>
              </div>
            )}
            <p className="text-center text-[12px] text-[var(--text-quaternary)] mt-4 font-medium tabular-nums">
              {lightboxIdx + 1} / {slides.length}
            </p>
          </div>
        </div>
      )}

      {/* ── Annotation-driven revision (Cowart-style) ── */}
      {annotatingIdx !== null && slides[annotatingIdx]?.imageUrl && (
        <SlideAnnotationEditor
          imageUrl={slides[annotatingIdx].imageUrl as string}
          slideTitle={slides[annotatingIdx].title}
          styleDescription={currentStyleVisualPrompt}
          aspectRatio={selectedAspectRatio}
          aiConfig={aiConfig}
          notebookId={notebookId}
          onClose={() => setAnnotatingIdx(null)}
          onRevised={(newImageUrl) => {
            const idx = annotatingIdx;
            const slide = slides[idx];
            if (slide?.imageUrl) {
              setRevisionHistory(prev => ({
                ...prev,
                [slide.id]: [...(prev[slide.id] || []), slide.imageUrl as string],
              }));
            }
            setSlides(slides.map((s, i) => (i === idx ? { ...s, imageUrl: newImageUrl } : s)));
          }}
        />
      )}
    </div>
  );
}
