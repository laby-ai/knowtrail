'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  FileText,
  Layout,
  Maximize2,
  Monitor,
  Sparkles,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';
import { HTML_DECK_STYLES } from '@/lib/ppt/html-deck-style';
import { buildStandaloneDeckHtml, exportHtmlDeckToPptx } from '@/lib/ppt/html-deck-export';

interface HtmlSlide {
  title: string;
  layoutHint: string;
  html: string;
}

const PIPELINE_STAGES: StudioJobProgressStage[] = [
  { key: 'outline', label: '大纲规划', icon: Layout },
  { key: 'html', label: '页面排版', icon: Code2 },
  { key: 'done', label: '完成', icon: Check },
];

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

  const handleGenerate = useCallback(async () => {
    const papers = getSelectedPapers();
    if (papers.length === 0) {
      setError('请先在左侧选择要生成简报的资料');
      return;
    }
    setError(null);
    setExportNotice(null);
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
      const response = await fetch('/api/ai/ppt-html', {
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
      setDeckTitle(finalTitle);
      setSlides(finalSlides);
      setActiveIdx(0);
      setProgressMsg('');
    } catch (err) {
      const aborted = abortController.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      setError(aborted ? '已取消生成,可以调整设置后重新开始。' : err instanceof Error ? err.message : 'HTML 简报生成失败');
    } finally {
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, [getSelectedPapers, aiConfig, notebookId, selectedStyle, pageCount, language]);

  const handleCancelGenerate = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleExportPptx = useCallback(async () => {
    if (slides.length === 0 || isExporting) return;
    setIsExporting(true);
    setExportNotice(null);
    try {
      await exportHtmlDeckToPptx(slides, deckTitle);
      setExportNotice('已导出可编辑 PPTX:文本框、色块与图表均可在 PowerPoint 中直接编辑。');
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

  // Keyboard navigation while previewing
  useEffect(() => {
    if (slides.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setActiveIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setActiveIdx(i => Math.min(slides.length - 1, i + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [slides.length]);

  const longTaskHint = elapsedSeconds >= 90
    ? 'HTML 排版仍在进行,每页由模型独立设计,通常 2-4 分钟内完成。'
    : '正在按风格合同逐页排版,生成期间可以随时取消。';

  return (
    <div className="relative space-y-4" data-testid="html-ppt-panel">
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
          hint={slideTotal > 0 ? `${longTaskHint}(${slideCompleted}/${slideTotal} 页)` : longTaskHint}
          onCancel={handleCancelGenerate}
          testId="html-ppt-job-progress"
        />
      ) : slides.length > 0 ? (
        <div className="space-y-3" data-testid="html-ppt-result">
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
              onClick={() => { setSlides([]); setExportNotice(null); }}
              className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium liquid-glass-btn hover:bg-[var(--glass-hover)] text-[var(--text-tertiary)]"
            >
              重新生成
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={!hasSelectedPapers}
          data-testid="html-ppt-generate"
          className="liquid-glass-btn w-full !rounded-xl !border-0 !bg-gradient-to-r !from-blue-500 !to-blue-600 px-8 py-3.5 text-sm !font-semibold !text-white hover:!from-blue-400 hover:!to-blue-500 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          title={hasSelectedPapers ? '生成 HTML 原生简报' : '请先在左侧选择资料'}
        >
          <span className="flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4" />
            {hasSelectedPapers ? '生成 HTML 简报' : '先选择资料'}
          </span>
        </button>
      )}
    </div>
  );
}
