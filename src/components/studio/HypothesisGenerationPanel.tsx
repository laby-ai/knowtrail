'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FlaskConical, Lightbulb } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import type { HypothesisCard } from '@/lib/hypothesis-generation-contract';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { Citation, Paper, RetrievalMetadata } from '@/types';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';

type PanelStatus = 'idle' | 'running' | 'complete' | 'incomplete' | 'error';

type HypothesisStatusPayload = {
  answerStatus?: 'complete' | 'incomplete' | 'no-evidence';
  invalidEvidenceMarkers?: number[];
  retrievalLimits?: string[];
};

const HYPOTHESIS_STAGES: StudioJobProgressStage[] = [
  { key: 'retrieving', label: '核对选定来源' },
  { key: 'evidence-ready', label: '区分支持与反证' },
  { key: 'generating', label: '生成可证伪假设' },
  { key: 'auditing', label: '检查证据与边界' },
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

export function HypothesisGenerationPanel() {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const selectedPapers = getSelectedPapers();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const abortRef = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState('');
  const [hypotheses, setHypotheses] = useState<HypothesisCard[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalMetadata | null>(null);
  const [hypothesisStatus, setHypothesisStatus] = useState<HypothesisStatusPayload | null>(null);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [stage, setStage] = useState('retrieving');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('填写研究问题后开始。');
  const [error, setError] = useState<string | null>(null);

  const sourceSummary = useMemo(
    () => selectedPapers.slice(0, 3).map(paper => paper.shortName || paper.title).join('、'),
    [selectedPapers],
  );

  const runGeneration = useCallback(async () => {
    const trimmedQuestion = question.trim();
    const papers = getSelectedPapers();
    if (!trimmedQuestion || papers.length === 0 || status === 'running') return;

    const controller = new AbortController();
    abortRef.current = controller;
    setHypotheses([]);
    setCitations([]);
    setRetrieval(null);
    setHypothesisStatus(null);
    setError(null);
    setStatus('running');
    setStage('retrieving');
    setProgress(12);
    setMessage('正在核对选定来源和可检索片段。');

    let finalHypotheses: HypothesisCard[] = [];
    let finalStatus: HypothesisStatusPayload | null = null;
    try {
      const response = await fetch('/api/ai/hypothesis-generation', {
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
        throw new Error(payload.error || `假设生成请求失败（HTTP ${response.status}）。`);
      }
      if (!response.body) throw new Error('假设生成服务没有返回进度流。');

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
            hypotheses?: HypothesisCard[];
            citations?: Citation[];
            retrieval?: RetrievalMetadata;
            hypothesisStatus?: HypothesisStatusPayload;
            progress?: { stage?: string; progress?: number; message?: string };
            error?: string;
          };
          if (payload.progress) {
            setStage(payload.progress.stage || 'generating');
            setProgress(payload.progress.progress || 0);
            setMessage(payload.progress.message || '正在生成研究假设。');
          }
          if (payload.citations) setCitations(payload.citations);
          if (payload.retrieval) setRetrieval(payload.retrieval);
          if (payload.hypotheses) {
            finalHypotheses = payload.hypotheses;
            setHypotheses(payload.hypotheses);
          }
          if (payload.hypothesisStatus) {
            finalStatus = payload.hypothesisStatus;
            setHypothesisStatus(payload.hypothesisStatus);
          }
          if (payload.error) throw new Error(payload.error);
        }
      }

      if (finalHypotheses.length === 0) throw new Error('没有生成通过结构检查的研究假设。');
      const completed = finalStatus?.answerStatus === 'complete';
      setStatus(completed ? 'complete' : 'incomplete');
      setStage('auditing');
      setProgress(completed ? 100 : 96);
      setMessage(completed ? '假设结构与证据编号检查通过。' : '已保留假设草稿，但仍有证据编号需要核验。');
    } catch (caught) {
      const stopped = controller.signal.aborted;
      const userMessage = stopped
        ? '已停止生成；未通过完整结构检查的内容不会展示为可用假设。'
        : caught instanceof Error ? caught.message : '假设生成暂时不可用，请稍后重试。';
      setError(userMessage);
      setStatus(finalHypotheses.length > 0 ? 'incomplete' : stopped ? 'idle' : 'error');
      setMessage(userMessage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [getSelectedPapers, notebookId, question, status]);

  const stopGeneration = useCallback(() => abortRef.current?.abort(), []);
  const missingEvidence = selectedPapers.length === 0;
  const invalidMarkers = hypothesisStatus?.invalidEvidenceMarkers || [];

  return (
    <div className="space-y-4" data-testid="hypothesis-generation-panel">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          基于证据生成可验证假设
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          输出包含依据、竞争解释、可证伪预测和验证路径，不代表已证明新颖性、因果关系或统计显著性。
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
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
          data-testid="hypothesis-generation-question"
          placeholder="例如：哪些可检验机制可能解释不同研究中观察到的结果差异？"
          className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] outline-none transition focus:border-amber-400/60"
        />
      </label>

      <button
        type="button"
        onClick={() => void runGeneration()}
        disabled={missingEvidence || !question.trim() || status === 'running'}
        data-testid="hypothesis-generation-start"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <FlaskConical className="h-4 w-4" />
        生成研究假设
      </button>

      {status === 'running' && (
        <StudioJobProgress
          title="假设生成进行中"
          message={message}
          stages={HYPOTHESIS_STAGES}
          currentStageKey={stage}
          progressPercent={progress}
          hint="只使用当前选定来源。可随时停止，未完成结构不会显示为可用假设。"
          onCancel={stopGeneration}
          cancelLabel="停止生成"
          testId="hypothesis-generation-progress"
        />
      )}

      {error && status !== 'running' && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2" data-testid="hypothesis-generation-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
          <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-200">{error}</p>
        </div>
      )}

      {hypotheses.length > 0 && (
        <div className="space-y-3" data-testid="hypothesis-generation-result">
          <div className={status === 'complete'
            ? 'flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2'
            : 'flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2'}
          >
            {status === 'complete'
              ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />}
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {status === 'complete'
                ? '假设结构与证据编号检查通过；仍需后续实验、数据和新颖性审查。'
                : '当前假设仍有证据编号或结构边界需要核验，不能视为已验证结论。'}
            </p>
          </div>

          {invalidMarkers.length > 0 && (
            <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11px] text-[var(--text-secondary)]" data-testid="hypothesis-generation-audit-warning">
              未找到对应来源的证据编号：{invalidMarkers.map(marker => `[${marker}]`).join('、')}。
            </div>
          )}

          {hypotheses.map(hypothesis => (
            <article key={hypothesis.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3" data-testid="hypothesis-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-amber-600 dark:text-amber-300">{hypothesis.id}</div>
                  <h3 className="mt-0.5 text-sm font-semibold text-[var(--text-primary)]">{hypothesis.title}</h3>
                </div>
                <div className="flex shrink-0 gap-1">
                  {hypothesis.evidenceMarkers.map(marker => (
                    <span key={marker} className="rounded border border-blue-400/25 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-700 dark:text-blue-200">
                      [{marker}]
                    </span>
                  ))}
                </div>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{hypothesis.statement}</p>
              <dl className="mt-3 grid gap-2 text-[11px] leading-relaxed">
                <div><dt className="font-semibold text-[var(--text-primary)]">证据依据</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{hypothesis.reasoningBasis}</dd></div>
                <div><dt className="font-semibold text-[var(--text-primary)]">竞争解释</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{hypothesis.competingExplanation}</dd></div>
                <div><dt className="font-semibold text-[var(--text-primary)]">可证伪预测</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{hypothesis.falsifiablePrediction}</dd></div>
                <div><dt className="font-semibold text-[var(--text-primary)]">验证路径</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{hypothesis.validationPlan}</dd></div>
                <div><dt className="font-semibold text-[var(--text-primary)]">不确定性</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{hypothesis.uncertainty}</dd></div>
              </dl>
            </article>
          ))}

          <StudioEvidenceStatusPanel citations={citations} retrieval={retrieval} />
        </div>
      )}
    </div>
  );
}
