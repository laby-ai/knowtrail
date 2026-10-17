'use client';

import { useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiDownloadBlob, clientApiPath, clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { isGeneratedIllustration } from '@/lib/research-agent-illustration';
import type { IllustrationResult } from '@/lib/scientific-illustration-document';
import type { PendingIllustration, ResearchIllustrationReference } from '@/lib/research-agent-contract';

export function RetryIllustrationSave({ pending, messageId, callId }: { pending: PendingIllustration; messageId: string; callId: string }) {
  const { storageScopeKey, chatPersistence } = useApp();
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), [storageScopeKey]);
  const retry = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try {
      const response = await clientApiRequest('/api/studio/artifacts?kind=scientific-illustration', { method: 'PUT', signal: controller.signal, redirectOnUnauthorized: false, headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() }, body: JSON.stringify({ notebookId: notebookIdFromStorageScopeKey(storageScopeKey), data: pending.data, expectedRevision: pending.expectedRevision }) });
      const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
      controller.signal.throwIfAborted();
      const saved = payload.document;
      if (!response.ok || !saved || !/^[a-f0-9]{64}$/.test(saved.revision) || !isGeneratedIllustration(saved.data, pending.runId, pending) || saved.data.result.id !== pending.imageId) throw new Error(payload.error || '本轮示意图尚未确认保存，请重试。');
      const illustration: ResearchIllustrationReference = { purpose: pending.purpose, figureKind: pending.figureKind, aspectRatio: pending.aspectRatio, requiredLabels: pending.requiredLabels, sourceIds: pending.sourceIds, runId: pending.runId, revision: saved.revision, imageId: pending.imageId, status: 'incomplete' };
      chatPersistence.update(previous => ({ ...previous, messages: previous.messages.map(message => message.id !== messageId ? message : { ...message, toolCalls: message.toolCalls?.map(call => call.id === callId ? { ...call, status: 'ready', error: undefined, pendingIllustration: undefined, illustration } : call) }) }));
      if (!await chatPersistence.flush()) throw new Error('图片已保存，对话引用尚未保存。请使用对话上方的重试保存。');
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '保存失败，请重试。'); }
    finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };
  return <div><p>图片已生成但尚未保存，重试只保存原图，不重新作图。</p><button type="button" className="agent-plugin-open" disabled={busy} onClick={() => void retry()}>{busy ? '正在保存…' : '重试保存本轮示意图'}</button>{error && <p role="alert">{error}</p>}</div>;
}

export function IllustrationSkillCard({ reference }: { reference: ResearchIllustrationReference }) {
  const { storageScopeKey } = useApp();
  const key = `${storageScopeKey}:${reference.revision}`;
  const [loaded, setLoaded] = useState<{ key: string; result: IllustrationResult; url: string } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openedKey, setOpenedKey] = useState('');
  const image = loaded?.key === key ? loaded : null;
  const error = failure?.key === key ? failure.message : '';
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = '';
    const query = new URLSearchParams({ kind: 'scientific-illustration', notebookId: notebookIdFromStorageScopeKey(storageScopeKey) || '', revision: reference.revision });
    void (async () => {
      try {
        const response = await clientApiRequest(`/api/studio/artifacts?${query}`, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
        controller.signal.throwIfAborted();
        const saved = payload.document;
        if (!response.ok || !saved || saved.revision !== reference.revision || !isGeneratedIllustration(saved.data, reference.runId, reference) || saved.data.result.id !== reference.imageId) throw new Error(payload.error || '本轮示意图暂时无法读取，请重试。');
        const blob = await clientApiDownloadBlob(saved.data.result.imageUrl, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        controller.signal.throwIfAborted();
        if (!/^image\/(?:png|jpeg|webp)$/i.test(blob.type) || blob.size !== saved.data.result.bytes) throw new Error('图片文件类型或大小不符，请重试读取。');
        objectUrl = URL.createObjectURL(blob);
        setFailure(null); setLoaded({ key, result: saved.data.result, url: objectUrl });
      } catch (caught) { if (!controller.signal.aborted) setFailure({ key, message: caught instanceof Error ? caught.message : '图片读取失败，请重试。' }); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attempt, key, reference, storageScopeKey]);
  const extension = image?.result.mimeType === 'image/jpeg' ? 'jpg' : image?.result.mimeType === 'image/webp' ? 'webp' : 'png';
  return <div data-testid="agent-illustration-artifact">
    {!image && !error && <p role="status">正在读取本轮示意图…</p>}
    {error && <><p role="alert">{error}</p><button type="button" className="agent-plugin-open" onClick={() => setAttempt(n => n + 1)}>重新读取本轮示意图</button></>}
    {image && !error && <>
      <p className="text-xs text-[var(--text-secondary)]">{image.result.width && image.result.height ? `${image.result.width} × ${image.result.height}` : '尺寸未提供'} · {Math.ceil(image.result.bytes / 1024)} KB · {image.result.sourceLabels.join('、')}</p>
      <p className="text-xs text-[var(--text-secondary)]">{image.result.boundary}</p>
      <button type="button" className="agent-plugin-open" aria-expanded={openedKey === key} onClick={() => setOpenedKey(openedKey === key ? '' : key)}>{openedKey === key ? '收起本轮示意图' : '查看本轮示意图'}</button>
      {openedKey === key && <div data-testid="agent-illustration-content" className="space-y-3">
        <NextImage src={image.url} alt="本轮科研示意图，科学关系、几何和文字仍需人工核对" width={image.result.width || 1024} height={image.result.height || 768} unoptimized className="h-auto max-h-96 w-full object-contain" />
        <a className="agent-plugin-open" href={clientApiPath(image.result.downloadUrl)} download={`scientific-illustration-${reference.imageId}.${extension}`}>下载本轮示意图</a>
      </div>}
    </>}
  </div>;
}
