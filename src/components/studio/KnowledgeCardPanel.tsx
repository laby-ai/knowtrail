'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Copy, Check, Loader2,
  Sparkles, BookOpen, FileText, AlertCircle, FileSearch, Link as LinkIcon,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { KnowledgeCardData } from '@/lib/knowledge-card-types';
import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';

interface KnowledgeCacheData {
  hit: boolean;
  storedAt?: string;
}

function readSessionJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const cached = sessionStorage.getItem(key);
    return cached ? JSON.parse(cached) as T : fallback;
  } catch {
    return fallback;
  }
}

function scopedSessionKey(scope: string, key: string) {
  return `lingbi:${scope}:${key}`;
}

const CATEGORY_STYLES: Record<string, { tagBg: string; tagText: string; tagBorder: string }> = {
  '核心概念': { tagBg: '#818cf8', tagText: '#e0e7ff', tagBorder: '#6366f1' },
  '关键要点': { tagBg: '#38bdf8', tagText: '#e0f2fe', tagBorder: '#0ea5e9' },
  '背景脉络': { tagBg: '#34d399', tagText: '#d1fae5', tagBorder: '#10b981' },
  '方法线索': { tagBg: '#fbbf24', tagText: '#fef3c7', tagBorder: '#f59e0b' },
  '结论启发': { tagBg: '#fb7185', tagText: '#ffe4e6', tagBorder: '#f43f5e' },
  '核心发现': { tagBg: '#818cf8', tagText: '#e0e7ff', tagBorder: '#6366f1' },
  '专业术语': { tagBg: '#34d399', tagText: '#d1fae5', tagBorder: '#10b981' },
  '背景知识': { tagBg: '#38bdf8', tagText: '#e0f2fe', tagBorder: '#0ea5e9' },
  '研究方法': { tagBg: '#fbbf24', tagText: '#fef3c7', tagBorder: '#f59e0b' },
  '结论': { tagBg: '#fb7185', tagText: '#ffe4e6', tagBorder: '#f43f5e' },
};
const DEFAULT_STYLE = { tagBg: '#818cf8', tagText: '#e0e7ff', tagBorder: '#6366f1' };

function getCategoryStyle(category: string) {
  return CATEGORY_STYLES[category] || DEFAULT_STYLE;
}

function getCitationAuditLabel(audit: CitationAuditResult) {
  if (audit.status === 'pass') {
    return `引用编号通过 · ${audit.markerCount}/${audit.citationCount}`;
  }
  if (audit.status === 'invalid-markers') {
    return `引用编号异常 · ${audit.invalidNumbers.map(number => `[${number}]`).join(', ')}`;
  }
  if (audit.status === 'missing-markers') {
    return `未标注引用编号 · 0/${audit.citationCount}`;
  }
  return `暂无引用审计 · ${audit.citationCount}`;
}

function getCitationAuditClassName(audit: CitationAuditResult) {
  if (audit.status === 'pass') {
    return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300';
  }
  if (audit.status === 'invalid-markers') {
    return 'border-red-400/20 bg-red-500/10 text-red-300';
  }
  return 'border-amber-400/20 bg-amber-500/10 text-amber-300';
}

function formatCacheAge(storedAt?: string) {
  if (!storedAt) return '刚刚';
  const timestamp = new Date(storedAt).getTime();
  if (!Number.isFinite(timestamp)) return '刚刚';
  const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (ageSeconds < 60) return '刚刚';
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes} 分钟前`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours} 小时前`;
  return `${Math.floor(ageHours / 24)} 天前`;
}

export function KnowledgeCardPanel() {
  const { getSelectedPapers, aiConfig, storageScopeKey } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const [cards, setCards] = useState<KnowledgeCardData[]>(() => readSessionJson(scopedSessionKey(storageScopeKey, 'knowledge_cards'), []));
  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    try {
      const idx = sessionStorage.getItem(scopedSessionKey(storageScopeKey, 'knowledge_cards_index'));
      return idx ? parseInt(idx, 10) : 0;
    } catch {
      return 0;
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [citations, setCitations] = useState<Citation[]>(() => readSessionJson(scopedSessionKey(storageScopeKey, 'knowledge_cards_citations'), []));
  const [retrieval, setRetrieval] = useState<RetrievalMetadata | null>(() => readSessionJson(scopedSessionKey(storageScopeKey, 'knowledge_cards_retrieval'), null));
  const [citationAudit, setCitationAudit] = useState<CitationAuditResult | null>(() => readSessionJson(scopedSessionKey(storageScopeKey, 'knowledge_cards_citation_audit'), null));
  const [cache, setCache] = useState<KnowledgeCacheData | null>(() => readSessionJson(scopedSessionKey(storageScopeKey, 'knowledge_cards_cache'), null));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sessionKeys = {
      cards: scopedSessionKey(storageScopeKey, 'knowledge_cards'),
      index: scopedSessionKey(storageScopeKey, 'knowledge_cards_index'),
      citations: scopedSessionKey(storageScopeKey, 'knowledge_cards_citations'),
      retrieval: scopedSessionKey(storageScopeKey, 'knowledge_cards_retrieval'),
      citationAudit: scopedSessionKey(storageScopeKey, 'knowledge_cards_citation_audit'),
      cache: scopedSessionKey(storageScopeKey, 'knowledge_cards_cache'),
    };
    if (cards.length > 0) {
      sessionStorage.setItem(sessionKeys.cards, JSON.stringify(cards));
      sessionStorage.setItem(sessionKeys.index, String(currentIndex));
      sessionStorage.setItem(sessionKeys.citations, JSON.stringify(citations));
      sessionStorage.setItem(sessionKeys.retrieval, JSON.stringify(retrieval));
      sessionStorage.setItem(sessionKeys.citationAudit, JSON.stringify(citationAudit));
      sessionStorage.setItem(sessionKeys.cache, JSON.stringify(cache));
      return;
    }
    Object.values(sessionKeys).forEach(key => sessionStorage.removeItem(key));
  }, [cache, cards, citationAudit, citations, currentIndex, retrieval, storageScopeKey]);

  const papers = getSelectedPapers();
  const hasSelectedPapers = papers.length > 0;

  const handleGenerate = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!hasSelectedPapers) {
      setError('请先在左侧资料库中选择资料');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setCards([]);
    setCurrentIndex(0);
    setCitations([]);
    setRetrieval(null);
    setCitationAudit(null);
    setCache(null);

    try {
      const paperContents = papers.map(p => ({
        id: p.id,
        title: p.title,
        authors: p.authors,
        year: p.year,
        shortName: p.shortName,
        fileName: p.fileName,
        fileType: p.fileType,
        abstract: p.abstract || '',
        content: (p.rawContent || p.content).slice(0, 8000),
        rawContent: p.rawContent,
      }));

      const res = await fetch('/api/ai/knowledge-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({ papers: paperContents, aiConfig, notebookId, forceRefresh: Boolean(options?.forceRefresh) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '生成失败');
      }

      const data = await res.json();
      const generated: KnowledgeCardData[] = data.cards || [];
      if (generated.length === 0) throw new Error('未能生成知识卡片');

      setCards(generated);
      setCitations(Array.isArray(data.citations) ? data.citations : []);
      setRetrieval(data.retrieval || null);
      setCitationAudit(data.citationAudit || null);
      setCache(data.cache || null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '生成知识卡片失败';
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [papers, aiConfig, notebookId, hasSelectedPapers]);

  const goNext = useCallback(() => {
    if (cards.length === 0) return;
    setCurrentIndex((currentIndex + 1) % cards.length);
  }, [cards.length, currentIndex]);

  const goPrev = useCallback(() => {
    if (cards.length === 0) return;
    setCurrentIndex((currentIndex - 1 + cards.length) % cards.length);
  }, [cards.length, currentIndex]);

  // Arrow-key navigation while cards are shown (skip when typing in inputs).
  useEffect(() => {
    if (cards.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [cards.length, goPrev, goNext]);

  const handleCopy = useCallback(() => {
    if (cards.length === 0 || copied) return;
    const card = cards[currentIndex];
    const text = `【${card.category}】${card.title}\n\n${card.content}\n\n${card.extra}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [cards, currentIndex, copied]);

  const [copiedAll, setCopiedAll] = useState(false);
  const handleCopyAll = useCallback(() => {
    if (cards.length === 0 || copiedAll) return;
    const markdown = cards
      .map((card, i) => `## ${i + 1}. 【${card.category}】${card.title}\n\n${card.content}\n\n> ${card.extra}`)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(markdown).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1200);
    });
  }, [cards, copiedAll]);

  const currentCard = cards[currentIndex];
  const currentStyle = currentCard ? getCategoryStyle(currentCard.category) : DEFAULT_STYLE;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
        从选中资料中整理核心概念、关键要点和引用出处，生成可复用的知识卡片。
      </p>

      {cards.length === 0 && !isGenerating && (
        <button
          onClick={() => handleGenerate()}
          disabled={!hasSelectedPapers}
          data-testid="knowledge-generate"
          title={!hasSelectedPapers ? '请先在左侧选择资料' : '生成知识卡片'}
          className="liquid-glass-btn w-full py-3 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles className="h-4 w-4 text-indigo-400" />
          {!hasSelectedPapers ? '先选择资料' : '生成知识卡片'}
        </button>
      )}

      {!hasSelectedPapers && cards.length === 0 && !isGenerating && (
        <div className="liquid-glass-card p-3 space-y-1.5" data-testid="knowledge-empty-state">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
            <FileSearch className="h-3.5 w-3.5" />
            <span>先选择要整理的资料</span>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            在左侧资料库勾选一份或多份资料后，知识卡片会提炼概念、要点和引用来源。
          </p>
        </div>
      )}

      {isGenerating && (
        <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="knowledge-loading">
          <Loader2 className="h-8 w-8 text-indigo-400 animate-spin" />
          <p className="text-xs text-[var(--text-tertiary)]">正在生成知识卡片…</p>
          <p className="text-[11px] text-[var(--text-quaternary)] text-center leading-relaxed">
            正在从选中资料中整理概念、要点和证据来源，请稍候。
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20" data-testid="knowledge-error-state">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-xs text-red-400">{error}</p>
            {hasSelectedPapers && (
              <button
                type="button"
                onClick={() => handleGenerate({ forceRefresh: true })}
                className="liquid-glass-btn px-3 py-1.5 text-[11px] font-medium"
                data-testid="knowledge-retry"
              >
                重新尝试
              </button>
            )}
          </div>
        </div>
      )}

      {cards.length > 0 && !isGenerating && currentCard && (
        <>
          <div className="liquid-glass-card p-3 space-y-1.5" data-testid="knowledge-card-summary">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
              <BookOpen className="h-3.5 w-3.5" />
              <span>知识卡片</span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              已生成 {cards.length} 张卡片，引用 {citations.length} 个来源。
              {retrieval?.degraded && retrieval.reason ? ` 当前使用降级检索：${retrieval.reason}` : ''}
            </p>
            {cache && (
              <p className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-300" data-testid="knowledge-cache-badge">
                {cache.hit
                  ? `已从 ${formatCacheAge(cache.storedAt)}的整理结果快速打开；如需纳入最新资料，可点“重新整理资料”。`
                  : '已更新整理结果；后续打开同一批资料会更快。'}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]" data-testid="knowledge-detail-heading">
            <FileText className="h-3.5 w-3.5" />
            <span>卡片详情</span>
          </div>

          <section
            className="liquid-glass-card overflow-hidden rounded-2xl border border-[var(--border-subtle)] p-4"
            data-testid="knowledge-node-panel"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span
                  className="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                  style={{
                    background: `${currentStyle.tagBg}35`,
                    color: currentStyle.tagText,
                    borderColor: `${currentStyle.tagBorder}90`,
                  }}
                >
                  {currentCard.category}
                </span>
                <h3 className="mt-3 text-base font-bold leading-snug text-[var(--text-primary)]" data-testid="knowledge-detail-title">
                  {currentCard.title}
                </h3>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-quaternary)]">
                {currentIndex + 1} / {cards.length}
              </span>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-secondary)]" data-testid="knowledge-node-panel-content">
              {currentCard.content}
            </p>

            <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-white/[0.035] px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                {currentCard.extra}
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
              <span className="text-[10px] leading-relaxed text-[var(--text-quaternary)]">
                可复制当前卡片，用于报告、讲稿或后续提问。
              </span>
              <button
                onClick={handleCopy}
                className="liquid-glass-btn shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium"
                title="复制当前卡片"
                data-testid="knowledge-copy-detail"
              >
                {copied ? <Check className="mr-1 inline h-3.5 w-3.5 text-indigo-300" /> : <Copy className="mr-1 inline h-3.5 w-3.5" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </section>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={goPrev}
              className="liquid-glass-btn w-10 h-10 flex items-center justify-center rounded-full"
              title="上一张卡片(←)"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-xs font-medium text-[var(--text-tertiary)] tabular-nums min-w-[48px] text-center">
              {currentIndex + 1} / {cards.length}
            </span>
            <button
              onClick={goNext}
              className="liquid-glass-btn w-10 h-10 flex items-center justify-center rounded-full"
              title="下一张卡片(→)"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <p className="text-center text-[10px] text-[var(--text-quaternary)]">可用键盘 ← → 翻卡</p>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCopyAll}
              className="liquid-glass-btn py-2 text-[11px] font-medium"
              data-testid="knowledge-copy-all"
              title="把全部卡片复制为 Markdown,可直接粘贴进笔记"
            >
              {copiedAll ? <Check className="h-3 w-3 inline mr-1 text-emerald-400" /> : <Copy className="h-3 w-3 inline mr-1" />}
              {copiedAll ? '已复制全部' : '复制全部卡片'}
            </button>
            <button
              onClick={() => handleGenerate({ forceRefresh: true })}
              className="liquid-glass-btn py-2 text-[11px] font-medium"
              data-testid="knowledge-refresh"
              title="重新分析选中资料，并更新知识卡片"
            >
              <Sparkles className="h-3 w-3 inline mr-1" /> 重新整理资料
            </button>
          </div>

          {(retrieval || citations.length > 0) && (
            <div className="liquid-glass-card p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                <FileSearch className="h-3.5 w-3.5" />
                <span>证据状态</span>
              </div>
              {retrieval && (
                <div
                  data-testid="knowledge-retrieval-badge"
                  className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-2 text-[11px] text-cyan-300 leading-relaxed"
                  title="资料来源匹配状态"
                >
                  {retrieval.mode === 'persisted-vector'
                    ? '向量索引检索'
                    : retrieval.mode === 'persisted-keyword'
                      ? '持久片段检索'
                      : retrieval.mode === 'request-keyword'
                        ? '请求内资料兜底'
                        : retrieval.mode}
                  {' · '}
                  引用 {citations.length}
                  {' · '}
                  持久源 {retrieval.persistedSourceCount}
                  {' · '}
                  {retrieval.vectorIndexedSourceCount > 0 ? `向量源 ${retrieval.vectorIndexedSourceCount}` : '无向量源'}
                  {retrieval.degraded && retrieval.reason && (
                    <span className="mt-1 block text-cyan-200/90">降级原因：{retrieval.reason}</span>
                  )}
                </div>
              )}
              {citationAudit && citationAudit.status !== 'none' && (
                <div
                  data-testid="knowledge-citation-audit-badge"
                  className={`rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${getCitationAuditClassName(citationAudit)}`}
                  title="服务端审计知识卡片是否使用了检索证据来源编号"
                >
                  {getCitationAuditLabel(citationAudit)}
                  {citationAudit.warning && (
                    <span className="mt-1 block opacity-90">{citationAudit.warning}</span>
                  )}
                </div>
              )}
              {citations.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                    <LinkIcon className="h-3 w-3" />
                    <span>{citations.length} 个引用来源</span>
                  </div>
                  {citations.slice(0, 3).map((citation, idx) => (
                    <div key={`${citation.sourceId || citation.paperId || idx}-${citation.chunkId || idx}`} className="rounded-lg border-l-2 border-[var(--accent-blue)]/40 bg-black/5 px-3 py-2">
                      <div className="text-[10px] font-semibold text-[var(--accent-blue)]">
                        {citation.paperShortName || citation.sourceTitle || citation.sourceId || `来源 ${idx + 1}`}
                        {citation.page ? ` · 第 ${citation.page} 页` : ''}
                      </div>
                      {citation.sourceTitle && (
                        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{citation.sourceTitle}</div>
                      )}
                      {citation.excerpt && (
                        <p className="mt-1 text-[10px] text-[var(--text-secondary)] italic leading-relaxed">&ldquo;{citation.excerpt}&rdquo;</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
