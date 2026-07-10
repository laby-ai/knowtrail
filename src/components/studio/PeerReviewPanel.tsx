'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, Download } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { PeerReviewAudit, PeerReviewComment, PeerReviewPerspective, PeerReviewReport } from '@/lib/peer-review-contract';
import type { Citation, Paper, RetrievalMetadata } from '@/types';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';

type PanelStatus = 'idle' | 'running' | 'complete' | 'error';

const STAGES: StudioJobProgressStage[] = [
  { key: 'reading', label: '定位稿件片段' },
  { key: 'reviewing', label: '形成具体意见' },
  { key: 'auditing', label: '核对证据边界' },
];

const PERSPECTIVES: Array<{ id: PeerReviewPerspective; label: string }> = [
  { id: 'overall', label: '全文逻辑与可靠性' },
  { id: 'methodology', label: '方法与统计严谨性' },
  { id: 'evidence', label: '主张与证据边界' },
  { id: 'clarity', label: '结构与表达清晰度' },
];

function toPaperRequest(paper: Paper) {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    abstract: paper.abstract,
    content: paper.content,
    rawContent: paper.rawContent,
    shortName: paper.shortName,
    keywords: paper.keywords,
    fileName: paper.fileName,
    fileType: paper.fileType,
  };
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: string; msg?: string } | null;
  return payload?.error || payload?.msg || `请求失败（HTTP ${response.status}）`;
}

function downloadMarkdown(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function evidenceLabel(comment: PeerReviewComment): string {
  if (comment.evidenceStatus === 'source-supported') return `来源支持 ${comment.evidenceMarkers.map(marker => `[${marker}]`).join('、')}`;
  if (comment.evidenceStatus === 'manuscript') return '稿件内证据';
  return '待核验';
}

function ReviewCommentCard({ comment, tone }: { comment: PeerReviewComment; tone: 'major' | 'minor' }) {
  return (
    <article className={`rounded-lg border p-3 ${tone === 'major' ? 'border-rose-400/25 bg-rose-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-card)]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-xs font-semibold text-[var(--text-primary)]">{comment.location}</h4>
        <span className="rounded-md bg-[var(--glass-subtle)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">{evidenceLabel(comment)}</span>
      </div>
      <blockquote className="mt-2 border-l-2 border-[var(--accent-blue)]/40 pl-2 text-[11px] italic leading-relaxed text-[var(--text-secondary)]">“{comment.excerpt}”</blockquote>
      <dl className="mt-3 grid gap-2 text-[11px] leading-relaxed">
        <div><dt className="font-semibold text-[var(--text-primary)]">问题</dt><dd className="text-[var(--text-secondary)]">{comment.problem}</dd></div>
        <div><dt className="font-semibold text-[var(--text-primary)]">为何重要</dt><dd className="text-[var(--text-secondary)]">{comment.importance}</dd></div>
        <div><dt className="font-semibold text-[var(--text-primary)]">建议动作</dt><dd className="text-[var(--text-secondary)]">{comment.action}</dd></div>
      </dl>
    </article>
  );
}

export function PeerReviewPanel() {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const selectedPapers = getSelectedPapers();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const abortRef = useRef<AbortController | null>(null);
  const [manuscript, setManuscript] = useState('');
  const [scope, setScope] = useState('全文逻辑、方法严谨性与证据边界');
  const [perspective, setPerspective] = useState<PeerReviewPerspective>('overall');
  const [report, setReport] = useState<PeerReviewReport | null>(null);
  const [audit, setAudit] = useState<PeerReviewAudit | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalMetadata | null>(null);
  const [reviewLimits, setReviewLimits] = useState<string[]>([]);
  const [artifactMarkdown, setArtifactMarkdown] = useState('');
  const [artifactFileName, setArtifactFileName] = useState('peer-review-report.md');
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [stage, setStage] = useState('reading');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('粘贴稿件并选择审查视角后开始。');
  const [error, setError] = useState<string | null>(null);

  const sourceSummary = useMemo(
    () => selectedPapers.slice(0, 3).map(paper => paper.shortName || paper.title).join('、'),
    [selectedPapers],
  );
  const formReady = manuscript.trim().length >= 100 && scope.trim().length >= 2;

  const runReview = useCallback(async () => {
    if (!formReady || status === 'running') return;
    const papers = getSelectedPapers();
    const controller = new AbortController();
    abortRef.current = controller;
    setReport(null);
    setAudit(null);
    setCitations([]);
    setRetrieval(null);
    setReviewLimits([]);
    setArtifactMarkdown('');
    setError(null);
    setStatus('running');
    setStage('reading');
    setProgress(12);
    setMessage('正在定位稿件中的节、段和确切片段。');
    let finalReport: PeerReviewReport | null = null;
    try {
      const response = await fetch('/api/ai/peer-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          manuscript: manuscript.trim(),
          scope: scope.trim(),
          perspective,
          papers: papers.map(toPaperRequest),
          notebookId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readError(response));
      if (!response.body) throw new Error('服务未返回论文审查流。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const chunk = await reader.read();
        finished = chunk.done;
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !finished });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const event of events) {
          const dataLine = event.split('\n').find(line => line.startsWith('data: '));
          if (!dataLine) continue;
          const raw = dataLine.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          const payload = JSON.parse(raw) as {
            progress?: { stage?: string; progress?: number; message?: string };
            citations?: Citation[];
            retrieval?: RetrievalMetadata | null;
            report?: PeerReviewReport;
            audit?: PeerReviewAudit;
            reviewLimits?: string[];
            artifactMarkdown?: string;
            artifactFileName?: string;
            error?: string;
          };
          if (payload.progress) {
            if (payload.progress.stage) setStage(payload.progress.stage);
            if (typeof payload.progress.progress === 'number') setProgress(payload.progress.progress);
            if (payload.progress.message) setMessage(payload.progress.message);
          }
          if (payload.citations) setCitations(payload.citations);
          if (payload.retrieval !== undefined) setRetrieval(payload.retrieval);
          if (payload.report) { finalReport = payload.report; setReport(payload.report); }
          if (payload.audit) setAudit(payload.audit);
          if (payload.reviewLimits) setReviewLimits(payload.reviewLimits);
          if (payload.artifactMarkdown) setArtifactMarkdown(payload.artifactMarkdown);
          if (payload.artifactFileName) setArtifactFileName(payload.artifactFileName);
          if (payload.error) throw new Error(payload.error);
        }
      }
      if (!finalReport) throw new Error('没有生成通过稿件定位和证据检查的审查报告。');
      setStatus('complete');
      setStage('auditing');
      setProgress(100);
      setMessage('意见定位和证据状态检查通过；报告仍需作者或领域专家复核。');
    } catch (caught) {
      const stopped = controller.signal.aborted;
      const userMessage = stopped
        ? '已停止审查；未通过完整定位检查的报告不会展示。'
        : caught instanceof Error ? caught.message : '论文审查暂时不可用，请稍后重试。';
      setReport(null);
      setAudit(null);
      setArtifactMarkdown('');
      setError(userMessage);
      setStatus(stopped ? 'idle' : 'error');
      setMessage(userMessage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [formReady, getSelectedPapers, manuscript, notebookId, perspective, scope, status]);

  return (
    <div className="space-y-4" data-testid="peer-review-panel">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><ClipboardCheck className="h-4 w-4 text-violet-500" />只读论文审查</div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">逐条定位稿件原文，说明问题、重要性和建议动作；不会直接改稿，也不输出接收、拒稿或评分。</p>
      </div>

      <label className="block">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">稿件文本</span>
        <textarea value={manuscript} onChange={event => setManuscript(event.target.value)} maxLength={30000} disabled={status === 'running'} data-testid="peer-review-manuscript" placeholder="粘贴需要审查的稿件正文（至少 100 个字符）。请保留章节标题，便于定位意见。" className="mt-1.5 min-h-48 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm leading-6 text-[var(--text-primary)] outline-none focus:border-violet-400/60" />
        <span className="mt-1 block text-right text-[10px] text-[var(--text-quaternary)]">{manuscript.length}/30000</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">审查视角</span>
          <select value={perspective} onChange={event => setPerspective(event.target.value as PeerReviewPerspective)} disabled={status === 'running'} data-testid="peer-review-perspective" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]">{PERSPECTIVES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">审查范围</span>
          <input value={scope} onChange={event => setScope(event.target.value)} maxLength={400} disabled={status === 'running'} data-testid="peer-review-scope" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]" data-testid="peer-review-source-status">
        {selectedPapers.length === 0
          ? '未选择外部来源：仍可审查稿件内部逻辑；外部事实和规范问题将标为待核验。'
          : `将参考 ${selectedPapers.length} 个已选来源：${sourceSummary}${selectedPapers.length > 3 ? ' 等' : ''}。来源线索仍需回到原文核验。`}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="peer-review-start" onClick={() => void runReview()} disabled={!formReady || status === 'running'} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">开始只读审查</button>
        {artifactMarkdown && <button type="button" data-testid="peer-review-download" onClick={() => downloadMarkdown(artifactMarkdown, artifactFileName)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]"><Download className="h-3.5 w-3.5" />下载审查报告</button>}
      </div>

      {status === 'running' && <StudioJobProgress title="论文审查进行中" message={message} stages={STAGES} currentStageKey={stage} progressPercent={progress} hint="无法定位到稿件原文、证据状态冲突或包含编辑评分时，报告会被拒绝。" onCancel={() => abortRef.current?.abort()} cancelLabel="停止审查" testId="peer-review-progress" />}
      {error && <div className="flex gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 p-3 text-[11px] text-rose-700 dark:text-rose-200" data-testid="peer-review-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

      {report && audit && (
        <div className="space-y-4" data-testid="peer-review-result">
          <div className="flex gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 text-[11px] text-emerald-700 dark:text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>
          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3"><h3 className="text-sm font-semibold text-[var(--text-primary)]">{report.title}</h3><p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">{report.summary.manuscriptFocus}</p><p className="mt-2 text-xs leading-6 text-[var(--text-primary)]">{report.summary.overallAssessment}</p></section>
          <section><h3 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">主要优点</h3><ul className="space-y-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{report.strengths.map(item => <li key={item}>• {item}</li>)}</ul></section>
          <section data-testid="peer-review-major-comments"><h3 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">Major Comments</h3><div className="space-y-2">{report.majorComments.length ? report.majorComments.map((comment, index) => <ReviewCommentCard key={`${comment.location}-${index}`} comment={comment} tone="major" />) : <p className="text-[11px] text-[var(--text-tertiary)]">无。</p>}</div></section>
          <section data-testid="peer-review-minor-comments"><h3 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">Minor Comments</h3><div className="space-y-2">{report.minorComments.length ? report.minorComments.map((comment, index) => <ReviewCommentCard key={`${comment.location}-${index}`} comment={comment} tone="minor" />) : <p className="text-[11px] text-[var(--text-tertiary)]">无。</p>}</div></section>
          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3"><h3 className="text-xs font-semibold text-[var(--text-primary)]">给作者的问题</h3><ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{report.questions.map(item => <li key={item}>• {item}</li>)}</ul></section>
          <StudioEvidenceStatusPanel citations={citations} retrieval={retrieval} />
          <section className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-3"><h3 className="text-xs font-semibold text-amber-800 dark:text-amber-200">审查边界</h3><div className="mt-2 space-y-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">{[...report.limitations, ...reviewLimits].map(item => <div key={item}>• {item}</div>)}</div></section>
        </div>
      )}
    </div>
  );
}
