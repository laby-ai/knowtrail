'use client';

// NotebookLM-style "discover sources": search the web from the library
// panel, pick results, and ingest them as sources in one step.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Globe2,
  GraduationCap,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { createDiscoveredSourceFile, type DiscoveredSourceFileInput } from '@/lib/discovered-source-file';

type DiscoverResult = DiscoveredSourceFileInput;

type IngestPhase = 'idle' | 'fetching' | 'done';

export function DiscoverSourcesModal({
  notebookId,
  onClose,
  onIngestFiles,
  variant = 'modal',
  initialScope = 'webpage',
}: {
  notebookId?: string;
  onClose: () => void;
  onIngestFiles: (files: File[]) => Promise<void | number>;
  variant?: 'modal' | 'embedded';
  initialScope?: 'webpage' | 'scholar';
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'webpage' | 'scholar'>(initialScope);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DiscoverResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchProvider, setSearchProvider] = useState<'metaso' | 'arxiv' | null>(null);
  const [ingestPhase, setIngestPhase] = useState<IngestPhase>('idle');
  const [ingestProgress, setIngestProgress] = useState({ done: 0, total: 0 });
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (variant !== 'modal') return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, variant]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || isSearching) return;
    setIsSearching(true);
    setError(null);
    setNotice(null);
    setSearchProvider(null);
    setItemErrors({});
    setSelected(new Set());
    try {
      const res = await fetch('/api/discover/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({ query: q, scope, size: 10, withContent: false, notebookId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '搜索失败');
      setResults(Array.isArray(data.results) ? data.results : []);
      setSearchProvider(data.provider === 'arxiv' ? 'arxiv' : 'metaso');
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败，请重试');
      setResults([]);
      setSearchProvider(null);
      setSearched(true);
    } finally {
      setIsSearching(false);
    }
  }, [query, scope, isSearching, notebookId]);

  const toggleSelect = useCallback((link: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link); else next.add(link);
      return next;
    });
  }, []);

  const handleIngest = useCallback(async () => {
    const picked = results.filter(r => selected.has(r.link));
    if (picked.length === 0 || ingestPhase === 'fetching') return;
    setIngestPhase('fetching');
    setIngestProgress({ done: 0, total: picked.length });
    setItemErrors({});
    setError(null);

    const files: File[] = [];
    const failures: Record<string, string> = {};

    for (const item of picked) {
      try {
        const file = await createDiscoveredSourceFile(item, async url => {
          const res = await fetch('/api/discover/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
            body: JSON.stringify({ url, notebookId }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || '抓取失败');
          return { title: data.title, text: data.text };
        });
        files.push(file);
      } catch (err) {
        failures[item.link] = err instanceof Error ? err.message : '抓取失败';
      }
      setIngestProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }

    setItemErrors(failures);

    if (files.length > 0) {
      let addedCount: number;
      try {
        const result = await onIngestFiles(files);
        addedCount = typeof result === 'number' ? result : files.length;
      } catch (err) {
        setError(err instanceof Error ? err.message : '来源入库失败，请重试。');
        setIngestPhase('idle');
        return;
      }
      if (Object.keys(failures).length === 0) {
        if (variant === 'modal') {
          onClose();
        } else {
          setNotice(`${addedCount} 个文献线索已加入文献库，可在左侧继续查看和提问。`);
          setSelected(new Set());
          setIngestPhase('idle');
        }
        return;
      }
      // Keep failed items selected so the user can retry just those.
      setSelected(new Set(Object.keys(failures)));
      setError(`${addedCount} 个文献线索已加入文献库；${Object.keys(failures).length} 个抓取失败，可重试或换一条来源。`);
    } else {
      setError('所选来源都未能抓取成功,请换几条结果试试。');
    }
    setIngestPhase('idle');
  }, [results, selected, ingestPhase, notebookId, onIngestFiles, onClose, variant]);

  return (
    <div
      className={variant === 'modal'
        ? 'fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in'
        : 'w-full'}
      data-testid={variant === 'modal' ? 'discover-sources-modal' : 'paper-search-workspace'}
      onClick={variant === 'modal' ? onClose : undefined}
    >
      <div
        className={variant === 'modal'
          ? 'flex max-h-[86vh] w-full max-w-2xl flex-col gap-3 rounded-2xl border border-white/10 bg-[var(--bg-primary)] p-5 shadow-2xl animate-scale-in'
          : 'flex w-full flex-col gap-3'}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Globe2 className="h-4 w-4 text-blue-400" />
              {variant === 'modal' ? '发现文献线索' : '论文检索'}
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">搜索学术与网页线索，核验来源后加入文献库</p>
          </div>
          {variant === 'modal' && (
            <button onClick={onClose} className="rounded-full p-2 text-[var(--text-tertiary)] hover:bg-[var(--glass-hover)]" aria-label="关闭">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search row */}
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 gap-1 rounded-xl bg-[var(--glass-subtle)] p-1">
            {([['webpage', '网页', Globe2], ['scholar', '学术', GraduationCap]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setScope(id)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  scope === id ? 'bg-[var(--glass-active)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
                data-testid={`discover-scope-${id}`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-quaternary)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleSearch(); }}
              placeholder="输入主题,例如:多模态大模型评测方法"
              data-testid="discover-query"
              className="liquid-glass-input w-full pl-9 pr-3 py-2.5 text-xs"
            />
          </div>
          <button
            onClick={() => void handleSearch()}
            disabled={isSearching || !query.trim()}
            data-testid="discover-search"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 text-xs font-semibold text-white transition hover:from-blue-400 hover:to-blue-500 disabled:opacity-45"
          >
            {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            搜索
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p className="text-[11px] leading-relaxed text-amber-300">{error}</p>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2" data-testid="discover-notice">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <p className="text-[11px] leading-relaxed text-emerald-300">{notice}</p>
          </div>
        )}
        {searchProvider === 'arxiv' && (
          <div className="flex items-start gap-2 rounded-xl border border-blue-400/20 bg-blue-500/8 px-3 py-2" data-testid="discover-provider-boundary">
            <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              当前使用 arXiv 开放源，英文题名或关键词通常更准确。结果是候选线索，引用前仍需核对题名、作者、日期、来源页和主张依据。
            </p>
          </div>
        )}

        {/* Results */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" data-testid="discover-results">
          {isSearching ? (
            <div className="flex flex-col items-center gap-3 py-14 text-[var(--text-tertiary)]">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <span className="text-xs">正在搜索{scope === 'scholar' ? '学术' : '网页'}文献线索...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="py-14 text-center text-xs text-[var(--text-tertiary)]">
              {searched ? '没有找到相关结果，换个关键词试试。' : '输入研究主题开始发现文献线索，结果可勾选加入文献库。'}
            </div>
          ) : (
            results.map(item => {
              const isSelected = selected.has(item.link);
              const itemError = itemErrors[item.link];
              let host = '';
              try { host = new URL(item.link).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
              return (
                <div
                  key={item.link}
                  className={`w-full overflow-hidden rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-blue-400/55 bg-blue-500/10'
                      : 'border-[var(--glass-border)] bg-[var(--glass-subtle)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelect(item.link)}
                    data-testid="discover-result-item"
                    className="w-full px-3.5 py-3 text-left"
                  >
                    <span className="flex items-start gap-2.5">
                      <span className="mt-0.5 shrink-0">
                        {isSelected
                          ? <CheckCircle2 className="h-4 w-4 text-blue-400" />
                          : <Circle className="h-4 w-4 text-[var(--text-quaternary)]" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{item.title}</span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-[var(--text-secondary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                          {item.snippet || '(无摘要)'}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-quaternary)]">
                          {host && <span className="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5">{host}</span>}
                          {item.date && <span>{item.date}</span>}
                          {item.authors && item.authors.length > 0 && <span className="truncate">{item.authors.slice(0, 2).join('、')}</span>}
                          <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-1.5 py-0.5 text-amber-400">
                            {item.verificationStatus === 'open-source-candidate' ? '开放源候选 · 待核验' : '待核验'}
                          </span>
                        </span>
                        {itemError && (
                          <span className="mt-1 block text-[10px] text-red-400">抓取失败:{itemError}</span>
                        )}
                      </span>
                    </span>
                  </button>
                  <div className="flex justify-end border-t border-[var(--border-subtle)] px-3.5 py-2">
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-medium text-blue-400 hover:text-blue-300"
                    >
                      查看来源
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
            <span className="text-[11px] text-[var(--text-tertiary)]">
              已选 {selected.size} / {results.length} 条
              {ingestPhase === 'fetching' && ` · 正在抓取 ${ingestProgress.done}/${ingestProgress.total}`}
            </span>
            <button
              onClick={() => void handleIngest()}
              disabled={selected.size === 0 || ingestPhase === 'fetching'}
              data-testid="discover-ingest"
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:from-blue-400 hover:to-blue-500 active:scale-[0.97] disabled:opacity-45"
            >
              {ingestPhase === 'fetching'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Plus className="h-3.5 w-3.5" />}
              {ingestPhase === 'fetching' ? '抓取来源中...' : `加入文献库`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
