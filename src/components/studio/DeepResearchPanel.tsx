'use client';

import { clientApiRequest } from '@/lib/client-api';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSearch, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { Citation, CitationAuditResult, Paper, RetrievalMetadata } from '@/types';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';

type ResearchAnswerStatus = 'idle' | 'running' | 'complete' | 'incomplete' | 'error';

type ResearchStatusPayload = {
  answerStatus?: 'complete' | 'incomplete' | 'no-evidence';
  sectionCoverage?: {
    status?: string;
    missingSections?: string[];
    emptySections?: string[];
    uncitedClaims?: Array<{ section?: string; text?: string }>;
  };
  retrievalLimits?: string[];
  removedUncitedClaims?: number;
  repairAttempted?: boolean;
};

const RESEARCH_STAGES: StudioJobProgressStage[] = [
  { key: 'retrieving', label: '核对选定来源' },
  { key: 'evidence-ready', label: '匹配证据片段' },
  { key: 'writing', label: '组织研究报告' },
  { key: 'auditing', label: '检查章节与引用' },
  { key: 'repairing', label: '收口引用覆盖' },
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

export function DeepResearchPanel() {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const selectedPapers = getSelectedPapers();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const abortRef = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalMetadata | null>(null);
  const [citationAudit, setCitationAudit] = useState<CitationAuditResult | null>(null);
  const [researchStatus, setResearchStatus] = useState<ResearchStatusPayload | null>(null);
  const [status, setStatus] = useState<ResearchAnswerStatus>('idle');
  const [stage, setStage] = useState('retrieving');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('填写研究问题后开始。');
  const [error, setError] = useState<string | null>(null);

  const sourceSummary = useMemo(
    () => selectedPapers.slice(0, 3).map(paper => paper.shortName || paper.title).join('、'),
    [selectedPapers],
  );

  const runResearch = useCallback(async () => {
    const trimmedQuestion = question.trim();
    const papers = getSelectedPapers();
    if (!trimmedQuestion || papers.length === 0 || status === 'running') return;

    const controller = new AbortController();
    abortRef.current = controller;
    setAnswer('');
    setCitations([]);
    setRetrieval(null);
    setCitationAudit(null);
    setResearchStatus(null);
    setError(null);
    setStatus('running');
    setStage('retrieving');
    setProgress(12);
    setMessage('正在核对选定来源和可检索片段。');

    let streamedAnswer = '';
    let finalResearchStatus: ResearchStatusPayload | null = null;
    try {
      const response = await clientApiRequest('/api/ai/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          question: trimmedQuestion,
          notebookId,
          papers: papers.map(toPaperRequest),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `深度研究请求失败（HTTP ${response.status}）。`);
      }
      if (!response.body) throw new Error('深度研究服务没有返回流式内容。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const event of events) {
          const dataLines = event
            .split(/\r?\n/)
            .filter(item => item.startsWith('data: '))
            .map(item => item.slice(6));
          if (dataLines.length === 0) continue;
          const raw = dataLines.join('\n');
          if (raw === '[DONE]') continue;
          const payload = JSON.parse(raw) as {
            content?: string;
            replaceContent?: string;
            citations?: Citation[];
            retrieval?: RetrievalMetadata;
            citationAudit?: CitationAuditResult;
            researchStatus?: ResearchStatusPayload;
            progress?: { stage?: string; progress?: number; message?: string };
            error?: string;
          };
          if (payload.progress) {
            setStage(payload.progress.stage || 'writing');
            setProgress(payload.progress.progress || 0);
            setMessage(payload.progress.message || '正在进行深度研究。');
          }
          if (payload.citations) setCitations(payload.citations);
          if (payload.retrieval) setRetrieval(payload.retrieval);
          if (payload.content) {
            streamedAnswer += payload.content;
            setAnswer(streamedAnswer);
          }
          if (payload.replaceContent) {
            streamedAnswer = payload.replaceContent;
            setAnswer(streamedAnswer);
          }
          if (payload.citationAudit) setCitationAudit(payload.citationAudit);
          if (payload.researchStatus) {
            finalResearchStatus = payload.researchStatus;
            setResearchStatus(payload.researchStatus);
          }
          if (payload.error) throw new Error(payload.error);
        }
      }

      if (!streamedAnswer) throw new Error('没有生成可展示的研究正文。');
      const completed = finalResearchStatus?.answerStatus === 'complete';
      setStatus(completed ? 'complete' : 'incomplete');
      setStage('auditing');
      setProgress(completed ? 100 : 96);
      setMessage(completed ? '报告章节与引用覆盖检查通过。' : '已保留研究草稿，但仍有章节或引用需要补充。');
    } catch (caught) {
      const stopped = controller.signal.aborted;
      const userMessage = stopped
        ? '已停止生成；已返回的正文和证据仍保留为未完成草稿。'
        : caught instanceof Error ? caught.message : '深度研究暂时不可用，请稍后重试。';
      setError(userMessage);
      setStatus(streamedAnswer ? 'incomplete' : stopped ? 'idle' : 'error');
      setMessage(userMessage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [getSelectedPapers, notebookId, question, status]);

  const stopResearch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const missingEvidence = selectedPapers.length === 0;
  const incompleteReason = researchStatus?.sectionCoverage;

  return (
    <div className="space-y-4" data-testid="deep-research-panel">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <FileSearch className="h-4 w-4 text-blue-500" />
          基于已选来源开展深度研究
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          系统会检索当前文献本中的证据片段并生成可追溯报告，不代表已完成全网检索或全文核验。
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
        {missingEvidence
          ? '尚未选择证据来源。请先在左侧文献本选择论文或资料。'
          : `已选择 ${selectedPapers.length} 个来源：${sourceSummary}${selectedPapers.length > 3 ? ' 等' : ''}`}
      </div>

      <label className="block">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">研究问题</span>
        <textarea
          value={question}
          onChange={event => setQuestion(event.target.value)}
          maxLength={1200}
          disabled={status === 'running'}
          data-testid="deep-research-question"
          placeholder="例如：这些研究对证据合成偏差的主要解释、分歧和待验证问题是什么？"
          className="mt-1.5 min-h-24 w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] outline-none transition focus:border-blue-400/60"
        />
      </label>

      <button
        type="button"
        onClick={() => void runResearch()}
        disabled={missingEvidence || !question.trim() || status === 'running'}
        data-testid="deep-research-start"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Search className="h-4 w-4" />
        开始深度研究
      </button>

      {status === 'running' && (
        <StudioJobProgress
          title="深度研究进行中"
          message={message}
          stages={RESEARCH_STAGES}
          currentStageKey={stage}
          progressPercent={progress}
          hint="报告仅使用当前选定来源。可随时停止，已返回的内容会保留为未完成草稿。"
          onCancel={stopResearch}
          cancelLabel="停止研究"
          testId="deep-research-progress"
        />
      )}

      {error && status !== 'running' && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2" data-testid="deep-research-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
          <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-200">{error}</p>
        </div>
      )}

      {answer && (
        <div className="space-y-3" data-testid="deep-research-result">
          <div className={status === 'complete'
            ? 'flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2'
            : 'flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2'}
          >
            {status === 'complete'
              ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />}
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {status === 'complete'
                ? `报告结构与引用编号检查通过；关键结论仍建议定位来源核验原文。${researchStatus?.removedUncitedClaims ? ` 已移除 ${researchStatus.removedUncitedClaims} 条无引用陈述。` : ''}`
                : '当前为未完成研究草稿，不能直接作为已核验报告。请补齐缺失章节或引用后再使用。'}
            </p>
          </div>

          {(citationAudit?.status !== 'pass' || incompleteReason?.status !== 'pass') && status !== 'complete' && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]" data-testid="deep-research-audit-warning">
              {citationAudit?.warning || '引用或章节覆盖尚未通过。'}
              {incompleteReason?.missingSections?.length
                ? ` 缺少章节：${incompleteReason.missingSections.join('、')}。`
                : ''}
              {incompleteReason?.uncitedClaims?.length
                ? ` 尚有 ${incompleteReason.uncitedClaims.length} 条陈述缺少引用。`
                : ''}
            </div>
          )}

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-semibold text-[var(--text-primary)] first:mt-0">{children}</h2>,
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
              }}
            >
              {answer}
            </ReactMarkdown>
          </div>

          <StudioEvidenceStatusPanel citations={citations} retrieval={retrieval} />
        </div>
      )}
    </div>
  );
}
