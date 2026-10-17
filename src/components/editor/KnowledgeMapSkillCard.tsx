'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { PendingKnowledgeMap, ResearchKnowledgeMapReference } from '@/lib/research-agent-contract';
import { isGeneratedKnowledgeMap } from '@/lib/research-agent-map';
import type { KnowledgeMapSession } from '@/lib/knowledge-map-document';
import { KnowledgeMapGraph } from '@/components/studio/KnowledgeMapGraph';
import { StudioEvidenceStatusPanel } from '@/components/studio/StudioEvidenceStatusPanel';

export function RetryKnowledgeMapSave({ pending, messageId, callId }: { pending: PendingKnowledgeMap; messageId: string; callId: string }) {
  const { storageScopeKey, chatPersistence } = useApp();
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), [storageScopeKey]);
  const retry = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try {
      const response = await clientApiRequest('/api/studio/artifacts?kind=knowledge-map', { method: 'PUT', signal: controller.signal, redirectOnUnauthorized: false, headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() }, body: JSON.stringify({ notebookId: notebookIdFromStorageScopeKey(storageScopeKey), data: pending.data, expectedRevision: pending.expectedRevision }) });
      const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
      controller.signal.throwIfAborted();
      const saved = payload.document;
      if (!response.ok || !saved || !/^[a-f0-9]{64}$/.test(saved.revision) || !isGeneratedKnowledgeMap(saved.data, pending.runId, pending)) throw new Error(payload.error || '尚未确认保存，请重试。');
      const knowledgeMap: ResearchKnowledgeMapReference = { sourceIds: pending.sourceIds, question: pending.question, deepExtract: pending.deepExtract, runId: pending.runId, revision: saved.revision, status: saved.data.session!.citationAudit.status === 'pass' ? 'complete' : 'incomplete' };
      chatPersistence.update(previous => ({ ...previous, messages: previous.messages.map(message => message.id !== messageId ? message : { ...message, toolCalls: message.toolCalls?.map(call => call.id === callId ? { ...call, status: 'ready', error: undefined, pendingKnowledgeMap: undefined, knowledgeMap } : call) }) }));
      if (!await chatPersistence.flush()) throw new Error('图谱已保存，对话引用尚未保存。请使用对话上方的重试保存。');
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '保存失败，请重试。'); }
    finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };
  return <div><p>研究脉络已生成但尚未保存，重试只保存本轮结果。</p><button type="button" className="agent-plugin-open" disabled={busy} onClick={() => void retry()}>{busy ? '正在保存…' : '重试保存本轮研究脉络'}</button>{error && <p role="alert">{error}</p>}</div>;
}

export function KnowledgeMapSkillCard({ reference }: { reference: ResearchKnowledgeMapReference }) {
  const { storageScopeKey, openKnowledgeMap } = useApp();
  const key = `${storageScopeKey}:${reference.revision}`;
  const [loaded, setLoaded] = useState<{ key: string; session: KnowledgeMapSession } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openedKey, setOpenedKey] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const session = loaded?.key === key ? loaded.session : null;
  const failure = error?.key === key ? error.message : '';
  const node = session?.map.nodes.find(n => n.id === selectedId) || session?.map.nodes[0];
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ kind: 'knowledge-map', notebookId: notebookIdFromStorageScopeKey(storageScopeKey) || '', revision: reference.revision });
    void (async () => {
      try {
        const response = await clientApiRequest(`/api/studio/artifacts?${query}`, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
        if (controller.signal.aborted) return;
        const saved = payload.document;
        if (!response.ok || !saved || saved.revision !== reference.revision || !isGeneratedKnowledgeMap(saved.data, reference.runId, { question: reference.question, deepExtract: reference.deepExtract })) throw new Error(payload.error || '本轮研究脉络暂时无法读取，请重试。');
        setError(null); setLoaded({ key, session: saved.data.session! });
      } catch (caught) { if (!controller.signal.aborted) setError({ key, message: caught instanceof Error ? caught.message : '读取失败，请重试。' }); }
    })();
    return () => controller.abort();
  }, [attempt, key, reference.revision, reference.runId, reference.question, reference.deepExtract, storageScopeKey]);
  return <div data-testid="agent-map-artifact">
    {!session && !failure && <p role="status">正在读取本轮研究脉络…</p>}
    {failure && <><p role="alert">{failure}</p><button type="button" className="agent-plugin-open" onClick={() => setAttempt(n => n + 1)}>重新读取本轮研究脉络</button></>}
    {session && <>
      <p className="text-xs text-[var(--text-secondary)]">{reference.deepExtract ? '深度提取' : '快速抽取'} · {session.sourceCount} 份来源 · {session.map.nodes.length} 个节点 · {session.map.edges.length} 条关系</p>
      <button type="button" className="agent-plugin-open" aria-expanded={openedKey === key} onClick={() => setOpenedKey(openedKey === key ? '' : key)}>{openedKey === key ? '收起本轮研究脉络' : '查看本轮研究脉络'}</button>
      {openedKey === key && <div data-testid="agent-map-content" className="min-w-0 space-y-3 break-words text-sm">
        <p>{session.map.title}</p>
        <div className="h-[420px] min-w-0"><KnowledgeMapGraph key={key} map={session.map} selectedNodeId={node?.id || null} onSelectNode={setSelectedId} /></div>
        {node && <p><strong>{node.label}：</strong>{node.summary}</p>}
        <button type="button" className="agent-plugin-open" onClick={() => openKnowledgeMap({ title: session.map.title, source: 'generated', sourceCount: session.sourceCount, map: session.map, citations: session.citations, retrieval: session.retrieval, citationAudit: session.citationAudit })}>打开本轮图谱工作区</button>
        <p className="text-xs text-[var(--text-secondary)]">{session.citationAudit.status === 'pass' ? '引用编号通过；' : '引用仍需复核；'}资料明示、推断与待复核关系需分别核对，不能据此确认因果或科学结论。</p>
        <StudioEvidenceStatusPanel citations={session.citations} retrieval={session.retrieval} compact />
      </div>}
    </>}
  </div>;
}
