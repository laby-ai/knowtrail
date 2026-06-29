'use client';

import { useState } from 'react';
import { AlertTriangle, ClipboardCopy, Loader2, Send } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';
import type { StudioArtifactToolId } from '@/lib/studio-tools';
import { STUDIO_ARTIFACT_TOOLS, type StudioToolItem } from './StudioToolSwitcher';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';

type StudioToolRunStatus = 'idle' | 'running' | 'succeeded' | 'failed';

interface StudioToolArtifactResult {
  artifact: {
    id: string;
    type: StudioArtifactToolId;
    title: string;
    markdown: string;
    createdAt: string;
    generationPattern: string;
    resultShape: string[];
  };
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
  citationAudit?: CitationAuditResult;
}

export function StudioArtifactToolPanel({ toolId }: { toolId: StudioToolItem['id'] }) {
  const { getSelectedPapers, aiConfig, storageScopeKey } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const tool = STUDIO_ARTIFACT_TOOLS.find(item => item.id === toolId) ?? STUDIO_ARTIFACT_TOOLS[0];
  const selectedCount = getSelectedPapers().length;
  const hasSelectedPapers = selectedCount > 0;
  const Icon = tool.icon;
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<StudioToolRunStatus>('idle');
  const [result, setResult] = useState<StudioToolArtifactResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!hasSelectedPapers) return;
    setRunStatus('running');
    setError(null);
    setResult(null);
    setLastSubmittedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    try {
      const response = await fetch('/api/ai/studio-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          toolId: tool.id,
          notebookId,
          papers: getSelectedPapers(),
          aiConfig,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || `${tool.label}生成失败`);
      }
      setResult({
        artifact: payload.artifact,
        citations: payload.citations || [],
        retrieval: payload.retrieval || null,
        citationAudit: payload.citationAudit,
      });
      setRunStatus('succeeded');
    } catch (err) {
      setError(err instanceof Error ? err.message : `${tool.label}生成失败`);
      setRunStatus('failed');
    }
  };

  const handleCopy = async () => {
    if (!result?.artifact.markdown) return;
    await navigator.clipboard.writeText(result.artifact.markdown).catch(() => undefined);
  };

  return (
    <div className="space-y-5">
      <div className="liquid-glass-card p-5" data-testid={`studio-tool-panel-${tool.id}`}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)]">
            <Icon className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{tool.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{tool.desc}</p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-3 py-3">
          <div
            data-testid={`studio-tool-result-shape-${tool.id}`}
            className="flex flex-wrap gap-1.5"
          >
            {tool.resultShape.map(item => (
              <span
                key={item}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)]"
              >
                {item}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">{tool.generationPattern}</p>
        </div>
        {lastSubmittedAt && (
          <div
            data-testid={`studio-tool-submitted-${tool.id}`}
            className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[11px] leading-relaxed text-blue-700 dark:text-blue-200"
        >
            已在 {lastSubmittedAt} 开始生成。右侧产物会保留资料来源和引用检查；失败后可直接重试。
          </div>
        )}
        {runStatus === 'running' && (
          <div
            data-testid={`studio-tool-running-${tool.id}`}
            className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3"
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-primary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>正在生成 {tool.label}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] text-[var(--text-secondary)]">
              {['检索资料', '生成大纲', '整理产物'].map(step => (
                <div key={step} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-2 py-1.5 text-center">
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}
        {error && (
          <div
            data-testid={`studio-tool-error-${tool.id}`}
            className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-700 dark:text-red-200"
          >
            {error}
          </div>
        )}
        <button
          type="button"
          data-testid={`studio-tool-run-${tool.id}`}
          onClick={handleRun}
          disabled={!hasSelectedPapers || runStatus === 'running'}
          className="liquid-glass-btn mt-4 w-full px-4 py-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          title={hasSelectedPapers ? `${tool.actionLabel}，生成可复核结果` : '请先在左侧选择资料'}
        >
          {runStatus === 'running' ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在生成</>
          ) : hasSelectedPapers ? (
            <><Send className="h-3.5 w-3.5" /> {tool.actionLabel}</>
          ) : (
            <><AlertTriangle className="h-3.5 w-3.5" /> 先选择资料</>
          )}
        </button>
      </div>
      {result && (
        <div className="liquid-glass-card p-5 space-y-4" data-testid={`studio-tool-result-${tool.id}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{result.artifact.title}产物</p>
              <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                {new Date(result.artifact.createdAt).toLocaleString('zh-CN')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="liquid-glass-btn px-3 py-2 text-[11px]"
              title="复制产物 Markdown"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              复制
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {result.artifact.markdown}
            </pre>
          </div>
          <StudioEvidenceStatusPanel
            citations={result.citations}
            retrieval={result.retrieval}
            compact
          />
          {result.citationAudit && (
            <div
              data-testid={`studio-tool-citation-audit-${tool.id}`}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]"
            >
              引用审计：{result.citationAudit.status} · 引用 {result.citationAudit.citationCount} · 标记 {result.citationAudit.markerCount}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
