'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { ResearchReportReference } from '@/lib/research-agent-contract';
import { isResearchReportDocument, type ResearchReport } from '@/lib/research-report-document';
import { StudioEvidenceStatusPanel } from '@/components/studio/StudioEvidenceStatusPanel';

export function ReportSkillCard({ reference }: { reference: ResearchReportReference }) {
  const { storageScopeKey } = useApp();
  const [loaded, setLoaded] = useState<{ key: string; report: ResearchReport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const key = `${storageScopeKey}:${reference.revision}`;
  const report = loaded?.key === key ? loaded.report : null;
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null); setError(null);
    const query = new URLSearchParams({ kind: 'research-report', notebookId: notebookIdFromStorageScopeKey(storageScopeKey) || '', revision: reference.revision });
    void (async () => {
      try {
        const response = await clientApiRequest(`/api/studio/artifacts?${query}`, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
        if (controller.signal.aborted) return;
        const saved = payload.document;
        if (!response.ok || !saved || saved.revision !== reference.revision || !isResearchReportDocument(saved.data) || saved.data.report?.runId !== reference.runId) throw new Error(payload.error || '本轮报告暂时无法读取，请重试。');
        setLoaded({ key, report: saved.data.report });
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '报告暂时无法读取，请重试。'); }
    })();
    return () => controller.abort();
  }, [attempt, key, reference.revision, reference.runId, storageScopeKey]);
  return <div data-testid="agent-report-artifact">
    {!report && !error && <p role="status">正在读取报告…</p>}
    {error && <><p role="alert">{error}</p><button type="button" className="agent-plugin-open" onClick={() => setAttempt(value => value + 1)}>重新读取报告</button></>}
    {report && <>
      <p className="text-xs text-[var(--text-secondary)]">{reference.sourceIds.length} 份来源 · {report.citations.length} 条引用</p>
      {report.status !== 'complete' && <p role="status" className="text-xs text-amber-700">{report.researchStatus?.outputConstraint?.warning || '已保留未完成草稿，需补充章节或引用。'}</p>}
      <button type="button" className="agent-plugin-open" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起报告' : '查看本轮报告'}</button>
      {open && <div className="space-y-3 break-words" data-testid="agent-report-content">
        <div className="space-y-3 overflow-x-auto text-sm leading-relaxed [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1"><ReactMarkdown remarkPlugins={[remarkGfm]}>{report.answer}</ReactMarkdown></div>
        <StudioEvidenceStatusPanel citations={report.citations} retrieval={report.retrieval} compact />
      </div>}
    </>}
  </div>;
}
