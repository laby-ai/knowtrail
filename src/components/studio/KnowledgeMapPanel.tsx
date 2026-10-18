'use client';

import { clientApiRequest } from '@/lib/client-api';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSearch, GitBranch, Loader2, Sparkles } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { usePrivateNotebookDocument } from '@/hooks/use-private-notebook-document';
import { emptyKnowledgeMap, isKnowledgeMapDocument, type KnowledgeMapDocument, type KnowledgeMapSession } from '@/lib/knowledge-map-document';
import type { NotebookDocument } from '@/lib/private-notebook-document';

function legacyMap(scopeKey: string): KnowledgeMapDocument | null {
  try {
    const candidate = { session: JSON.parse(sessionStorage.getItem(`lingbi:${scopeKey}:knowledge_map_session`) || 'null') };
    return candidate.session && isKnowledgeMapDocument(candidate) ? candidate : null;
  } catch { return null; }
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
  const savedMap = usePrivateNotebookDocument({ scopeKey: storageScopeKey, toolId: 'knowledge-map', endpoint: '/api/studio/artifacts?kind=knowledge-map', empty: emptyKnowledgeMap, validate: isKnowledgeMapDocument, readLegacy: legacyMap });
  const session = savedMap.data.session;
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { if (!savedMap.unsaved) setError(null); }, [savedMap.unsaved]);

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
    if (savedMap.loading || savedMap.error || savedMap.unsaved || isGenerating) return;
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
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!await savedMap.flush()) throw new Error('当前内容尚未保存，请先重试保存。');
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

      const response = await clientApiRequest('/api/ai/knowledge-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({ papers: paperContents, aiConfig, notebookId, forceRefresh, persistArtifact: !storageScopeKey.startsWith('guest:'), expectedRevision: savedMap.revision.current }),
        signal: controller.signal, timeoutMs: 120_000,
      });
      const data = await response.json() as Partial<KnowledgeMapSession> & { error?: string; document?: NotebookDocument<KnowledgeMapDocument>; unsavedDocument?: KnowledgeMapDocument };
      if (controller.signal.aborted) return;
      if (isKnowledgeMapDocument(data.unsavedDocument)) savedMap.updateLocal(() => data.unsavedDocument!);
      if (!response.ok) {
        throw new Error(data.error || '研究脉络生成失败');
      }
      const next = { session: { ...data, sourceCount: mapCandidatePapers.length } };
      if (!isKnowledgeMapDocument(next) || !next.session) throw new Error('研究脉络格式不完整，请重试。');
      const nextSession = next.session;
      if (data.document && isKnowledgeMapDocument(data.document.data)) savedMap.acceptSaved(data.document);
      else if (storageScopeKey.startsWith('guest:')) savedMap.updateLocal(() => next);
      else throw new Error('研究脉络缺少保存回执，请重新读取。');
      openCurrentMap(nextSession);
    } catch (event) {
      if (!controller.signal.aborted) setError(event instanceof Error ? event.message : '研究脉络生成失败');
    } finally {
      if (!controller.signal.aborted) setIsGenerating(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [activeFolderId, aiConfig, folders, isGenerating, mapCandidatePapers, notebookId, openCurrentMap, savedMap, selectAllPapers, selectedPapers.length, storageScopeKey]);

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
          disabled={!hasAvailablePapers || isGenerating || savedMap.loading || savedMap.unsaved || Boolean(savedMap.error)}
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

      {savedMap.loading && <p className="text-xs text-[var(--text-secondary)]" data-testid="knowledge-map-restoring">正在读取已保存研究脉络…</p>}
      {savedMap.error && <div className="rounded-xl border p-3 text-xs" role="alert" data-testid="knowledge-map-save-error">
        <p>{savedMap.error}</p>
        <button type="button" className="mt-2 underline" onClick={savedMap.conflict ? savedMap.reload : savedMap.readFailed ? savedMap.retryRead : savedMap.retry}>
          {savedMap.conflict ? '读取已保存内容（将替换当前草稿）' : savedMap.readFailed ? '重试读取' : '重试保存'}
        </button>
      </div>}
      {savedMap.unsaved && !savedMap.error && !isGenerating && <button type="button" className="text-xs underline" onClick={savedMap.retry}>内容尚未保存，重试保存</button>}
      {storageScopeKey.startsWith('guest:') && <p className="text-xs text-[var(--text-secondary)]">访客研究脉络仅保存在当前浏览器。</p>}
      {session && !savedMap.loading && (
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
