'use client';

import { clientApiRequest } from '@/lib/client-api';
import { useStudioGenerationReadiness } from '@/hooks/use-studio-generation-readiness';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  FileText,
  Layout,
  Loader2,
  Maximize2,
  Monitor,
  ShieldCheck,
  Sparkles,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';
import NarrationPlayer from './NarrationPlayer';
import { HTML_DECK_STYLES } from '@/lib/ppt/html-deck-style';
import { buildStandaloneDeckHtml, exportHtmlDeckToPptx, measureSlideOverflow } from '@/lib/ppt/html-deck-export';

interface SlideOutline {
  title: string;
  points: string[];
  layoutHint?: string;
  part?: string;
}

interface HtmlSlide {
  title: string;
  layoutHint: string;
  html: string;
  narration?: string;
  outline?: SlideOutline;
}

interface PersistedDeck {
  version: 1;
  deckTitle: string;
  styleId: string;
  language: 'zh' | 'en';
  savedAt: number;
  slides: HtmlSlide[];
}

const PIPELINE_STAGES: StudioJobProgressStage[] = [
  { key: 'outline', label: '大纲规划', icon: Layout },
  { key: 'html', label: '页面排版', icon: Code2 },
  { key: 'narration', label: '演讲稿', icon: Volume2 },
  { key: 'qa', label: '质量检查', icon: ShieldCheck },
];

const OVERFLOW_TOLERANCE_PX = 8;
const MAX_REPAIR_ROUNDS = 2;

function deckStorageKey(notebookId: string | undefined) {
  return `knowtrail:html-deck:${notebookId || 'default'}`;
}

function ScaledSlideFrame({ html, className }: { html: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 1280);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden ${className || ''}`}
      style={{ aspectRatio: '16 / 9' }}
    >
      <iframe
        srcDoc={html}
        sandbox="allow-same-origin"
        title="slide-preview"
        className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
        style={{ width: 1280, height: 720, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      />
    </div>
  );
}

export function HtmlPresentationPanel() {
  const { getSelectedPapers, aiConfig, storageScopeKey } = useApp();
  const generationReadiness = useStudioGenerationReadiness('htmlPpt');
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);

  const [selectedStyle, setSelectedStyle] = useState(HTML_DECK_STYLES[0].id);
  const [pageCount, setPageCount] = useState(10);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');

  const [isGenerating, setIsGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressStage, setProgressStage] = useState('outline');
  const [slideCompleted, setSlideCompleted] = useState(0);
  const [slideTotal, setSlideTotal] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [deckTitle, setDeckTitle] = useState('资料简报');
  const [slides, setSlides] = useState<HtmlSlide[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [qaNotice, setQaNotice] = useState<string | null>(null);
  const [restoredDeck, setRestoredDeck] = useState<PersistedDeck | null>(null);

  // Per-slide re-layout
  const [relayoutIdx, setRelayoutIdx] = useState<number | null>(null);
  const [relayoutInstruction, setRelayoutInstruction] = useState('');
  const [isRelayouting, setIsRelayouting] = useState(false);
  const [relayoutError, setRelayoutError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const presentRef = useRef<HTMLDivElement>(null);
  const hasSelectedPapers = getSelectedPapers().length > 0;
  const currentStyle = useMemo(
    () => HTML_DECK_STYLES.find(s => s.id === selectedStyle) || HTML_DECK_STYLES[0],
    [selectedStyle],
  );

  useEffect(() => {
    if (!isGenerating) return;
    const timer = window.setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  // ── Persistence: offer to restore the last deck for this notebook ──
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(deckStorageKey(notebookId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedDeck;
      if (parsed?.version === 1 && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
        setRestoredDeck(parsed);
      }
    } catch { /* corrupted cache is fine to ignore */ }
  }, [notebookId]);

  const persistDeck = useCallback((deck: Omit<PersistedDeck, 'version' | 'savedAt'>) => {
    try {
      window.localStorage.setItem(
        deckStorageKey(notebookId),
        JSON.stringify({ version: 1, savedAt: Date.now(), ...deck } satisfies PersistedDeck),
      );
    } catch (err) {
      // localStorage quota — drop silently, persistence is best-effort.
      console.warn('[HTML PPT] persist failed:', err);
    }
  }, [notebookId]);

  const applySlides = useCallback((title: string, styleId: string, lang: 'zh' | 'en', next: HtmlSlide[]) => {
    setDeckTitle(title);
    setSlides(next);
    setActiveIdx(0);
    persistDeck({ deckTitle: title, styleId, language: lang, slides: next });
  }, [persistDeck]);

  const updateSlideHtml = useCallback((idx: number, html: string) => {
    setSlides(prev => {
      const next = prev.map((s, i) => (i === idx ? { ...s, html } : s));
      persistDeck({ deckTitle, styleId: selectedStyle, language, slides: next });
      return next;
    });
  }, [persistDeck, deckTitle, selectedStyle, language]);

  // ── Quality loop: measure overflow, auto-repair offending slides ──
  const runQualityLoop = useCallback(async (
    generated: HtmlSlide[],
    title: string,
    styleId: string,
    lang: 'zh' | 'en',
  ): Promise<HtmlSlide[]> => {
    const repaired = [...generated];
    let repairedCount = 0;
    let unresolvedCount = 0;

    for (let i = 0; i < repaired.length; i++) {
      let rounds = 0;
      while (rounds < MAX_REPAIR_ROUNDS) {
        const { overflowX, overflowY } = await measureSlideOverflow(repaired[i].html);
        if (overflowX <= OVERFLOW_TOLERANCE_PX && overflowY <= OVERFLOW_TOLERANCE_PX) break;
        rounds++;
        setProgressMsg(`质量检查:第 ${i + 1} 页溢出 ${Math.max(overflowX, overflowY)}px,自动重排(第 ${rounds} 次)...`);
        try {
          const res = await clientApiRequest('/api/ai/ppt-html-repair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
            body: JSON.stringify({
              notebookId,
              currentHtml: repaired[i].html,
              problem: `页面内容溢出 1280×720 画布:横向超出 ${overflowX}px,纵向超出 ${overflowY}px。`,
              outline: repaired[i].outline,
              slideIndex: i,
              slideTotal: repaired.length,
              deckTitle: title,
              styleId,
              language: lang,
              aiConfig,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.html) throw new Error(data.error || '修复失败');
          repaired[i] = { ...repaired[i], html: data.html };
          repairedCount++;
        } catch (err) {
          console.warn(`[HTML PPT] 第 ${i + 1} 页自动修复失败:`, err);
          unresolvedCount++;
          break;
        }
      }
    }

    if (repairedCount > 0 || unresolvedCount > 0) {
      setQaNotice(
        unresolvedCount > 0
          ? `自动质检:重排了 ${repairedCount} 页;${unresolvedCount} 页仍可能溢出,建议用"重排此页"手动处理。`
          : `自动质检:检测并重排了 ${repairedCount} 页溢出内容,全部通过。`,
      );
    } else {
      setQaNotice('自动质检:全部页面通过溢出检查。');
    }
    return repaired;
  }, [notebookId, aiConfig]);

  const handleGenerate = useCallback(async () => {
    if (!generationReadiness.ready) {
      setError(generationReadiness.message);
      return;
    }
    const papers = getSelectedPapers();
    if (papers.length === 0) {
      setError('请先在左侧选择要生成简报的资料');
      return;
    }
    setError(null);
    setExportNotice(null);
    setQaNotice(null);
    setRestoredDeck(null);
    setSlides([]);
    setActiveIdx(0);
    setSlideCompleted(0);
    setSlideTotal(0);
    setElapsedSeconds(0);
    setIsGenerating(true);
    setProgressStage('outline');
    setProgressMsg('正在规划简报大纲...');
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await clientApiRequest('/api/ai/ppt-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          notebookId,
          papers: papers.map(p => ({
            id: p.id,
            title: p.title,
            authors: p.authors,
            year: p.year,
            fileName: p.fileName,
            fileType: p.fileType,
            abstract: p.abstract,
            content: p.content,
            rawContent: p.rawContent,
          })),
          aiConfig,
          styleId: selectedStyle,
          pageCount,
          language,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) throw new Error('HTML 简报生成请求失败');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalSlides: HtmlSlide[] = [];
      let finalTitle = '资料简报';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.stage === 'outline') {
              setProgressStage('outline');
              setProgressMsg(data.message);
            } else if (data.stage === 'html') {
              setProgressStage('html');
              setProgressMsg(data.message);
              if (data.slideTotal) setSlideTotal(data.slideTotal);
              if (data.slideCompleted !== undefined) setSlideCompleted(data.slideCompleted);
            } else if (data.stage === 'narration') {
              setProgressStage('narration');
              setProgressMsg(data.message);
            } else if (data.stage === 'done') {
              finalSlides = data.slides || [];
              if (data.deckTitle) finalTitle = data.deckTitle;
            } else if (data.stage === 'error') {
              throw new Error(data.message);
            }
          } catch (e) {
            if (e instanceof Error && e.message && !e.message.startsWith('Unexpected')) throw e;
          }
        }
      }

      if (finalSlides.length === 0) throw new Error('生成结果为空,请重试');

      // ── Automatic overflow QA + repair before showing the deck ──
      setProgressStage('qa');
      setProgressMsg('正在做溢出质检...');
      const checked = await runQualityLoop(finalSlides, finalTitle, selectedStyle, language);

      applySlides(finalTitle, selectedStyle, language, checked);
      setProgressMsg('');
    } catch (err) {
      const aborted = abortController.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      setError(aborted ? '已取消生成,可以调整设置后重新开始。' : err instanceof Error ? err.message : 'HTML 简报生成失败');
    } finally {
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, [generationReadiness, getSelectedPapers, aiConfig, notebookId, selectedStyle, pageCount, language, runQualityLoop, applySlides]);

  const handleCancelGenerate = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleRestore = useCallback(() => {
    if (!restoredDeck) return;
    setDeckTitle(restoredDeck.deckTitle);
    setSelectedStyle(restoredDeck.styleId);
    setLanguage(restoredDeck.language);
    setSlides(restoredDeck.slides);
    setActiveIdx(0);
    setRestoredDeck(null);
  }, [restoredDeck]);

  const handleDiscardRestore = useCallback(() => {
    setRestoredDeck(null);
    try { window.localStorage.removeItem(deckStorageKey(notebookId)); } catch { /* ignore */ }
  }, [notebookId]);

  // ── Per-slide re-layout (user instruction) ──
  const handleRelayout = useCallback(async () => {
    if (relayoutIdx === null || isRelayouting) return;
    if (!relayoutInstruction.trim()) {
      setRelayoutError('请填写重排要求');
      return;
    }
    setIsRelayouting(true);
    setRelayoutError(null);
    try {
      const slide = slides[relayoutIdx];
      const res = await clientApiRequest('/api/ai/ppt-html-repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          notebookId,
          currentHtml: slide.html,
          instruction: relayoutInstruction.trim(),
          outline: slide.outline,
          slideIndex: relayoutIdx,
          slideTotal: slides.length,
          deckTitle,
          styleId: selectedStyle,
          language,
          aiConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.html) throw new Error(data.error || '重排失败');
      updateSlideHtml(relayoutIdx, data.html);
      setRelayoutIdx(null);
      setRelayoutInstruction('');
    } catch (err) {
      setRelayoutError(err instanceof Error ? err.message : '重排失败,请重试');
    } finally {
      setIsRelayouting(false);
    }
  }, [relayoutIdx, isRelayouting, relayoutInstruction, slides, notebookId, deckTitle, selectedStyle, language, aiConfig, updateSlideHtml]);

  const handleExportPptx = useCallback(async () => {
    if (slides.length === 0 || isExporting) return;
    setIsExporting(true);
    setExportNotice(null);
    try {
      await exportHtmlDeckToPptx(slides, deckTitle);
      setExportNotice('已导出可编辑 PPTX:文本、色块与图表可在 PowerPoint 中直接编辑,演讲稿在每页备注栏。');
    } catch (err) {
      setExportNotice(`导出失败:${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsExporting(false);
    }
  }, [slides, deckTitle, isExporting]);

  const handleDownloadHtml = useCallback(() => {
    if (slides.length === 0) return;
    const html = buildStandaloneDeckHtml(slides, deckTitle);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deckTitle.replace(/[\\/:*?"<>|]/g, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [slides, deckTitle]);

  const handlePresent = useCallback(() => {
    presentRef.current?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    if (slides.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (relayoutIdx !== null) return;
      if (e.key === 'ArrowLeft') setActiveIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setActiveIdx(i => Math.min(slides.length - 1, i + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [slides.length, relayoutIdx]);

  const longTaskHint = elapsedSeconds >= 90
    ? 'HTML 排版仍在进行,每页由模型独立设计并质检,通常 2-5 分钟内完成。'
    : '正在按风格合同逐页排版,完成后自动做溢出质检,期间可随时取消。';

  return (
    <div className="relative space-y-4" data-testid="html-ppt-panel">
      {/* ── Restore banner ── */}
      {restoredDeck && slides.length === 0 && !isGenerating && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 liquid-glass-static !border-blue-500/25" data-testid="html-ppt-restore">
          <FileText className="h-4 w-4 shrink-0 text-blue-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-[var(--text-primary)]">上次生成的简报:{restoredDeck.deckTitle}</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">{restoredDeck.slides.length} 页 · {new Date(restoredDeck.savedAt).toLocaleString()}</p>
          </div>
          <button onClick={handleRestore} className="shrink-0 rounded-lg bg-blue-500/85 px-3 py-1.5 text-xs font-medium text-white">恢复</button>
          <button onClick={handleDiscardRestore} className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--glass-hover)]">丢弃</button>
        </div>
      )}

      {/* ── Style selector ── */}
      {slides.length === 0 && !isGenerating && (
        <>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[12px] font-semibold text-[var(--text-secondary)]">
              <span className="flex items-center gap-2"><Layout size={13} /> 设计风格</span>
              <span className="text-[10px] font-medium text-[var(--text-quaternary)]">源自 40 种 HTML 原生风格库</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {HTML_DECK_STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedStyle(s.id)}
                  className={`presentation-template-card spotlight-glass-card group flex min-h-[42px] items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
                    selectedStyle === s.id ? 'presentation-template-card-selected' : ''
                  } text-[var(--text-primary)]`}
                >
                  <span className="flex h-7 w-4 shrink-0 items-center justify-center">
                    <span className="h-6 w-1.5 rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10" style={{ backgroundColor: s.color }} />
                  </span>
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold leading-tight">{s.label}</span>
                      <span className="block truncate text-[10px] text-[var(--text-quaternary)]">{s.labelEn}</span>
                    </span>
                    {selectedStyle === s.id && <Check size={13} className="shrink-0 text-blue-500" />}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Settings ── */}
          <div className="liquid-glass-card space-y-4 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <FileText className="h-3.5 w-3.5" /> 页数
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={4}
                    max={20}
                    value={pageCount}
                    onChange={e => setPageCount(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--glass-active)] accent-blue-500"
                  />
                  <span className="w-8 text-right text-xs font-semibold text-blue-400">{pageCount}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <Monitor className="h-3.5 w-3.5" /> 语言
                </label>
                <div className="flex gap-1 rounded-2xl bg-[var(--glass-subtle)] p-1">
                  {([['zh', '中文'], ['en', 'English']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setLanguage(id)}
                      className={`flex-1 rounded-xl py-2 text-xs font-medium transition-all ${
                        language === id
                          ? 'bg-[var(--glass-active)] text-[var(--text-primary)] shadow-sm ring-1 ring-blue-500/30'
                          : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-quaternary)]">
              {currentStyle.contract.split('\n')[0]}
            </p>
          </div>
        </>
      )}

      {error && (
        <div className="rounded-xl px-4 py-2.5 text-center text-xs text-red-400 liquid-glass-static !border-red-500/20">{error}</div>
      )}

      {isGenerating ? (
        <StudioJobProgress
          title="HTML 简报生成中"
          message={progressMsg || '正在排版...'}
          stages={PIPELINE_STAGES}
          currentStageKey={progressStage}
          elapsedSeconds={elapsedSeconds}
          hint={slideTotal > 0 && progressStage === 'html' ? `${longTaskHint}(${slideCompleted}/${slideTotal} 页)` : longTaskHint}
          onCancel={handleCancelGenerate}
          testId="html-ppt-job-progress"
        />
      ) : slides.length > 0 ? (
        <div className="space-y-3" data-testid="html-ppt-result">
          {qaNotice && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs text-emerald-300 liquid-glass-static !border-emerald-500/25" data-testid="html-ppt-qa-notice">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              {qaNotice}
            </div>
          )}

          {/* ── Main preview ── */}
          <div ref={presentRef} className="group relative overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-black">
            <ScaledSlideFrame html={slides[activeIdx].html} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-3 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
                disabled={activeIdx === 0}
                className="pointer-events-auto rounded-full bg-black/55 p-2 text-white disabled:opacity-30"
                aria-label="上一页"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="rounded-full bg-black/55 px-3 py-1 text-xs text-white">
                {activeIdx + 1} / {slides.length} · {slides[activeIdx].title}
              </span>
              <button
                onClick={() => setActiveIdx(i => Math.min(slides.length - 1, i + 1))}
                disabled={activeIdx === slides.length - 1}
                className="pointer-events-auto rounded-full bg-black/55 p-2 text-white disabled:opacity-30"
                aria-label="下一页"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Slide toolbar ── */}
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-secondary)]">{slides[activeIdx].title}</p>
            <button
              onClick={() => { setRelayoutIdx(activeIdx); setRelayoutInstruction(''); setRelayoutError(null); }}
              data-testid="html-ppt-relayout"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-all hover:border-blue-400/40 hover:text-blue-400"
            >
              <Wand2 className="h-3.5 w-3.5" /> 重排此页
            </button>
          </div>

          {/* ── Thumbnails ── */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={`w-28 shrink-0 overflow-hidden rounded-lg border transition-all ${
                  i === activeIdx ? 'border-blue-400/70 ring-1 ring-blue-400/40' : 'border-[var(--glass-border)] opacity-70 hover:opacity-100'
                }`}
                title={s.title}
              >
                <ScaledSlideFrame html={s.html} />
              </button>
            ))}
          </div>

          {/* ── Narration ── */}
          {slides[activeIdx].narration && (
            <div className="liquid-glass-inset space-y-2 !border-blue-500/15 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-blue-400/80">
                  <Volume2 className="h-3.5 w-3.5" /> 演讲稿
                </div>
                <span className="text-[10px] text-[var(--text-quaternary)]">{slides[activeIdx].narration!.length}字</span>
              </div>
              <NarrationPlayer key={activeIdx} text={slides[activeIdx].narration!} />
            </div>
          )}

          {exportNotice && (
            <div className={`rounded-xl px-4 py-2.5 text-xs liquid-glass-static ${exportNotice.startsWith('导出失败') ? '!border-red-500/20 text-red-400' : '!border-emerald-500/25 text-emerald-300'}`}>
              {exportNotice}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleExportPptx}
              disabled={isExporting}
              data-testid="html-ppt-export-pptx"
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 py-3 text-sm font-semibold text-white transition-all hover:from-blue-400 hover:to-blue-500 active:scale-[0.97] disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> {isExporting ? '正在导出...' : '导出可编辑 PPTX'}
            </button>
            <button
              onClick={handleDownloadHtml}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium liquid-glass-btn hover:bg-[var(--glass-hover)] text-[var(--text-secondary)]"
            >
              <Code2 className="h-4 w-4" /> 下载 HTML 演示版
            </button>
            <button
              onClick={handlePresent}
              className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium liquid-glass-btn hover:bg-[var(--glass-hover)] text-[var(--text-secondary)]"
            >
              <Maximize2 className="h-4 w-4" /> 全屏演示
            </button>
            <button
              onClick={() => { setSlides([]); setExportNotice(null); setQaNotice(null); }}
              className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium liquid-glass-btn hover:bg-[var(--glass-hover)] text-[var(--text-tertiary)]"
            >
              重新生成
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!generationReadiness.ready && (
            <div data-testid="html-ppt-readiness" className="rounded-xl border border-amber-400/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
              {generationReadiness.message}
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={!hasSelectedPapers || !generationReadiness.ready}
            data-testid="html-ppt-generate"
            className="liquid-glass-btn w-full !rounded-xl !border-0 !bg-gradient-to-r !from-blue-500 !to-blue-600 px-8 py-3.5 text-sm !font-semibold !text-white hover:!from-blue-400 hover:!to-blue-500 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
            title={!generationReadiness.ready ? generationReadiness.message : hasSelectedPapers ? '生成 HTML 原生简报' : '请先在左侧选择资料'}
          >
            <span className="flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4" />
              {!generationReadiness.ready ? '服务配置中' : hasSelectedPapers ? '生成 HTML 简报' : '先选择资料'}
            </span>
          </button>
        </div>
      )}

      {/* ── Re-layout dialog ── */}
      {relayoutIdx !== null && slides[relayoutIdx] && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" data-testid="html-ppt-relayout-dialog">
          <div className="w-full max-w-2xl space-y-3 rounded-2xl border border-white/10 bg-[var(--bg-primary)] p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">重排此页 · {slides[relayoutIdx].title}</h3>
              <button onClick={() => setRelayoutIdx(null)} className="rounded-full p-2 text-[var(--text-tertiary)] hover:bg-[var(--glass-hover)]" aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-[var(--glass-border)]">
              <ScaledSlideFrame html={slides[relayoutIdx].html} />
            </div>
            {relayoutError && <div className="rounded-lg px-3 py-2 text-xs text-red-400 liquid-glass-static !border-red-500/20">{relayoutError}</div>}
            <div className="flex items-end gap-2">
              <textarea
                value={relayoutInstruction}
                onChange={e => setRelayoutInstruction(e.target.value)}
                rows={2}
                autoFocus
                placeholder="描述这一页要怎么改,例如:把三个要点改成左右对比;数字放大;换成图表呈现..."
                className="liquid-glass-input min-h-[56px] flex-1 resize-none px-3 py-2.5 text-xs leading-relaxed"
              />
              <button
                onClick={handleRelayout}
                disabled={isRelayouting}
                data-testid="html-ppt-relayout-submit"
                className="flex h-[56px] shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-5 text-sm font-semibold text-white transition-all hover:from-blue-400 hover:to-blue-500 active:scale-[0.97] disabled:opacity-50"
              >
                {isRelayouting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {isRelayouting ? '重排中...' : '重新排版'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
