'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, BookOpenText, CheckCircle2, Download } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import type { AcademicWritingDraft, AcademicWritingSection } from '@/lib/academic-writing-contract';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { Citation, Paper, RetrievalMetadata } from '@/types';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';

type PanelStatus = 'idle' | 'running' | 'complete' | 'incomplete' | 'error';
type WritingStatusPayload = {
  answerStatus?: 'complete' | 'incomplete' | 'no-evidence';
  invalidEvidenceMarkers?: number[];
  retrievalLimits?: string[];
};

const STAGES: StudioJobProgressStage[] = [
  { key: 'retrieving', label: '匹配章节证据' },
  { key: 'evidence-ready', label: '建立大纲与主张边界' },
  { key: 'drafting', label: '起草段落与映射' },
  { key: 'auditing', label: '检查引用与局限' },
];

const SECTION_OPTIONS: Array<{ id: AcademicWritingSection; label: string }> = [
  { id: 'introduction', label: '引言' },
  { id: 'related-work', label: '相关工作' },
  { id: 'discussion', label: '讨论' },
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

export function AcademicWritingPanel() {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const selectedPapers = getSelectedPapers();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const abortRef = useRef<AbortController | null>(null);
  const [writingGoal, setWritingGoal] = useState('');
  const [targetSection, setTargetSection] = useState<AcademicWritingSection>('introduction');
  const [audience, setAudience] = useState('');
  const [requirements, setRequirements] = useState('');
  const [draft, setDraft] = useState<AcademicWritingDraft | null>(null);
  const [artifactMarkdown, setArtifactMarkdown] = useState('');
  const [artifactFileName, setArtifactFileName] = useState('academic-section-draft.md');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalMetadata | null>(null);
  const [writingStatus, setWritingStatus] = useState<WritingStatusPayload | null>(null);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [stage, setStage] = useState('retrieving');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('选择来源并说明章节目标后开始。');
  const [error, setError] = useState<string | null>(null);

  const sourceSummary = useMemo(
    () => selectedPapers.slice(0, 3).map(paper => paper.shortName || paper.title).join('、'),
    [selectedPapers],
  );
  const formReady = writingGoal.trim().length >= 8;

  const runWriting = useCallback(async () => {
    const papers = getSelectedPapers();
    if (!formReady || papers.length === 0 || status === 'running') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft(null);
    setArtifactMarkdown('');
    setCitations([]);
    setRetrieval(null);
    setWritingStatus(null);
    setError(null);
    setStatus('running');
    setStage('retrieving');
    setProgress(12);
    setMessage('正在匹配选定来源与章节目标。');

    let finalDraft: AcademicWritingDraft | null = null;
    let finalStatus: WritingStatusPayload | null = null;
    try {
      const response = await fetch('/api/ai/academic-writing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          writingGoal: writingGoal.trim(),
          targetSection,
          audience: audience.trim(),
          requirements: requirements.trim(),
          papers: papers.map(toPaperRequest),
          notebookId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readError(response));
      if (!response.body) throw new Error('服务未返回学术写作流。');

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
            retrieval?: RetrievalMetadata;
            draft?: AcademicWritingDraft;
            artifactMarkdown?: string;
            artifactFileName?: string;
            writingStatus?: WritingStatusPayload;
            error?: string;
          };
          if (payload.progress) {
            if (payload.progress.stage) setStage(payload.progress.stage);
            if (typeof payload.progress.progress === 'number') setProgress(payload.progress.progress);
            if (payload.progress.message) setMessage(payload.progress.message);
          }
          if (payload.citations) setCitations(payload.citations);
          if (payload.retrieval) setRetrieval(payload.retrieval);
          if (payload.draft) { finalDraft = payload.draft; setDraft(payload.draft); }
          if (payload.artifactMarkdown) setArtifactMarkdown(payload.artifactMarkdown);
          if (payload.artifactFileName) setArtifactFileName(payload.artifactFileName);
          if (payload.writingStatus) { finalStatus = payload.writingStatus; setWritingStatus(payload.writingStatus); }
          if (payload.error) throw new Error(payload.error);
        }
      }

      if (!finalDraft) throw new Error('没有生成通过结构与证据检查的学术草稿。');
      const complete = finalStatus?.answerStatus === 'complete';
      setStatus(complete ? 'complete' : 'incomplete');
      setStage('auditing');
      setProgress(complete ? 100 : 96);
      setMessage(complete ? '章节结构、段落证据与主张映射检查通过；仍需作者核验原文。' : '已保留草稿，但仍有证据编号需要核验。');
    } catch (caught) {
      const stopped = controller.signal.aborted;
      const userMessage = stopped
        ? '已停止生成；未通过完整结构检查的内容不会展示为可用草稿。'
        : caught instanceof Error ? caught.message : '学术写作暂时不可用，请稍后重试。';
      setError(userMessage);
      setStatus(finalDraft ? 'incomplete' : stopped ? 'idle' : 'error');
      setMessage(userMessage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [audience, formReady, getSelectedPapers, notebookId, requirements, status, targetSection, writingGoal]);

  return (
    <div className="space-y-4" data-testid="academic-writing-panel">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <BookOpenText className="h-4 w-4 text-indigo-500" />
          证据约束的学术写作
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          生成带段落角色和 Claim-Evidence 映射的可编辑章节草稿；不代表引用已核验、期刊格式已适配或投稿已完成。
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
        {selectedPapers.length === 0
          ? '尚未选择证据来源。请先在左侧文献本选择论文或资料。'
          : `已选择 ${selectedPapers.length} 个来源：${sourceSummary}${selectedPapers.length > 3 ? ' 等' : ''}`}
      </div>

      <div className="grid gap-3">
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">写作目标</span>
          <textarea value={writingGoal} onChange={event => setWritingGoal(event.target.value)} maxLength={1600} disabled={status === 'running'} data-testid="academic-writing-goal" placeholder="这一节要回答什么问题、建立什么论证？" className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] outline-none focus:border-indigo-400/60" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">目标章节</span>
            <select value={targetSection} onChange={event => setTargetSection(event.target.value as AcademicWritingSection)} disabled={status === 'running'} data-testid="academic-writing-section" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-indigo-400/60">
              {SECTION_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">目标读者</span>
            <input value={audience} onChange={event => setAudience(event.target.value)} maxLength={240} disabled={status === 'running'} data-testid="academic-writing-audience" placeholder="例如：领域期刊读者" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-indigo-400/60" />
          </label>
        </div>
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">结构与篇幅要求</span>
          <textarea value={requirements} onChange={event => setRequirements(event.target.value)} maxLength={1200} disabled={status === 'running'} data-testid="academic-writing-requirements" placeholder="例如：四段，先界定问题，再概括证据，最后指出缺口。" className="mt-1.5 min-h-16 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-indigo-400/60" />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="academic-writing-start" onClick={() => void runWriting()} disabled={!formReady || selectedPapers.length === 0 || status === 'running'} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">生成章节草稿</button>
        {artifactMarkdown && <button type="button" data-testid="academic-writing-download" onClick={() => downloadMarkdown(artifactMarkdown, artifactFileName)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]"><Download className="h-3.5 w-3.5" />下载 Markdown 草稿</button>}
      </div>

      {status === 'running' && <StudioJobProgress title="学术写作进行中" message={message} stages={STAGES} currentStageKey={stage} progressPercent={progress} hint="只基于已选来源片段；证据不足的主张会标记为待补证据。" onCancel={() => abortRef.current?.abort()} cancelLabel="停止生成" testId="academic-writing-progress" />}
      {error && status !== 'running' && <div className="flex gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 p-3 text-[11px] text-rose-700 dark:text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

      {draft && (
        <div className="space-y-4" data-testid="academic-writing-result">
          <div className="flex gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 text-[11px] text-emerald-700 dark:text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>
          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{draft.title}</h3>
            <div className="mt-3 space-y-3">
              {draft.paragraphs.map((paragraph, index) => <article key={`${paragraph.role}-${index}`} className="rounded-lg bg-[var(--glass-subtle)] p-3"><div className="mb-1 text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">{paragraph.role} · {paragraph.supportStatus}</div><p className="text-xs leading-6 text-[var(--text-primary)]">{paragraph.text}</p></article>)}
            </div>
          </section>
          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">Claim-Evidence 映射</h3>
            <div className="mt-2 space-y-2">{draft.claimEvidenceMap.map((item, index) => <div key={index} className="rounded-lg bg-[var(--glass-subtle)] p-2.5 text-[11px] leading-relaxed"><div className="font-medium text-[var(--text-primary)]">{item.claim}</div><div className="mt-1 text-[var(--text-secondary)]">{item.evidence}</div><div className="mt-1 text-[var(--text-tertiary)]">{item.evidenceMarkers.map(marker => `[${marker}]`).join('、') || '待补证据'} · {item.status}</div></div>)}</div>
          </section>
          <StudioEvidenceStatusPanel citations={citations} retrieval={retrieval} />
          {(writingStatus?.retrievalLimits || []).length > 0 && <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">{writingStatus?.retrievalLimits?.map(item => <div key={item}>• {item}</div>)}</div>}
        </div>
      )}
    </div>
  );
}
