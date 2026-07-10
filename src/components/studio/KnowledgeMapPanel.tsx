'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSearch, GitBranch, Loader2, Sparkles } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { KnowledgeMapData } from '@/lib/knowledge-map-types';
import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';

interface KnowledgeMapCacheData {
  hit: boolean;
  storedAt?: string;
}

interface KnowledgeMapSession {
  map: KnowledgeMapData;
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
  citationAudit: CitationAuditResult | null;
  cache: KnowledgeMapCacheData | null;
  sourceCount: number;
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

function normalizeMapTitle(title: string | undefined) {
  return (title || '研究脉络').replace(/资料地图|资料脉络/g, '研究脉络');
}

export function KnowledgeMapPanel() {
  const {
    activeFolderId,
    folders,
    getSelectedPapers,
    aiConfig,
    openKnowledgeMap,
    knowledgeMapViewer,
    selectAllPapers,
    storageScopeKey,
  } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const selectedPapers = getSelectedPapers();
  const activeFolderPapers = useMemo(
    () => folders.find(folder => folder.id === activeFolderId)?.papers || [],
    [activeFolderId, folders],
  );
  const availablePapers = useMemo(
    () => folders.flatMap(folder => folder.papers),
    [folders],
  );
  const mapCandidatePapers = selectedPapers.length > 0
    ? selectedPapers
    : activeFolderPapers.length > 0
      ? activeFolderPapers
      : availablePapers;
  const [session, setSession] = useState<KnowledgeMapSession | null>(() => readSessionJson(scopedSessionKey(storageScopeKey, 'knowledge_map_session'), null));
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sessionKey = scopedSessionKey(storageScopeKey, 'knowledge_map_session');
    if (session) {
      sessionStorage.setItem(sessionKey, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(sessionKey);
    }
  }, [session, storageScopeKey]);

  const openCurrentMap = useCallback((nextSession = session) => {
    if (!nextSession) return;
    const map = {
      ...nextSession.map,
      title: normalizeMapTitle(nextSession.map.title),
    };
    openKnowledgeMap({
      title: map.title,
      source: 'generated',
      sourceCount: nextSession.sourceCount,
      map,
      citations: nextSession.citations,
      retrieval: nextSession.retrieval || undefined,
      citationAudit: nextSession.citationAudit || undefined,
    });
  }, [openKnowledgeMap, session]);

  const generateMap = useCallback(async (forceRefresh = false) => {
    if (mapCandidatePapers.length === 0) {
      setError('先添加资料，再生成研究脉络。');
      return;
    }

    if (selectedPapers.length === 0) {
      const targetFolderId =
        (activeFolderId && folders.find(folder => folder.id === activeFolderId && folder.papers.length > 0)?.id) ||
        folders.find(folder => folder.papers.length > 0)?.id;
      if (targetFolderId) selectAllPapers(targetFolderId);
    }

    setIsGenerating(true);
    setError(null);
    try {
      const paperContents = mapCandidatePapers.map(paper => ({
        id: paper.id,
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        shortName: paper.shortName,
        fileName: paper.fileName,
        fileType: paper.fileType,
        abstract: paper.abstract || '',
        content: (paper.rawContent || paper.content || '').slice(0, 10000),
        rawContent: paper.rawContent,
      }));

      const response = await fetch('/api/ai/knowledge-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({ papers: paperContents, aiConfig, notebookId, forceRefresh }),
      });
      const data = await response.json();
      if (!response.ok || !data.map?.nodes?.length || !data.map?.edges?.length) {
        throw new Error(data.error || '研究脉络生成失败');
      }

      const nextSession: KnowledgeMapSession = {
        map: { ...data.map, title: normalizeMapTitle(data.map?.title) },
        citations: Array.isArray(data.citations) ? data.citations : [],
        retrieval: data.retrieval || null,
        citationAudit: data.citationAudit || null,
        cache: data.cache || null,
        sourceCount: mapCandidatePapers.length,
      };
      setSession(nextSession);
      openCurrentMap(nextSession);
    } catch (event) {
      setError(event instanceof Error ? event.message : '研究脉络生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [activeFolderId, aiConfig, folders, mapCandidatePapers, notebookId, openCurrentMap, selectAllPapers, selectedPapers.length]);

  const hasSelectedPapers = selectedPapers.length > 0;
  const hasAvailablePapers = mapCandidatePapers.length > 0;
  const activeMapOpened = Boolean(knowledgeMapViewer);

  return (
    <div className="space-y-4" data-testid="knowledge-map-panel">
      <div className="liquid-glass-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)]">
            <GitBranch className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">研究脉络</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              核心词、关系和证据。
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void generateMap(false)}
          disabled={!hasAvailablePapers || isGenerating}
          className="liquid-glass-btn mt-4 w-full px-4 py-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
          title={!hasAvailablePapers ? '请先添加资料' : '生成研究脉络并在中间工作区打开'}
          data-testid="knowledge-map-generate"
        >
          {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {!hasAvailablePapers
            ? '先添加资料'
            : isGenerating
              ? '正在生成研究脉络'
              : hasSelectedPapers
                ? '生成研究脉络'
                : `用 ${mapCandidatePapers.length} 个资料生成`}
        </button>

        {!hasSelectedPapers && (
          <div className="mt-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-3 py-3" data-testid="knowledge-map-empty-state">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
              <FileSearch className="h-3.5 w-3.5" />
              <span>{hasAvailablePapers ? '将使用当前资料库' : '先添加要分析的资料'}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              {hasAvailablePapers ? `将使用 ${mapCandidatePapers.length} 个资料。` : '添加资料后可生成。'}
            </p>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-3" data-testid="knowledge-map-error-state">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div className="min-w-0">
                <p className="text-xs text-red-300">{error}</p>
                {hasSelectedPapers && (
                  <button
                    type="button"
                    onClick={() => void generateMap(true)}
                    className="liquid-glass-btn mt-2 px-3 py-1.5 text-[11px] font-medium"
                    data-testid="knowledge-map-retry"
                  >
                    重新尝试
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {session && (
        <div className="liquid-glass-card p-4 space-y-3" data-testid="knowledge-map-summary">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span>{activeMapOpened ? '已在中间打开' : '已有研究脉络'}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            {session.map.nodes.length} 个节点 · {session.map.edges.length} 条关系 · {session.citations.length} 个引用来源。
          </p>
          {session.cache && (
            <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-300" data-testid="knowledge-map-cache-badge">
              {session.cache.hit
                ? `已从 ${formatCacheAge(session.cache.storedAt)} 的结果快速打开。`
                : '已保存本次抽取结果，同一批资料下次打开会更快。'}
            </p>
          )}
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => openCurrentMap()}
              className="liquid-glass-btn w-full px-4 py-2.5 text-[11px] font-semibold"
              data-testid="knowledge-map-open"
            >
              <GitBranch className="h-3.5 w-3.5" />
              在中间查看
            </button>
            <button
              type="button"
              onClick={() => void generateMap(true)}
              className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-4 py-2 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--glass-hover)]"
              data-testid="knowledge-map-refresh"
            >
              重新抽取脉络
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
