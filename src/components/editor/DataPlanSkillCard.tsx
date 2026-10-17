'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiPath, clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { isGeneratedDataPlan } from '@/lib/research-agent-data';
import type { DataProcessingDocument } from '@/lib/data-processing-document';
import type { PendingDataPlan, ResearchDataPlanReference } from '@/lib/research-agent-contract';

export function RetryDataPlanSave({ pending, messageId, callId }: { pending: PendingDataPlan; messageId: string; callId: string }) {
  const { storageScopeKey, chatPersistence } = useApp();
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), [storageScopeKey]);
  const retry = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try {
      const response = await clientApiRequest('/api/studio/artifacts?kind=data-processing', { method: 'PUT', signal: controller.signal, redirectOnUnauthorized: false, headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() }, body: JSON.stringify({ notebookId: notebookIdFromStorageScopeKey(storageScopeKey), data: pending.data, expectedRevision: pending.expectedRevision }) });
      const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
      controller.signal.throwIfAborted();
      const saved = payload.document;
      if (!response.ok || !saved || !/^[a-f0-9]{64}$/.test(saved.revision) || !isGeneratedDataPlan(saved.data, pending.runId, pending)) throw new Error(payload.error || '尚未确认保存，请重试。');
      const dataPlan: ResearchDataPlanReference = { sourceId: pending.sourceId, question: pending.question, sampleUnit: pending.sampleUnit, taskFamily: pending.taskFamily, targetColumn: pending.targetColumn, splitColumn: pending.splitColumn, sourceIds: pending.sourceIds, runId: pending.runId, revision: saved.revision, status: 'complete' };
      chatPersistence.update(previous => ({ ...previous, messages: previous.messages.map(message => message.id !== messageId ? message : { ...message, toolCalls: message.toolCalls?.map(call => call.id === callId ? { ...call, status: 'ready', error: undefined, pendingDataPlan: undefined, dataPlan } : call) }) }));
      if (!await chatPersistence.flush()) throw new Error('方案已保存，对话引用尚未保存。请使用对话上方的重试保存。');
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '保存失败，请重试。'); }
    finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };
  return <div><p>方案已生成但尚未保存，重试只保存本轮内容。</p><button type="button" className="agent-plugin-open" disabled={busy} onClick={() => void retry()}>{busy ? '正在保存…' : '重试保存本轮数据方案'}</button>{error && <p role="alert">{error}</p>}</div>;
}

export function DataPlanSkillCard({ reference }: { reference: ResearchDataPlanReference }) {
  const { storageScopeKey } = useApp();
  const key = `${storageScopeKey}:${reference.revision}`;
  const [loaded, setLoaded] = useState<{ key: string; document: DataProcessingDocument } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openedKey, setOpenedKey] = useState('');
  const plan = loaded?.key === key ? loaded.document.plan : null;
  const failure = error?.key === key ? error.message : '';
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ kind: 'data-processing', notebookId: notebookIdFromStorageScopeKey(storageScopeKey) || '', revision: reference.revision });
    void (async () => {
      try {
        const response = await clientApiRequest(`/api/studio/artifacts?${query}`, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
        if (controller.signal.aborted) return;
        const saved = payload.document;
        if (!response.ok || !saved || saved.revision !== reference.revision || !isGeneratedDataPlan(saved.data, reference.runId, reference)) throw new Error(payload.error || '本轮数据方案暂时无法读取，请重试。');
        setError(null); setLoaded({ key, document: saved.data });
      } catch (caught) { if (!controller.signal.aborted) setError({ key, message: caught instanceof Error ? caught.message : '读取失败，请重试。' }); }
    })();
    return () => controller.abort();
  }, [attempt, key, reference, storageScopeKey]);
  return <div data-testid="agent-data-artifact">
    {!plan && !failure && <p role="status">正在读取本轮数据方案…</p>}
    {failure && <><p role="alert">{failure}</p><button type="button" className="agent-plugin-open" onClick={() => setAttempt(n => n + 1)}>重新读取本轮数据方案</button></>}
    {plan && <>
      <p className="text-xs text-[var(--text-secondary)]">{plan.dataset.sourceTitle} · {plan.dataset.rowCount} 行 × {plan.dataset.columnCount} 列 · 统计采样 {plan.dataset.sampledRowCount} 行</p>
      <p className="text-xs text-[var(--text-secondary)]">已完成解析范围内诊断，未执行统计检验或模型训练。</p>
      <button type="button" className="agent-plugin-open" aria-expanded={openedKey === key} onClick={() => setOpenedKey(openedKey === key ? '' : key)}>{openedKey === key ? '收起本轮数据方案' : '查看本轮数据方案'}</button>
      {openedKey === key && <div data-testid="agent-data-content" className="min-w-0 space-y-3 break-words text-sm leading-relaxed">
        <a className="agent-plugin-open" href={clientApiPath('/api/studio/artifacts?' + new URLSearchParams({ kind: 'data-processing', notebookId: notebookIdFromStorageScopeKey(storageScopeKey) || '', revision: reference.revision, download: '1' }))} download={plan.artifactFileName}>下载本轮数据方案</a>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan.artifactMarkdown}</ReactMarkdown>
      </div>}
    </>}
  </div>;
}
