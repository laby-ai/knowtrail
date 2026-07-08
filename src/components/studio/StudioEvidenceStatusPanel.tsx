'use client';

import { FileSearch, Link as LinkIcon } from 'lucide-react';
import type { Citation, RetrievalMetadata } from '@/types';

function retrievalLabel(mode: string) {
  if (mode === 'persisted-vector') return '文献向量索引';
  if (mode === 'persisted-keyword') return '文献片段检索';
  if (mode === 'request-keyword') return '请求内文献兜底';
  if (mode === 'request-text') return '仅基于当前文本生成';
  return mode;
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
        </div>
      )}
      {retrieval && citations.length === 0 && (
        <div
          className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200"
          data-testid="studio-evidence-empty"
        >
          暂无可展示的引用线索。当前回答可以作为阅读初稿，关键结论仍需回到原文片段复核。
        </div>
      )}
      {citations.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
            <LinkIcon className="h-3 w-3" />
            <span>{citations.length} 条引用线索</span>
          </div>
          {citations.slice(0, compact ? 2 : 3).map((citation, idx) => (
            <div key={`${citation.sourceId || citation.paperId || idx}-${citation.chunkId || idx}`} className="rounded-lg border-l-2 border-[var(--accent-blue)]/40 bg-black/5 px-3 py-2">
              <div className="text-[10px] font-semibold text-[var(--accent-blue)]">
                {citation.paperShortName || citation.sourceTitle || citation.sourceId || `证据 ${idx + 1}`}
                {citation.page ? ` · 第 ${citation.page} 页` : ''}
              </div>
              {citation.sourceTitle && (
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{citation.sourceTitle}</div>
              )}
              {(citation.excerpt || citation.snippet) && (
                <p className="mt-1 text-[10px] text-[var(--text-secondary)] italic leading-relaxed">
                  &ldquo;{citation.excerpt || citation.snippet}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
