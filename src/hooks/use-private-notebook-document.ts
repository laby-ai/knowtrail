'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { ClientRequestError, clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { NotebookDocument } from '@/lib/private-notebook-document';
import { studioSessionStorageKey } from '@/lib/studio-session-storage';

interface PendingDocument<T> { data: T; expectedRevision: string | null }
interface Options<T> {
  scopeKey: string;
  toolId: string;
  endpoint: string;
  empty: () => T;
  validate: (value: unknown) => value is T;
  readLegacy?: (scopeKey: string) => T | null;
  preferSaved?: (saved: T, pending: T) => boolean;
}

function message(error: unknown): string {
  return error instanceof ClientRequestError && error.code === 'timeout'
    ? '请求超时，内容尚未保存，请重试。'
    : error instanceof Error ? error.message : '内容暂时无法保存或读取，请重试。';
}

export function usePrivateNotebookDocument<T>({ scopeKey, toolId, endpoint, empty, validate, readLegacy, preferSaved }: Options<T>) {
  const notebookId = notebookIdFromStorageScopeKey(scopeKey);
  const guest = scopeKey.startsWith('guest:');
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = useRef(data);
  const revision = useRef<string | null>(null);
  const active = useRef(false);
  const pending = useRef<PendingDocument<T> | null>(null);
  const task = useRef<Promise<boolean> | null>(null);
  const taskController = useRef<AbortController | null>(null);
  const blocked = useRef(false);
  const timer = useRef<number | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const snapshotKey = studioSessionStorageKey(scopeKey, toolId, 'snapshot');
  const pendingKey = studioSessionStorageKey(scopeKey, toolId, 'pending');

  const remember = useCallback((next: T) => {
    current.current = next;
    setData(next);
    try { window.sessionStorage.setItem(snapshotKey, JSON.stringify(next)); }
    catch { if (guest) setError('浏览器无法保存，关闭页面后将无法恢复。'); }
  }, [guest, snapshotKey]);

  const clearPending = useCallback(() => {
    pending.current = null;
    setUnsaved(false);
    try { window.sessionStorage.removeItem(pendingKey); } catch { /* Server copy remains authoritative. */ }
  }, [pendingKey]);

  const cachePending = useCallback((next: PendingDocument<T>) => {
    pending.current = next;
    setUnsaved(true);
    try { window.sessionStorage.setItem(pendingKey, JSON.stringify(next)); }
    catch { setError('浏览器无法暂存，请在保存成功前保持页面打开。'); }
  }, [pendingKey]);

  const write = useCallback(async (next: PendingDocument<T>, signal: AbortSignal) => {
    const response = await clientApiRequest(endpoint, {
      method: 'PUT', headers: accountAuthHeaders(), signal, redirectOnUnauthorized: false,
      body: JSON.stringify({ notebookId, ...next }),
    });
    const payload = await response.json() as { document?: NotebookDocument<T>; error?: string };
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!response.ok || !payload.document || !validate(payload.document.data)) throw new ClientRequestError(payload.error || '内容尚未保存，请重试。', 'http_error', response.status);
    return payload.document;
  }, [endpoint, notebookId, validate]);

  const acceptSaved = useCallback((saved: NotebookDocument<T>) => {
    if (!active.current) return;
    revision.current = saved.revision;
    clearPending();
    remember(saved.data);
    setError(null);
    setReadFailed(false);
    setConflict(false);
    blocked.current = false;
  }, [clearPending, remember]);

  const save = useCallback((): Promise<boolean> => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (task.current) return task.current;
    if (guest || !pending.current) return Promise.resolve(true);
    if (blocked.current || !active.current) return Promise.resolve(false);
    const controller = new AbortController();
    taskController.current = controller;
    controllers.current.add(controller);
    setSaving(true);
    const running = (async () => {
      try {
        while (pending.current && active.current && !controller.signal.aborted) {
          const next = pending.current;
          const saved = await write(next, controller.signal);
          if (!active.current || controller.signal.aborted) return false;
          revision.current = saved.revision;
          if (pending.current === next) clearPending();
          else if (pending.current) cachePending({ data: pending.current.data, expectedRevision: saved.revision });
        }
        setError(null);
        setReadFailed(false);
        return true;
      } catch (caught) {
        if (!controller.signal.aborted && active.current) {
          if (caught instanceof ClientRequestError && caught.status === 409) { blocked.current = true; setConflict(true); }
          setError(message(caught));
        }
        return false;
      } finally {
        controllers.current.delete(controller);
        if (taskController.current === controller) {
          task.current = null;
          taskController.current = null;
          if (active.current) setSaving(false);
        }
      }
    })();
    task.current = running;
    return running;
  }, [cachePending, clearPending, guest, write]);

  useEffect(() => {
    active.current = true;
    blocked.current = false;
    revision.current = null;
    pending.current = null;
    setError(null); setConflict(false); setUnsaved(false); setReadFailed(false); setLoading(true);
    const controller = new AbortController();
    const requests = controllers.current;
    requests.add(controller);
    void (async () => {
      let cachedPending: PendingDocument<T> | null = null;
      try {
        const read = (key: string): unknown => JSON.parse(window.sessionStorage.getItem(key) || 'null');
        let local: T | null = null;
        try { const cached = read(snapshotKey); local = validate(cached) ? cached : readLegacy?.(scopeKey) || null; } catch { local = readLegacy?.(scopeKey) || null; }
        if (guest || !notebookId) { remember(local || empty()); return; }
        try {
          const cached = read(pendingKey) as Partial<PendingDocument<T>> | null;
          if (cached && validate(cached.data) && (cached.expectedRevision === null || typeof cached.expectedRevision === 'string')) cachedPending = cached as PendingDocument<T>;
        } catch { /* Invalid browser cache cannot authorize or replace server content. */ }
        const response = await clientApiRequest(`${endpoint}${endpoint.includes('?') ? '&' : '?'}${new URLSearchParams({ notebookId })}`, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false });
        if (controller.signal.aborted) return;
        const payload = await response.json() as { document?: NotebookDocument<T>; error?: string };
        if (response.status !== 404 && (!response.ok || !payload.document || !validate(payload.document.data))) throw new Error(payload.error || '内容暂时无法读取，请重试。');
        const saved = response.status === 404 ? null : payload.document!;
        if (cachedPending && !(saved && preferSaved?.(saved.data, cachedPending.data))) {
          remember(cachedPending.data);
          cachePending(cachedPending);
          revision.current = cachedPending.expectedRevision;
          acceptSaved(await write(cachedPending, controller.signal));
        } else if (saved) acceptSaved(saved);
        else if (local) acceptSaved(await write({ data: local, expectedRevision: null }, controller.signal));
        else remember(empty());
      } catch (caught) {
        if (!controller.signal.aborted) {
          setReadFailed(true);
          if (caught instanceof ClientRequestError && caught.status === 409) { blocked.current = true; setConflict(true); }
          setError(`${message(caught)}${cachedPending ? ' 未保存草稿仍在当前浏览器，请重试读取。' : ''}`);
        }
      } finally {
        requests.delete(controller);
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      active.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      requests.forEach(item => item.abort()); requests.clear();
    };
  }, [acceptSaved, attempt, cachePending, empty, endpoint, guest, notebookId, pendingKey, preferSaved, readLegacy, remember, scopeKey, snapshotKey, validate, write]);

  const updateLocal = useCallback((change: (previous: T) => T) => {
    if (!active.current) return;
    const next = change(current.current);
    remember(next);
    if (!guest) cachePending({ data: next, expectedRevision: revision.current });
  }, [cachePending, guest, remember]);

  const update = useCallback((change: (previous: T) => T) => {
    updateLocal(change);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void save(); }, 400);
  }, [save, updateLocal]);

  return { data, loading, saving, error, conflict, unsaved, readFailed, revision, update, updateLocal, acceptSaved, flush: save,
    retry: () => void save(), retryRead: () => setAttempt(value => value + 1), reload: () => { clearPending(); setAttempt(value => value + 1); } };
}
