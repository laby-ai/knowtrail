'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, BookMarked, Download } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { PaperReadingMode, PaperReadingResult } from '@/lib/paper-reading-contract';
import type { Citation, Paper, RetrievalMetadata } from '@/types';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';

type PanelStatus = 'idle' | 'running' | 'complete' | 'incomplete' | 'error';

const MODES: Array<{ id: PaperReadingMode; label: string; desc: string }> = [
  { id: 'translation', label: '外文翻译', desc: '忠实翻译单篇来源并保留术语' },
  { id: 'paragraph-summary', label: '逐段总结', desc: '按章节或段落顺序提炼要点' },
  { id: 'full-summary', label: '全文结构化总结', desc: '背景、问题、方法、发现、贡献与局限' },
];

const STAGES: StudioJobProgressStage[] = [
  { key: 'retrieving', label: '匹配正文证据' },
  { key: 'evidence-ready', label: '确认来源边界' },
  { key: 'generating', label: '生成精读结果' },
  { key: 'auditing', label: '检查结构与引用' },
];

function toPaperRequest(paper: Paper) {
  const sectionText = paper.sections?.length
    ? paper.sections.map(section => `${'#'.repeat(Math.max(1, section.level))} ${section.title}\n${section.excerpt}`).join('\n\n')
    : '';
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    abstract: paper.abstract,
    content: [paper.content, sectionText].filter(Boolean).join('\n\n'),
    rawContent: paper.rawContent,
    shortName: paper.shortName,
    keywords: paper.keywords,
    fileName: paper.fileName,
    fileType: paper.fileType,
  };
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

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: string; msg?: string } | null;
  return payload?.error || payload?.msg || `请求失败（HTTP ${response.status}）`;
}

export function PaperReadingPanel() {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const selectedPapers = getSelectedPapers();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const abortRef = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<PaperReadingMode>('translation');
  const [sourceLanguage, setSourceLanguage] = useState('自动识别');
  const [targetLanguage, setTargetLanguage] = useState('简体中文');
  const [result, setResult] = useState<PaperReadingResult | null>(null);
  const [artifactMarkdown, setArtifactMarkdown] = useState('');
  const [artifactFileName, setArtifactFileName] = useState('paper-reading.md');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalMetadata | null>(null);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [stage, setStage] = useState('retrieving');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('选择来源与精读方式后开始。');
  const [error, setError] = useState<string | null>(null);

  const sourceSummary = useMemo(
    () => selectedPapers.slice(0, 3).map(paper => paper.shortName || paper.title).join('、'),
    [selectedPapers],
  );
  const sourceReady = selectedPapers.length > 0 && (mode !== 'translation' || selectedPapers.length === 1);

  const runPaperReading = useCallback(async () => {
    const papers = getSelectedPapers();
    if (!sourceReady || status === 'running') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setResult(null);
    setArtifactMarkdown('');
    setCitations([]);
    setRetrieval(null);
    setError(null);
    setStatus('running');
    setStage('retrieving');
    setProgress(12);
    setMessage('正在匹配已选来源的正文与章节证据。');

    let finalResult: PaperReadingResult | null = null;
    const readingStatus = { answerStatus: 'incomplete' as 'complete' | 'incomplete' | 'no-evidence' };
    try {
      const response = await clientApiRequest('/api/ai/paper-reading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          mode,
          sourceLanguage,
          targetLanguage,
          papers: papers.map(toPaperRequest),
          notebookId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (!response.body) throw new Error('服务未返回论文精读流。');

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
            result?: PaperReadingResult;
            artifactMarkdown?: string;
            artifactFileName?: string;
            readingStatus?: { answerStatus?: typeof readingStatus.answerStatus; retrievalLimits?: string[] };
            error?: string;
          };
          if (payload.progress) {
            if (payload.progress.stage) setStage(payload.progress.stage);
            if (typeof payload.progress.progress === 'number') setProgress(payload.progress.progress);
            if (payload.progress.message) setMessage(payload.progress.message);
          }
          if (payload.citations) setCitations(payload.citations);
          if (payload.retrieval) setRetrieval(payload.retrieval);
          if (payload.result) { finalResult = payload.result; setResult(payload.result); }
          if (payload.artifactMarkdown) setArtifactMarkdown(payload.artifactMarkdown);
          if (payload.artifactFileName) setArtifactFileName(payload.artifactFileName);
          if (payload.readingStatus?.answerStatus) readingStatus.answerStatus = payload.readingStatus.answerStatus;
          if (payload.error) throw new Error(payload.error);
        }
      }

      if (!finalResult) throw new Error('没有生成通过结构与证据检查的精读结果。');
      const complete = readingStatus.answerStatus === 'complete';
      setStatus(complete ? 'complete' : 'incomplete');
      setStage('auditing');
      setProgress(complete ? 100 : 96);
      setMessage(complete ? '结构与证据编号检查通过；翻译和事实仍需回到原文核验。' : '结果已保留，但仍有证据编号需要核验。');
    } catch (caught) {
      const stopped = controller.signal.aborted;
      const userMessage = stopped
        ? '已停止精读，未完成结果不会展示。'
        : caught instanceof Error ? caught.message : '论文精读暂时不可用，请稍后重试。';
      setError(userMessage);
      setStatus(finalResult ? 'incomplete' : stopped ? 'idle' : 'error');
      setMessage(userMessage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [getSelectedPapers, mode, notebookId, sourceLanguage, sourceReady, status, targetLanguage]);

  return (
    <div className="space-y-4" data-testid="paper-reading-panel">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <BookMarked className="h-4 w-4 text-blue-500" />
          论文精读
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          在同一工作区完成外文翻译、逐段总结和全文结构化总结，结果只使用已选正文证据。
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3" role="tablist" aria-label="精读方式">
        {MODES.map(option => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={mode === option.id}
            onClick={() => setMode(option.id)}
            disabled={status === 'running'}
            className={`rounded-lg border p-2.5 text-left ${mode === option.id ? 'border-blue-400/60 bg-blue-500/10' : 'border-[var(--border-subtle)] bg-[var(--glass-subtle)]'}`}
          >
            <span className="block text-xs font-semibold text-[var(--text-primary)]">{option.label}</span>
            <span className="mt-1 block text-[10px] leading-relaxed text-[var(--text-tertiary)]">{option.desc}</span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
        {selectedPapers.length === 0
          ? '尚未选择来源。请先在左侧文献本选择论文。'
          : mode === 'translation' && selectedPapers.length !== 1
            ? `外文翻译一次只处理一篇论文；当前选择了 ${selectedPapers.length} 篇。`
            : `已选择 ${selectedPapers.length} 个来源：${sourceSummary}${selectedPapers.length > 3 ? ' 等' : ''}`}
      </div>

      {mode === 'translation' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] font-medium text-[var(--text-secondary)]">来源语言
            <input value={sourceLanguage} onChange={event => setSourceLanguage(event.target.value)} disabled={status === 'running'} className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-[11px] font-medium text-[var(--text-secondary)]">目标语言
            <input value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)} disabled={status === 'running'} className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="paper-reading-start" onClick={() => void runPaperReading()} disabled={!sourceReady || status === 'running'} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">开始精读</button>
        {artifactMarkdown && <button type="button" onClick={() => downloadMarkdown(artifactMarkdown, artifactFileName)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]"><Download className="h-3.5 w-3.5" />下载 Markdown</button>}
      </div>

      {status === 'running' && <StudioJobProgress title="论文精读进行中" message={message} stages={STAGES} currentStageKey={stage} progressPercent={progress} hint="只使用已选来源正文；停止后不会把半成品显示为可用结果。" onCancel={() => abortRef.current?.abort()} cancelLabel="停止精读" testId="paper-reading-progress" />}
      {error && status !== 'running' && <div className="flex gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 p-3 text-[11px] text-rose-700 dark:text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

      {result && (
        <div className="space-y-3" data-testid="paper-reading-result">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{result.title}</h3>
          {result.sections.map((section, index) => (
            <article key={`${section.label}-${index}`} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <h4 className="text-xs font-semibold text-[var(--text-primary)]">{section.label}</h4>
              {section.sourceText && <p className="mt-2 border-l-2 border-blue-300/60 pl-2 text-[10px] leading-relaxed text-[var(--text-tertiary)]">{section.sourceText}</p>}
              <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[var(--text-secondary)]">{section.content}</p>
            </article>
          ))}
          {result.keyTerms.length > 0 && <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-3"><h4 className="text-xs font-semibold text-[var(--text-primary)]">术语对照</h4><div className="mt-2 flex flex-wrap gap-2">{result.keyTerms.map(term => <span key={`${term.source}-${term.target}`} className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{term.source}：{term.target}</span>)}</div></section>}
          <StudioEvidenceStatusPanel citations={citations} retrieval={retrieval} />
        </div>
      )}
    </div>
  );
}
