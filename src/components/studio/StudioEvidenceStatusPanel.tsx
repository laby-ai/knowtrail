'use client';

import { FileSearch, Link as LinkIcon } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import type { Citation, RetrievalMetadata } from '@/types';

function retrievalLabel(mode: string) {
  if (mode === 'persisted-vector') return '文献向量索引';
  if (mode === 'persisted-keyword') return '文献片段检索';
  if (mode === 'request-keyword') return '请求内文献兜底';
  if (mode === 'request-text') return '仅基于当前文本生成';
  return mode;
}

function citationTargetId(citation: Citation): string | undefined {
  return citation.paperId || citation.sourceId;
}

function citationLocator(citation: Citation): string {
  const parts: string[] = [];
  if (citation.page) parts.push(`第 ${citation.page} 页`);
  if (typeof citation.chunkIndex === 'number') parts.push(`片段 ${citation.chunkIndex + 1}`);
  return parts.join(' · ');
}

export function StudioEvidenceStatusPanel({
  citations,
  retrieval,
  compact = false,
}: {
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
  compact?: boolean;
}) {
  const { revealPaper } = useApp();

  if (!retrieval && citations.length === 0) return null;

  return (
    <div className="liquid-glass-card p-3 space-y-2" data-testid="studio-evidence-status">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
        <FileSearch className="h-3.5 w-3.5" />
        <span>证据溯源</span>
      </div>
      {retrieval && (
        <div
          data-testid="studio-retrieval-badge"
          className={`rounded-lg border px-2.5 py-2 text-[11px] text-[var(--text-primary)] leading-relaxed shadow-sm ${
            retrieval.degraded
              ? 'border-amber-500/30 bg-amber-500/10'
              : 'border-[var(--border-medium)] bg-[var(--bg-card)]'
          }`}
          title={retrieval.reason || '文献证据链匹配状态'}
        >
          <span className={`font-semibold ${retrieval.degraded ? 'text-amber-700 dark:text-amber-200' : 'text-cyan-700 dark:text-cyan-300'}`}>
            {retrieval.degraded ? '证据检索已降级' : retrievalLabel(retrieval.mode)}
          </span>
          {retrieval.degraded && (
            <>
              {' · '}
              <span>{retrievalLabel(retrieval.mode)}</span>
            </>
          )}
          {' · '}
          引用线索 {citations.length}
          {' · '}
          文献源 {retrieval.persistedSourceCount}
          {' · '}
          {retrieval.vectorIndexedSourceCount > 0 ? `已向量化文献 ${retrieval.vectorIndexedSourceCount}` : '暂无向量化文献'}
          {retrieval.degraded && retrieval.reason && (
            <span className="mt-1 block text-[var(--text-secondary)]">当前溯源说明：{retrieval.reason}</span>
          )}
          <span className="mt-1 block text-[var(--text-tertiary)]">
            引用线索只代表已检索到的来源片段；关键结论仍建议回到左侧文献本核验原文。
          </span>
        </div>
      )}
      {retrieval && citations.length === 0 && (
        <div
          className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200"
          data-testid="studio-evidence-empty"
        >
          暂无可展示的引用线索。当前结果只能作为阅读初稿；请补充文献来源或换一个更具体的问题后再生成可引用结论。
        </div>
      )}
      {citations.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
            <LinkIcon className="h-3 w-3" />
            <span>{citations.length} 条引用线索</span>
          </div>
          {citations.slice(0, compact ? 2 : 3).map((citation, idx) => {
            const targetId = citationTargetId(citation);
            const locator = citationLocator(citation);
            const content = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-[10px] font-semibold text-[var(--accent-blue)]">
                    {citation.paperShortName || citation.sourceTitle || citation.sourceId || `证据 ${idx + 1}`}
                    {locator ? ` · ${locator}` : ''}
                  </div>
                  {targetId && (
                    <span className="shrink-0 text-[10px] font-medium text-[var(--text-tertiary)]">
                      定位来源
                    </span>
                  )}
                </div>
                {citation.sourceTitle && (
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{citation.sourceTitle}</div>
                )}
                {(citation.excerpt || citation.snippet) && (
                  <p className="mt-1 text-[10px] text-[var(--text-secondary)] italic leading-relaxed">
                    &ldquo;{citation.excerpt || citation.snippet}&rdquo;
                  </p>
                )}
              </>
            );

            return targetId ? (
              <button
                key={`${targetId}-${citation.chunkId || idx}`}
                type="button"
                onClick={() => revealPaper(targetId, citation)}
                className="w-full rounded-lg border-l-2 border-[var(--accent-blue)]/40 bg-black/5 px-3 py-2 text-left transition hover:bg-[var(--glass-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40"
                data-testid="studio-evidence-citation-link"
                title="定位到左侧文献本中的来源片段"
              >
                {content}
              </button>
            ) : (
              <div
                key={`${citation.sourceId || citation.paperId || idx}-${citation.chunkId || idx}`}
                className="rounded-lg border-l-2 border-[var(--accent-blue)]/40 bg-black/5 px-3 py-2"
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
