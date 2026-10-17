'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { PendingResearchDesign, ResearchDesignReference } from '@/lib/research-agent-contract';
import type { ResearchDesignDocument } from '@/lib/research-design-document';
import { isResearchDesignDocument } from '@/lib/research-agent-design';
import { StudioEvidenceStatusPanel } from '@/components/studio/StudioEvidenceStatusPanel';

export function RetryResearchDesignSave({ pending, messageId, callId }: { pending: PendingResearchDesign; messageId: string; callId: string }) {
  const { storageScopeKey, chatPersistence } = useApp();
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), [storageScopeKey]);
  const retry = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try {
      const response = await clientApiRequest(`/api/studio/artifacts?kind=${pending.kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() }, signal: controller.signal, redirectOnUnauthorized: false, body: JSON.stringify({ notebookId: notebookIdFromStorageScopeKey(storageScopeKey), data: pending.data, expectedRevision: pending.expectedRevision }) });
      const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
      controller.signal.throwIfAborted();
      const saved = payload.document;
      if (!response.ok || !saved || !/^[a-f0-9]{64}$/.test(saved.revision) || !isResearchDesignDocument(saved.data, pending.kind) || saved.data.result?.runId !== pending.runId) throw new Error(payload.error || '保存尚未完成，请重试。');
      const design: ResearchDesignReference = { kind: pending.kind, sourceIds: pending.sourceIds, question: pending.question, runId: pending.runId, revision: saved.revision, status: saved.data.result.status.answerStatus === 'complete' ? 'complete' : 'incomplete' };
      chatPersistence.update(previous => ({ ...previous, messages: previous.messages.map(message => message.id !== messageId ? message : { ...message, toolCalls: message.toolCalls?.map(call => call.id === callId ? { ...call, status: 'ready', error: undefined, pendingDesign: undefined, design } : call) }) }));
      if (!await chatPersistence.flush()) throw new Error('结果已保存，对话引用尚未保存。请使用对话上方的重试保存。');
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '保存失败，请重试。'); }
    finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };
  return <div><p>结果已生成但尚未保存，重试只保存本轮内容。</p><button type="button" className="agent-plugin-open" disabled={busy} onClick={() => void retry()}>{busy ? '正在保存…' : '重试保存本轮结果'}</button>{error && <p role="alert">{error}</p>}</div>;
}

export function ResearchDesignSkillCard({ reference }: { reference: ResearchDesignReference }) {
  const { storageScopeKey } = useApp();
  const key = `${storageScopeKey}:${reference.kind}:${reference.revision}`;
  const [loaded, setLoaded] = useState<{ key: string; document: ResearchDesignDocument } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openedKey, setOpenedKey] = useState('');
  const result = loaded?.key === key ? loaded.document.result : null;
  const failure = error?.key === key ? error.message : '';
  const open = openedKey === key;
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ kind: reference.kind, notebookId: notebookIdFromStorageScopeKey(storageScopeKey) || '', revision: reference.revision });
    void (async () => {
      try {
        const response = await clientApiRequest(`/api/studio/artifacts?${query}`, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
        if (controller.signal.aborted) return;
        const saved = payload.document;
        if (!response.ok || !saved || saved.revision !== reference.revision || !isResearchDesignDocument(saved.data, reference.kind) || saved.data.result?.runId !== reference.runId) throw new Error(payload.error || '本轮结果暂时无法读取，请重试。');
        setError(null); setLoaded({ key, document: saved.data });
      } catch (caught) { if (!controller.signal.aborted) setError({ key, message: caught instanceof Error ? caught.message : '本轮结果暂时无法读取，请重试。' }); }
    })();
    return () => controller.abort();
  }, [attempt, key, reference.kind, reference.revision, reference.runId, storageScopeKey]);
  return <div data-testid="agent-design-artifact">
    {!result && !failure && <p role="status">正在读取本轮结果…</p>}
    {failure && <><p role="alert">{failure}</p><button type="button" className="agent-plugin-open" onClick={() => setAttempt(n => n + 1)}>重新读取本轮结果</button></>}
    {result && <>
      <p className="text-xs text-[var(--text-secondary)]">{reference.sourceIds.length} 份来源 · {result.citations.length} 条引用</p>
      {result.status.answerStatus !== 'complete' && <p role="status">已保存未完成草稿，证据编号仍需核验。</p>}
      <button type="button" className="agent-plugin-open" aria-expanded={open} onClick={() => setOpenedKey(open ? '' : key)}>{open ? '收起本轮结果' : '查看本轮结果'}</button>
      {open && <div data-testid="agent-design-content" className="space-y-3 break-words text-sm leading-relaxed">
        {'hypotheses' in result ? result.hypotheses.map(h => <article key={h.id} className="space-y-2">
          <h3 className="font-semibold">{h.id} · {h.title}</h3>
          {([['假设', h.statement], ['依据', h.reasoningBasis], ['竞争解释', h.competingExplanation], ['可证伪预测', h.falsifiablePrediction], ['验证路径', h.validationPlan], ['不确定性', h.uncertainty]] as const).map(([label, text]) => <p key={label}><strong>{label}：</strong>{text}</p>)}
        </article>) : <><a className="agent-plugin-open" href={`data:text/markdown;charset=utf-8,${encodeURIComponent(result.artifactMarkdown)}`} download={result.artifactFileName}>下载本轮协议</a><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.artifactMarkdown}</ReactMarkdown></>}
        <p className="text-xs text-[var(--text-secondary)]">仅为假设或采集前计划，尚未执行实验或确认科学结论。</p>
        <StudioEvidenceStatusPanel citations={result.citations} retrieval={result.retrieval} compact />
      </div>}
    </>}
  </div>;
}
