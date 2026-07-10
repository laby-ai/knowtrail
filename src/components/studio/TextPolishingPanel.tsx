'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, RotateCcw, WandSparkles } from 'lucide-react';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { PolishingScene, TextPolishingAudit, TextPolishingResult, TextProtectionSnapshot } from '@/lib/text-polishing-contract';
import { useApp } from '@/contexts/AppContext';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';

type PanelStatus = 'idle' | 'running' | 'complete' | 'error';
const STAGES: StudioJobProgressStage[] = [
  { key: 'protecting', label: '锁定事实与术语' },
  { key: 'revising', label: '最小修改文本' },
  { key: 'auditing', label: '检查结论强度' },
];

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

export function TextPolishingPanel() {
  const { storageScopeKey } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const abortRef = useRef<AbortController | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [goal, setGoal] = useState('减少模板腔，保持专业、克制和自然。');
  const [scene, setScene] = useState<PolishingScene>('paper');
  const [protectedTermsText, setProtectedTermsText] = useState('');
  const [result, setResult] = useState<TextPolishingResult | null>(null);
  const [audit, setAudit] = useState<TextPolishingAudit | null>(null);
  const [protection, setProtection] = useState<TextProtectionSnapshot | null>(null);
  const [artifactMarkdown, setArtifactMarkdown] = useState('');
  const [artifactFileName, setArtifactFileName] = useState('scientific-text-revision.md');
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [stage, setStage] = useState('protecting');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('粘贴待润色文本，确认保护术语后开始。');
  const [error, setError] = useState<string | null>(null);

  const runPolishing = useCallback(async () => {
    if (sourceText.trim().length < 20 || status === 'running') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setResult(null);
    setAudit(null);
    setProtection(null);
    setArtifactMarkdown('');
    setError(null);
    setStatus('running');
    setStage('protecting');
    setProgress(12);
    setMessage('正在锁定数字、术语、引用和图表编号。');
    let finalResult: TextPolishingResult | null = null;
    try {
      const response = await fetch('/api/ai/text-polishing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          sourceText: sourceText.trim(),
          goal: goal.trim(),
          scene,
          protectedTerms: protectedTermsText.split(/[,，\n]/).map(item => item.trim()).filter(Boolean),
          notebookId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readError(response));
      if (!response.body) throw new Error('服务未返回文本润色流。');
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
            protection?: TextProtectionSnapshot;
            result?: TextPolishingResult;
            audit?: TextPolishingAudit;
            artifactMarkdown?: string;
            artifactFileName?: string;
            error?: string;
          };
          if (payload.progress) {
            if (payload.progress.stage) setStage(payload.progress.stage);
            if (typeof payload.progress.progress === 'number') setProgress(payload.progress.progress);
            if (payload.progress.message) setMessage(payload.progress.message);
          }
          if (payload.protection) setProtection(payload.protection);
          if (payload.result) { finalResult = payload.result; setResult(payload.result); }
          if (payload.audit) setAudit(payload.audit);
          if (payload.artifactMarkdown) setArtifactMarkdown(payload.artifactMarkdown);
          if (payload.artifactFileName) setArtifactFileName(payload.artifactFileName);
          if (payload.error) throw new Error(payload.error);
        }
      }
      if (!finalResult) throw new Error('没有生成通过事实保护检查的修订文本。');
      setStatus('complete');
      setStage('auditing');
      setProgress(100);
      setMessage('保护项和结论强度检查通过；仍需作者回读事实与语境。');
    } catch (caught) {
      const stopped = controller.signal.aborted;
      const userMessage = stopped
        ? '已停止润色；未通过保护检查的内容不会展示。'
        : caught instanceof Error ? caught.message : '文本润色暂时不可用。';
      setResult(null);
      setAudit(null);
      setArtifactMarkdown('');
      setError(userMessage);
      setStatus(stopped ? 'idle' : 'error');
      setMessage(userMessage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [goal, notebookId, protectedTermsText, scene, sourceText, status]);

  const restoreOriginal = () => {
    setResult(null);
    setAudit(null);
    setArtifactMarkdown('');
    setMessage('已恢复原文显示；原输入未被覆盖。');
    setStatus('idle');
  };

  return (
    <div className="space-y-4" data-testid="text-polishing-panel">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><WandSparkles className="h-4 w-4 text-fuchsia-500" />科研文本润色</div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">默认少动，保护事实、术语、数字、引用和结论强度；原文始终保留，不补造证据。</p>
      </div>

      <label className="block">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">原文</span>
        <textarea value={sourceText} onChange={event => setSourceText(event.target.value)} maxLength={16000} disabled={status === 'running'} data-testid="text-polishing-source" placeholder="粘贴论文、项目书或讲稿文本（至少 20 个字符）。" className="mt-1.5 min-h-40 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm leading-6 text-[var(--text-primary)] outline-none focus:border-fuchsia-400/60" />
        <span className="mt-1 block text-right text-[10px] text-[var(--text-quaternary)]">{sourceText.length}/16000</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">文本场景</span>
          <select value={scene} onChange={event => setScene(event.target.value as PolishingScene)} disabled={status === 'running'} data-testid="text-polishing-scene" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]"><option value="paper">论文正文</option><option value="proposal">基金 / 项目书</option><option value="presentation">答辩 / 讲稿</option></select>
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">额外保护术语</span>
          <input value={protectedTermsText} onChange={event => setProtectedTermsText(event.target.value)} disabled={status === 'running'} data-testid="text-polishing-protected-terms" placeholder="逗号分隔，例如：Model-X, 数据集 A" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
      </div>
      <label className="block">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">润色目标</span>
        <input value={goal} onChange={event => setGoal(event.target.value)} maxLength={500} disabled={status === 'running'} data-testid="text-polishing-goal" className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
      </label>

      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="text-polishing-start" onClick={() => void runPolishing()} disabled={sourceText.trim().length < 20 || status === 'running'} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">开始润色</button>
        {result && <button type="button" data-testid="text-polishing-restore" onClick={restoreOriginal} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]"><RotateCcw className="h-3.5 w-3.5" />恢复原文</button>}
        {artifactMarkdown && <button type="button" data-testid="text-polishing-download" onClick={() => downloadMarkdown(artifactMarkdown, artifactFileName)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]"><Download className="h-3.5 w-3.5" />下载修订记录</button>}
      </div>

      {status === 'running' && <StudioJobProgress title="文本润色进行中" message={message} stages={STAGES} currentStageKey={stage} progressPercent={progress} hint="保护项丢失或结论强度被增强时，结果会被拒绝。" onCancel={() => abortRef.current?.abort()} cancelLabel="停止润色" testId="text-polishing-progress" />}
      {error && <div className="flex gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 p-3 text-[11px] text-rose-700 dark:text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

      {result && audit && (
        <div className="space-y-4" data-testid="text-polishing-result">
          <div className="flex gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 text-[11px] text-emerald-700 dark:text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3"><h3 className="text-xs font-semibold text-[var(--text-primary)]">原文</h3><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[var(--text-secondary)]">{sourceText}</p></section>
            <section className="rounded-lg border border-fuchsia-400/25 bg-fuchsia-500/5 p-3"><h3 className="text-xs font-semibold text-[var(--text-primary)]">修订文</h3><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[var(--text-primary)]">{result.revisedText}</p></section>
          </div>
          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3"><h3 className="text-xs font-semibold text-[var(--text-primary)]">逐项修改说明</h3><div className="mt-2 space-y-2">{result.changes.length ? result.changes.map((change, index) => <div key={index} className="rounded-lg bg-[var(--glass-subtle)] p-2.5 text-[11px] leading-relaxed"><div className="font-medium text-[var(--text-primary)]">{change.original} → {change.revised}</div><div className="mt-1 text-[var(--text-secondary)]">{change.reason}</div><div className="mt-1 text-[var(--text-tertiary)]">{change.category}</div></div>) : <div className="text-[11px] text-[var(--text-tertiary)]">未做实质修改。</div>}</div></section>
          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3"><h3 className="text-xs font-semibold text-[var(--text-primary)]">保护项检查</h3><div className="mt-2 flex flex-wrap gap-1.5">{(protection?.items || []).map(item => <span key={item} className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-700 dark:text-emerald-200">{item}</span>)}</div><p className="mt-2 text-[10px] text-[var(--text-tertiary)]">丢失保护项：{audit.missingProtectedItems.join('、') || '无'} · 新增强主张：{audit.strengthenedClaims.join('、') || '无'}</p></section>
        </div>
      )}
    </div>
  );
}
