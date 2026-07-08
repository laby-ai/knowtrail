'use client';

// NotebookLM-style "discover sources": search the web from the library
// panel, pick results, and ingest them as sources in one step.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
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

interface DiscoverResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  authors?: string[];
}

type IngestPhase = 'idle' | 'fetching' | 'done';

export function DiscoverSourcesModal({
  notebookId,
  onClose,
  onIngestFiles,
}: {
  notebookId?: string;
  onClose: () => void;
  onIngestFiles: (files: File[]) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'webpage' | 'scholar'>('webpage');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DiscoverResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [ingestPhase, setIngestPhase] = useState<IngestPhase>('idle');
  const [ingestProgress, setIngestProgress] = useState({ done: 0, total: 0 });
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || isSearching) return;
    setIsSearching(true);
    setError(null);
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
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败,请重试');
      setResults([]);
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
        const res = await fetch('/api/discover/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
          body: JSON.stringify({ url: item.link, notebookId }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '抓取失败');
        const safeTitle = (item.title || data.title || '网络文献线索').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
        const header = `来源链接:${item.link}\n${item.date ? `发布时间:${item.date}\n` : ''}${item.authors?.length ? `作者:${item.authors.join('、')}\n` : ''}\n`;
        files.push(new globalThis.File([header + data.text], `${safeTitle}.txt`, { type: 'text/plain' }));
      } catch (err) {
        failures[item.link] = err instanceof Error ? err.message : '抓取失败';
      }
      setIngestProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }

    setItemErrors(failures);

    if (files.length > 0) {
      await onIngestFiles(files);
      if (Object.keys(failures).length === 0) {
        onClose();
        return;
      }
      // Keep failed items selected so the user can retry just those.
      setSelected(new Set(Object.keys(failures)));
      setError(`${files.length} 个文献线索已加入文献库;${Object.keys(failures).length} 个抓取失败,可重试或换一条来源。`);
    } else {
      setError('所选来源都未能抓取成功,请换几条结果试试。');
    }
    setIngestPhase('idle');
  }, [results, selected, ingestPhase, notebookId, onIngestFiles, onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in" data-testid="discover-sources-modal" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col gap-3 rounded-2xl border border-white/10 bg-[var(--bg-primary)] p-5 shadow-2xl animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Globe2 className="h-4 w-4 text-blue-400" />
              发现文献线索
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">搜索网页或学术线索,勾选后加入文献库作为可引用来源</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--text-tertiary)] hover:bg-[var(--glass-hover)]" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
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

        {/* Results */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" data-testid="discover-results">
          {isSearching ? (
            <div className="flex flex-col items-center gap-3 py-14 text-[var(--text-tertiary)]">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <span className="text-xs">正在搜索{scope === 'scholar' ? '学术' : '网页'}文献线索...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="py-14 text-center text-xs text-[var(--text-tertiary)]">
              {searched ? '没有找到相关结果,换个关键词试试。' : '输入研究主题开始发现文献线索,结果可勾选加入文献库。'}
            </div>
          ) : (
            results.map(item => {
              const isSelected = selected.has(item.link);
              const itemError = itemErrors[item.link];
              let host = '';
              try { host = new URL(item.link).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
              return (
                <button
                  key={item.link}
                  onClick={() => toggleSelect(item.link)}
                  data-testid="discover-result-item"
                  className={`w-full rounded-xl border px-3.5 py-3 text-left transition-all ${
                    isSelected
                      ? 'border-blue-400/55 bg-blue-500/10'
                      : 'border-[var(--glass-border)] bg-[var(--glass-subtle)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
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
                      </span>
                      {itemError && (
                        <span className="mt-1 block text-[10px] text-red-400">抓取失败:{itemError}</span>
                      )}
                    </span>
                  </div>
                </button>
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
