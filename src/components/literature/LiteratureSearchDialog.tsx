'use client';
import { checkedApiFetch } from '@/lib/api-response';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useResearchPreferences } from '@/components/research/ResearchPreferencesProvider';
import { RESEARCH_DISCIPLINES } from '@/lib/research-preferences';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  ExternalLink,
  FileText,
  Quote,
  Plus,
  Check,
  BookOpen,
} from 'lucide-react';
import type { LiteratureResult, LiteratureProviderId, CitationStyle, LiteratureMetadata, LiteratureImportFeedback } from '@/lib/literature/types';
import { sameLiteratureEntry } from '@/lib/literature/library';
import { copyTextWithFallback } from '@/lib/clipboard';
import { clientApiRequest } from '@/lib/client-api';

const SOURCE_LABELS: Record<LiteratureProviderId, string> = {
  crossref: 'Crossref',
  europepmc: 'Europe PMC',
  'semantic-scholar': 'Semantic Scholar',
  openalex: 'OpenAlex',
  arxiv: 'arXiv',
  pubmed: 'PubMed',
  scite: 'Scite',
  giiisp: '集思谱',
};

const SOURCE_COLORS: Record<LiteratureProviderId, string> = {
  crossref: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  europepmc: 'bg-green-500/10 text-green-400 border-green-500/20',
  'semantic-scholar': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  openalex: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  arxiv: 'bg-red-500/10 text-red-400 border-red-500/20',
  pubmed: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  scite: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  giiisp: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
};

const CITATION_STYLES: { value: CitationStyle; label: string }[] = [
  { value: 'apa', label: 'APA 7th' },
  { value: 'GB/T 7714', label: 'GB/T 7714' },
  { value: 'mla', label: 'MLA 9th' },
  { value: 'chicago', label: 'Chicago 17th' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'vancouver', label: 'Vancouver' },
  { value: 'bibtex', label: 'BibTeX' },
];

const YEAR_RANGES: { value: string; label: string; from?: number; to?: number }[] = [
  { value: 'all', label: '全部年份' },
  { value: '1', label: '近 1 年', from: new Date().getFullYear() - 1 },
  { value: '3', label: '近 3 年', from: new Date().getFullYear() - 3 },
  { value: '5', label: '近 5 年', from: new Date().getFullYear() - 5 },
  { value: '10', label: '近 10 年', from: new Date().getFullYear() - 10 },
];


interface LiteratureSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToLibrary?: (result: LiteratureResult) => Promise<LiteratureImportFeedback>;
  existingLiterature?: LiteratureMetadata[];
  targetLabel?: string;
  addDisabledReason?: string;
  notebookId?: string | null;
}

export function LiteratureSearchDialog({
  open, onOpenChange, onAddToLibrary,
  existingLiterature = [], targetLabel, addDisabledReason, notebookId,
}: LiteratureSearchDialogProps) {
  const [addingId, setAddingId] = useState<string | null>(null);
  const addingRef = useRef(false);
  const searchGenerationRef = useRef(0);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [importFeedback, setImportFeedback] = useState<Record<string, LiteratureImportFeedback>>({});
  const [query, setQuery] = useState('');
  const [engine, setEngine] = useState('standard');
  const [mcpMode, setMcpMode] = useState('oa');
  const [selectedSources, setSelectedSources] = useState<Set<LiteratureProviderId>>(
    new Set(['crossref', 'europepmc', 'semantic-scholar', 'openalex', 'arxiv', 'pubmed', 'scite'])
  );
  const [results, setResults] = useState<LiteratureResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [citeError, setCiteError] = useState<string | null>(null);
  const [citeStyle, setCiteStyle] = useState<CitationStyle>('apa');
  const { preferences, loaded: preferencesLoaded } = useResearchPreferences();
  const sourcesChanged = useRef(false);
  const citationChanged = useRef(false);
  const defaults = preferences.researchMode ? RESEARCH_DISCIPLINES.find(item => item.id === preferences.disciplines[0]) : undefined;
  useEffect(() => {
    if (!preferencesLoaded || !defaults) return;
    if (!sourcesChanged.current) setSelectedSources(new Set(defaults.sources));
    if (!citationChanged.current) setCiteStyle(defaults.citationStyle);
  }, [defaults, preferencesLoaded]);
  const [yearRange, setYearRange] = useState<string>('all');

  const toggleSource = useCallback((source: LiteratureProviderId) => {
    sourcesChanged.current = true;
    setSelectedSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) {
        if (next.size > 1) next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    const generation = ++searchGenerationRef.current;
    setLoading(true);
    setError(null);
    setResults([]);
    setAddErrors({});
    setImportFeedback({});
    setCiteError(null);
    setCopiedId(null);

    const range = YEAR_RANGES.find(r => r.value === yearRange);
    const yearFrom = range?.from;
    const yearTo = range?.to;

    try {
      const res = await clientApiRequest(engine === 'giiisp' ? '/api/literature/mcp-search' : '/api/literature/search', {
        timeoutMs: engine === 'giiisp' ? 110_000 : 30_000,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          sources: Array.from(selectedSources),
          limitPerSource: 10,
          yearFrom,
          yearTo,
          ...(engine === 'giiisp' ? { notebookId, mode: mcpMode } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `搜索失败 (${res.status})`);
      }

      const data = await res.json();
      if (generation === searchGenerationRef.current) setResults(data.results || []);
    } catch (err) {
      if (generation === searchGenerationRef.current) setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      if (generation === searchGenerationRef.current) setLoading(false);
    }
  }, [query, selectedSources, yearRange, engine, notebookId, mcpMode]);

  const handleAddToLibrary = async (result: LiteratureResult) => {
    if (!onAddToLibrary || addDisabledReason || addingRef.current) return;
    if (existingLiterature.some(paper => paper.evidenceScope === 'fulltext' && sameLiteratureEntry(paper, result))
      || importFeedback[result.resultId]?.literature.evidenceScope === 'fulltext') return;
    const generation = searchGenerationRef.current;
    addingRef.current = true;
    setAddingId(result.resultId);
    setAddErrors(prev => {
      const next = { ...prev };
      delete next[result.resultId];
      return next;
    });
    setImportFeedback(prev => {
      const next = { ...prev };
      delete next[result.resultId];
      return next;
    });
    try {
      const feedback = await onAddToLibrary(result);
      if (generation === searchGenerationRef.current) {
        setImportFeedback(prev => ({ ...prev, [result.resultId]: feedback }));
      }
    } catch (err) {
      if (generation === searchGenerationRef.current) {
        setAddErrors(prev => ({
          ...prev,
          [result.resultId]: err instanceof Error ? err.message : '入库或补全文失败，请重试。',
        }));
      }
    } finally {
      addingRef.current = false;
      setAddingId(null);
    }
  };

  const handleCite = useCallback(async (result: LiteratureResult) => {
    const generation = searchGenerationRef.current;
    setCiteError(null);
    try {
      const res = await checkedApiFetch('/api/literature/cite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          papers: [{
            title: result.title,
            authors: result.authors,
            year: result.year,
            doi: result.doi,
            arxivId: result.arxivId,
            venue: result.venue,
            url: result.url,
          }],
          style: citeStyle,
        }),
      });

      if (!res.ok) throw new Error('引用格式化失败');

      const data = await res.json();
      if (generation !== searchGenerationRef.current) return;
      const citation = data.citations?.[0] || '';
      if (!citation) throw new Error('引用内容为空');

      const ok = await copyTextWithFallback(citation);
      if (generation !== searchGenerationRef.current) return;
      if (!ok) {
        setCiteError('复制失败，请手动复制: ' + citation);
        return;
      }
      setCopiedId(result.resultId);
      setTimeout(() => {
        if (generation === searchGenerationRef.current) setCopiedId(null);
      }, 3000);
    } catch (err) {
      if (generation !== searchGenerationRef.current) return;
      const message = err instanceof Error ? err.message : '引用格式化失败';
      setCiteError(message);
    }
  }, [citeStyle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="liquid-glass-card max-w-3xl sm:max-w-3xl flex flex-col overflow-hidden"
        style={{
          height: '85vh',
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            文献检索
          </DialogTitle>
          {onAddToLibrary && (
            <p className="text-xs text-[var(--text-secondary)]">
              添加到：{targetLabel || '当前文献库'}。默认尝试获取并保存合法开放全文；未获取到时保存题录/摘要，可重试补全文。
              {addDisabledReason && <span className="text-amber-600"> {addDisabledReason}</span>}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="space-y-3 flex-shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={engine === 'standard' ? 'default' : 'outline'} disabled={loading} onClick={() => { setEngine('standard'); setResults([]); }}>多库检索</Button>
              <Button variant={engine === 'giiisp' ? 'default' : 'outline'} disabled={loading || !notebookId} onClick={() => { setEngine('giiisp'); setResults([]); }}>集思谱检索</Button>
              {engine === 'giiisp' && <Select value={mcpMode} onValueChange={setMcpMode}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="oa">开放论文</SelectItem><SelectItem value="arxiv-title">arXiv 题名</SelectItem><SelectItem value="arxiv-abstract">arXiv 摘要</SelectItem><SelectItem value="arxiv-id">arXiv 编号</SelectItem><SelectItem value="arxiv-multi">arXiv 多字段</SelectItem></SelectContent></Select>}
            </div>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="输入关键词搜索文献..."
                  aria-label="文献检索关键词"
                  className="liquid-glass-input h-14"
                  style={{ fontSize: 16, padding: '14px 16px' }}
                />
              </div>
              <Button className="h-14 shrink-0 px-5 text-base" onClick={handleSearch} disabled={loading || !query.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
              </Button>
            </div>

            {engine === 'standard' && <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(SOURCE_LABELS) as LiteratureProviderId[]).filter(source => source !== 'giiisp').map(source => (
                  <button
                    key={source}
                    onClick={() => toggleSource(source)}
                    className={`px-2 py-0.5 text-xs rounded-full border transition-all ${
                      selectedSources.has(source)
                        ? `${SOURCE_COLORS[source]} ${loading ? 'animate-pulse' : ''}`
                        : 'bg-[var(--glass-subtle)] text-[var(--text-tertiary)] border-[var(--glass-border)] opacity-50'
                    }`}
                  >
                    {loading && selectedSources.has(source) ? '⟳ ' : ''}{SOURCE_LABELS[source]}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text-quaternary)]">点击切换数据源，选中后将从该数据库检索文献</p>
            </div>}

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-tertiary)]">引用格式:</span>
                <Select value={citeStyle} onValueChange={v => { citationChanged.current = true; setCiteStyle(v as CitationStyle); }}>
                  <SelectTrigger className="h-7 min-w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CITATION_STYLES.map(s => (
                      <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-tertiary)]">时间范围:</span>
                <Select value={yearRange} onValueChange={setYearRange}>
                  <SelectTrigger className="h-7 min-w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEAR_RANGES.map(r => (
                      <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loading && (
              <div role="status" className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>
                  正在通过 {Array.from(selectedSources).map(s => SOURCE_LABELS[s]).join('、')} 检索...
                </span>
              </div>
            )}

            {citeError && (
              <div role="alert" className="text-xs px-3 py-2 rounded-lg border border-red-400/25 bg-red-500/10 text-red-300">
                {citeError}
              </div>
            )}

            {error && (
              <div role="alert" className="text-sm border border-red-400/25 rounded-md p-3 bg-red-500/10 text-red-300">
                {error}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 mt-3 overflow-y-scroll pr-2">
            <div className="space-y-3">
              {results.map(result => {
                const feedback = importFeedback[result.resultId];
                const existing = existingLiterature.find(paper => paper.evidenceScope === 'fulltext' && sameLiteratureEntry(paper, result))
                  || existingLiterature.find(paper => sameLiteratureEntry(paper, result));
                const saved = existing?.evidenceScope === 'fulltext' ? existing : feedback?.literature || existing;
                const hasFullText = saved?.evidenceScope === 'fulltext';
                const isAdding = addingId === result.resultId;
                const fullText = feedback?.fullText;
                return (
                <div
                  key={result.resultId}
                  className="border border-[var(--glass-border)] rounded-lg p-3 space-y-2 bg-[var(--glass-subtle)] hover:border-[var(--border-hover)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium leading-snug flex-1">
                      {result.title}
                    </h3>
                    <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${SOURCE_COLORS[result.source]}`}>
                      {SOURCE_LABELS[result.source]}
                    </Badge>
                  </div>

                  <div className="text-xs text-[var(--text-secondary)]">
                    {result.authors.slice(0, 3).map(a => a.name).join(', ')}
                    {result.authors.length > 3 && ' et al.'}
                    {' · '}
                    {result.year || '年份未知'}
                    {result.venue && ` · ${result.venue}`}
                  </div>

                  {result.abstract && (
                    <p className="text-xs text-[var(--text-tertiary)] line-clamp-3">
                      检索摘要：{result.abstract}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {onAddToLibrary && (
                      <Button
                        variant="outline"
                        size="sm"
                        className={`h-7 text-xs gap-1 ${
                          hasFullText
                            ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                            : 'border-blue-400/25 bg-blue-500/10 text-blue-300'
                        }`}
                        disabled={hasFullText || addingId !== null || Boolean(addDisabledReason)}
                        onClick={() => void handleAddToLibrary(result)}
                      >
                        {isAdding ? <Loader2 className="h-3 w-3 animate-spin" />
                          : hasFullText ? <Check className="h-3 w-3" />
                            : saved ? <FileText className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        加入当前文献库
                      </Button>
                    )}
                    <span className={`text-[10px] ${hasFullText ? 'text-emerald-300' : 'text-[var(--text-secondary)]'}`}>
                      {saved
                        ? `已入库：${hasFullText ? '全文' : saved.evidenceScope === 'abstract' ? '仅摘要' : '仅题录'}`
                        : `检索结果：${result.evidenceScope === 'fulltext' ? '全文' : result.evidenceScope === 'abstract' ? '摘要' : '题录'}（未入库）`}
                    </span>

                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 text-xs gap-1 ${
                        copiedId === result.resultId ? '!bg-green-500/10 !text-green-400' : ''
                      }`}
                      onClick={() => handleCite(result)}
                    >
                      {copiedId === result.resultId ? (
                        <>
                          <Check className="h-3 w-3 text-green-400" />
                          <span className="text-green-400">已复制</span>
                        </>
                      ) : (
                        <>
                          <Quote className="h-3 w-3" />
                          引用
                        </>
                      )}
                    </Button>

                    {result.url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs gap-1"
                        onClick={() => window.open(result.url, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3" />
                        原文
                      </Button>
                    )}

                    {result.alsoFoundIn.length > 0 && (
                      <span className="text-[10px] text-[var(--text-quaternary)] ml-auto">
                        也在 {result.alsoFoundIn.map(s => SOURCE_LABELS[s]).join(', ')} 中找到
                      </span>
                    )}
                  </div>

                  {isAdding && (
                    <div role="status" className="text-xs px-2 py-1 rounded border border-blue-400/25 bg-blue-500/10 text-blue-300">
                      正在获取合法开放全文并保存到文献库...
                    </div>
                  )}
                  {fullText && !isAdding && (
                    <div role="status" className={`text-xs px-2 py-1 rounded border ${hasFullText ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-400/25 bg-amber-500/10 text-amber-300'}`}>
                      {fullText.status === 'partial' && !hasFullText
                        ? `已保存${saved?.evidenceScope === 'abstract' ? '题录/摘要' : '题录'}，全文未获取：${fullText.message} 可再次点击"加入当前文献库"，获取成功后更新原条目。`
                        : fullText.status === 'existing' ? '全文已在当前文献库，已复用保存的正文。' : '全文已保存到当前文献库。'}
                    </div>
                  )}
                  {addErrors[result.resultId] && (
                    <div role="alert" className="text-xs px-2 py-1 rounded border border-red-400/25 bg-red-500/10 text-red-300">
                      {addErrors[result.resultId]}
                    </div>
                  )}
                </div>
                );
              })}

              {!loading && results.length === 0 && !error && (
                <div className="text-center text-sm text-[var(--text-tertiary)] py-8">
                  输入关键词开始搜索文献
                </div>
              )}
            </div>
          </div>

          {results.length > 0 && (
            <>
              <Separator />
              <div className="text-xs text-[var(--text-tertiary)]">
                共 {results.length} 条结果
                {onAddToLibrary && ' · 入库时尝试获取全文；题录/摘要条目可补全文'}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
