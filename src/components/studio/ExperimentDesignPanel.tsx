'use client';

import { clientApiRequest } from '@/lib/client-api';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FlaskConical } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import type { ExperimentDesignProtocol } from '@/lib/experiment-design-contract';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { Citation, Paper, RetrievalMetadata } from '@/types';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';

type PanelStatus = 'idle' | 'running' | 'complete' | 'incomplete' | 'error';

type DesignStatusPayload = {
  answerStatus?: 'complete' | 'incomplete' | 'no-evidence';
  invalidEvidenceMarkers?: number[];
  retrievalLimits?: string[];
};

const DESIGN_STAGES: StudioJobProgressStage[] = [
  { key: 'retrieving', label: '核对证据与假设' },
  { key: 'evidence-ready', label: '识别单位与偏倚' },
  { key: 'designing', label: '组织实验协议' },
  { key: 'auditing', label: '检查预注册边界' },
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

export function ExperimentDesignPanel() {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const selectedPapers = getSelectedPapers();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const abortRef = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [experimentalUnit, setExperimentalUnit] = useState('');
  const [armsText, setArmsText] = useState('处理组, 对照组');
  const [primaryOutcome, setPrimaryOutcome] = useState('');
  const [constraints, setConstraints] = useState('');
  const [alpha, setAlpha] = useState(0.05);
  const [targetPower, setTargetPower] = useState(0.8);
  const [protocol, setProtocol] = useState<ExperimentDesignProtocol | null>(null);
  const [artifactMarkdown, setArtifactMarkdown] = useState('');
  const [artifactFileName, setArtifactFileName] = useState('experiment-preregistration.md');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalMetadata | null>(null);
  const [designStatus, setDesignStatus] = useState<DesignStatusPayload | null>(null);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [stage, setStage] = useState('retrieving');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('填写研究问题与采集前设计要素后开始。');
  const [error, setError] = useState<string | null>(null);

  const sourceSummary = useMemo(
    () => selectedPapers.slice(0, 3).map(paper => paper.shortName || paper.title).join('、'),
    [selectedPapers],
  );
  const arms = useMemo(
    () => armsText.split(/[,，\n]/).map(item => item.trim()).filter(Boolean).slice(0, 8),
    [armsText],
  );
  const missingEvidence = selectedPapers.length === 0;
  const formReady = question.trim() && hypothesis.trim() && experimentalUnit.trim()
    && arms.length >= 2 && primaryOutcome.trim() && alpha > 0 && alpha < 1 && targetPower > 0 && targetPower < 1;

  const runDesign = useCallback(async () => {
    const papers = getSelectedPapers();
    if (!formReady || papers.length === 0 || status === 'running') return;

    const controller = new AbortController();
    abortRef.current = controller;
    setProtocol(null);
    setArtifactMarkdown('');
    setCitations([]);
    setRetrieval(null);
    setDesignStatus(null);
    setError(null);
    setStatus('running');
    setStage('retrieving');
    setProgress(12);
    setMessage('正在核对选定来源、实验单位和主要结局。');

    let finalProtocol: ExperimentDesignProtocol | null = null;
    let finalStatus: DesignStatusPayload | null = null;
    try {
      const response = await clientApiRequest('/api/ai/experiment-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          question: question.trim(),
          hypothesis: hypothesis.trim(),
          experimentalUnit: experimentalUnit.trim(),
          arms,
          primaryOutcome: primaryOutcome.trim(),
          constraints: constraints.trim(),
          alpha,
          targetPower,
          papers: papers.map(toPaperRequest),
          notebookId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readError(response));
      if (!response.body) throw new Error('服务未返回实验设计流。');

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
            protocol?: ExperimentDesignProtocol;
            artifactMarkdown?: string;
            artifactFileName?: string;
            designStatus?: DesignStatusPayload;
            error?: string;
          };
          if (payload.progress) {
            if (payload.progress.stage) setStage(payload.progress.stage);
            if (typeof payload.progress.progress === 'number') setProgress(payload.progress.progress);
            if (payload.progress.message) setMessage(payload.progress.message);
          }
          if (payload.citations) setCitations(payload.citations);
          if (payload.retrieval) setRetrieval(payload.retrieval);
          if (payload.protocol) {
            finalProtocol = payload.protocol;
            setProtocol(payload.protocol);
          }
          if (payload.artifactMarkdown) {
            setArtifactMarkdown(payload.artifactMarkdown);
          }
          if (payload.artifactFileName) setArtifactFileName(payload.artifactFileName);
          if (payload.designStatus) {
            finalStatus = payload.designStatus;
            setDesignStatus(payload.designStatus);
          }
          if (payload.error) throw new Error(payload.error);
        }
      }

      if (!finalProtocol) throw new Error('没有生成通过结构检查的实验设计协议。');
      const completed = finalStatus?.answerStatus === 'complete';
      setStatus(completed ? 'complete' : 'incomplete');
      setStage('auditing');
      setProgress(completed ? 100 : 96);
      setMessage(completed ? '实验协议结构与证据编号检查通过。' : '已保留协议草稿，但仍有证据编号需要核验。');
    } catch (caught) {
      const stopped = controller.signal.aborted;
      const userMessage = stopped
        ? '已停止生成；未通过完整结构检查的内容不会展示为可用协议。'
        : caught instanceof Error ? caught.message : '实验设计暂时不可用，请稍后重试。';
      setError(userMessage);
      setStatus(finalProtocol ? 'incomplete' : stopped ? 'idle' : 'error');
      setMessage(userMessage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [alpha, arms, constraints, experimentalUnit, formReady, getSelectedPapers, hypothesis, notebookId, primaryOutcome, question, status, targetPower]);

  const stopDesign = useCallback(() => abortRef.current?.abort(), []);
  const invalidMarkers = designStatus?.invalidEvidenceMarkers || [];

  return (
    <div className="space-y-4" data-testid="experiment-design-panel">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <FlaskConical className="h-4 w-4 text-rose-500" />
          采集前实验设计与预注册
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          明确独立重复、处理与对照、随机化、主要结局和分析预案；不代表样本量已算定、伦理已审批或实验已执行。
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
        {missingEvidence
          ? '尚未选择证据来源。请先在左侧文献本选择论文或资料。'
          : `已选择 ${selectedPapers.length} 个来源：${sourceSummary}${selectedPapers.length > 3 ? ' 等' : ''}`}
      </div>

      <div className="grid gap-3">
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">研究问题</span>
          <textarea
            value={question}
            onChange={event => setQuestion(event.target.value)}
            maxLength={1200}
            disabled={status === 'running'}
            data-testid="experiment-design-question"
            placeholder="要比较什么处理，并回答什么研究问题？"
            className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] outline-none transition focus:border-rose-400/60"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">待验证假设</span>
          <textarea
            value={hypothesis}
            onChange={event => setHypothesis(event.target.value)}
            maxLength={1200}
            disabled={status === 'running'}
            data-testid="experiment-design-hypothesis"
            placeholder="写出可被未来数据推翻的方向性假设。"
            className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] outline-none transition focus:border-rose-400/60"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">独立实验单位</span>
            <input
              value={experimentalUnit}
              onChange={event => setExperimentalUnit(event.target.value)}
              maxLength={180}
              disabled={status === 'running'}
              data-testid="experiment-design-unit"
              placeholder="例如：独立患者、动物、机构或模型训练 run"
              className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-rose-400/60"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">处理与对照（逗号分隔）</span>
            <input
              value={armsText}
              onChange={event => setArmsText(event.target.value)}
              maxLength={360}
              disabled={status === 'running'}
              data-testid="experiment-design-arms"
              className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-rose-400/60"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">唯一主要结局</span>
          <input
            value={primaryOutcome}
            onChange={event => setPrimaryOutcome(event.target.value)}
            maxLength={360}
            disabled={status === 'running'}
            data-testid="experiment-design-outcome"
            placeholder="结局名称、测量方式与时间点"
            className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-rose-400/60"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">现实约束与已知干扰因素</span>
          <textarea
            value={constraints}
            onChange={event => setConstraints(event.target.value)}
            maxLength={1200}
            disabled={status === 'running'}
            data-testid="experiment-design-constraints"
            placeholder="例如：机构、日期、批次、操作者、板位、预算、伦理或招募限制。"
            className="mt-1.5 min-h-16 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)] outline-none focus:border-rose-400/60"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">Alpha</span>
            <input type="number" min="0.001" max="0.2" step="0.001" value={alpha} disabled={status === 'running'} onChange={event => setAlpha(Number(event.target.value))} data-testid="experiment-design-alpha" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-rose-400/60" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">目标 Power</span>
            <input type="number" min="0.5" max="0.99" step="0.01" value={targetPower} disabled={status === 'running'} onChange={event => setTargetPower(Number(event.target.value))} data-testid="experiment-design-power" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-rose-400/60" />
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void runDesign()}
        disabled={missingEvidence || !formReady || status === 'running'}
        data-testid="experiment-design-start"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <FlaskConical className="h-4 w-4" />
        生成实验设计协议
      </button>

      {status === 'running' && (
        <StudioJobProgress title="实验设计进行中" message={message} stages={DESIGN_STAGES} currentStageKey={stage} progressPercent={progress} hint="只使用当前选定来源。可随时停止，未完成结构不会显示为可用协议。" onCancel={stopDesign} cancelLabel="停止生成" testId="experiment-design-progress" />
      )}

      {error && status !== 'running' && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2" data-testid="experiment-design-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
          <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-200">{error}</p>
        </div>
      )}

      {protocol && (
        <div className="space-y-3" data-testid="experiment-design-result">
          <div className={status === 'complete' ? 'flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2' : 'flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2'}>
            {status === 'complete' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {status === 'complete' ? '协议结构与证据编号检查通过；仍需执行功效计算、伦理审查和现场可行性复核。' : '当前协议仍有证据编号或设计边界需要核验，不能直接执行。'}
            </p>
          </div>

          {invalidMarkers.length > 0 && (
            <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11px] text-[var(--text-secondary)]" data-testid="experiment-design-audit-warning">
              未找到对应来源的证据编号：{invalidMarkers.map(marker => `[${marker}]`).join('、')}。
            </div>
          )}

          <article className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold text-rose-600 dark:text-rose-300">{protocol.studyMode === 'confirmatory' ? '验证性研究' : '探索性研究'}</div>
                <h3 className="mt-0.5 text-sm font-semibold text-[var(--text-primary)]">{protocol.title}</h3>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{protocol.designType} · 独立单位：{protocol.experimentalUnit}</p>
              </div>
              {artifactMarkdown && (
                <button type="button" onClick={() => downloadMarkdown(artifactMarkdown, artifactFileName)} data-testid="experiment-design-download" className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--glass-hover)]">
                  <Download className="h-3.5 w-3.5" />
                  下载预注册协议
                </button>
              )}
            </div>

            <dl className="mt-3 grid gap-3 text-[11px] leading-relaxed">
              <div><dt className="font-semibold text-[var(--text-primary)]">设计与独立重复</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{protocol.designRationale} {protocol.replicationLevel}</dd></div>
              <div><dt className="font-semibold text-[var(--text-primary)]">处理与对照</dt><dd className="mt-1 grid gap-1 text-[var(--text-secondary)]">{protocol.arms.map(arm => <span key={`${arm.role}-${arm.name}`}>{arm.name}（{arm.role}）：{arm.intervention}</span>)}</dd></div>
              <div><dt className="font-semibold text-[var(--text-primary)]">主要结局</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{protocol.primaryOutcome.name}；{protocol.primaryOutcome.timing}；{protocol.primaryOutcome.measurement}</dd></div>
              <div><dt className="font-semibold text-[var(--text-primary)]">随机化、区组与盲法</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{protocol.randomization.method}；随机化单位：{protocol.randomization.unit}。{protocol.blockingAndBlinding.join('；')}</dd></div>
              <div><dt className="font-semibold text-[var(--text-primary)]">样本量与功效边界</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{protocol.sampleSizePlan.effectBasis} {protocol.sampleSizePlan.nextAction} 当前未执行样本量计算。</dd></div>
              <div><dt className="font-semibold text-[var(--text-primary)]">分析计划</dt><dd className="mt-1 grid gap-1 text-[var(--text-secondary)]">{protocol.analysisPlan.map(item => <span key={item}>- {item}</span>)}</dd></div>
              <div><dt className="font-semibold text-[var(--text-primary)]">停止、排除与伦理</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{protocol.stoppingRules.join('；')} {protocol.exclusionRules.join('；')} {protocol.ethicsAndFeasibility}</dd></div>
              <div><dt className="font-semibold text-[var(--text-primary)]">限制</dt><dd className="mt-1 grid gap-1 text-[var(--text-secondary)]">{protocol.limitations.map(item => <span key={item}>- {item}</span>)}</dd></div>
            </dl>
          </article>

          <StudioEvidenceStatusPanel citations={citations} retrieval={retrieval} />
        </div>
      )}
    </div>
  );
}
