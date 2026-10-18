'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbenchPreferences, WorkspaceNotebook } from '@/components/home/workspace-types';
import { clientApiFetch, ClientRequestError } from '@/lib/client-api';
import { catalogContentKey } from '@/lib/catalog-content-key';

export interface CatalogSnapshot { notebooks: WorkspaceNotebook[]; activeNotebookId: string | null; workbenchPreferences: WorkbenchPreferences }
interface Pending { data: CatalogSnapshot; expectedRevision: string | null }
export function useNotebookCatalogSync(owner: string, enabled: boolean, ready: boolean, snapshot: CatalogSnapshot) {
  const key = `knowtrail-catalog-pending:${owner}`;
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const revision = useRef<string | null>(null);
  const previous = useRef('');
  const latest = useRef(snapshot);
  const pending = useRef<Pending | null>(null);
  const active = useRef(false);
  const blocked = useRef(false);
  const task = useRef<Promise<void> | null>(null);
  const request = useRef<AbortController | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    active.current = true; loaded.current = false; blocked.current = false; revision.current = null; previous.current = ''; pending.current = null;
    setError(null); setConflict(false);
    return () => { active.current = false; request.current?.abort(); task.current = null; };
  }, [owner, enabled]);
  const acceptLoaded = useCallback((data: CatalogSnapshot, serverRevision: string | null, existing: boolean, discard = false) => {
    revision.current = serverRevision; previous.current = existing ? catalogContentKey(data) : ''; loaded.current = true; blocked.current = false;
    pending.current = null; setError(null); setConflict(false);
    if (discard) { try { window.localStorage.removeItem(key); } catch { /* Server list remains available. */ } return data; }
    try {
      const cached = JSON.parse(window.localStorage.getItem(key) || 'null') as Pending | null;
      if (cached && Array.isArray(cached.data?.notebooks) && (cached.expectedRevision === null || typeof cached.expectedRevision === 'string')) {
        if (catalogContentKey(cached.data) === catalogContentKey(data)) { window.localStorage.removeItem(key); return data; }
        pending.current = cached;
        if (cached.expectedRevision !== serverRevision) {
          blocked.current = true; setConflict(true); setError('另一页面已修改文献本列表。未保存改动仍留在此浏览器，请先读取已保存列表。');
        }
        return cached.data;
      }
    } catch { /* Invalid local data never replaces the server catalog. */ }
    return data;
  }, [key]);
  const save = useCallback((): Promise<void> => {
    if (task.current) return task.current;
    if (!enabled || !loaded.current || !active.current || blocked.current || catalogContentKey(latest.current) === previous.current) return Promise.resolve();
    const controller = new AbortController(); request.current = controller;
    const running = (async () => {
      try {
        while (active.current && !controller.signal.aborted && catalogContentKey(latest.current) !== previous.current) {
          const data = latest.current; const encoded = catalogContentKey(data);
          const payload = await clientApiFetch<{ catalog: { revision: string } }>('/api/notebooks', { method: 'PUT', signal: controller.signal, redirectOnUnauthorized: false, body: JSON.stringify({ ...data, expectedRevision: revision.current }) });
          if (controller.signal.aborted || !active.current) return;
          revision.current = payload.catalog.revision; previous.current = encoded;
          if (catalogContentKey(latest.current) === encoded) { pending.current = null; window.localStorage.removeItem(key); }
          else { pending.current = { data: latest.current, expectedRevision: revision.current }; window.localStorage.setItem(key, JSON.stringify(pending.current)); }
        }
        setError(null);
      } catch (caught) {
        if (!controller.signal.aborted && active.current) {
          if (caught instanceof ClientRequestError && caught.status === 409) { blocked.current = true; setConflict(true); }
          setError(caught instanceof Error ? caught.message : '文献本列表尚未保存，请重试。');
        }
      } finally { if (request.current === controller) { task.current = null; request.current = null; } }
    })();
    task.current = running;
    return running;
  }, [enabled, key]);
  useEffect(() => {
    latest.current = snapshot;
    if (!enabled || !ready || !loaded.current || catalogContentKey(snapshot) === previous.current) return;
    pending.current = { data: snapshot, expectedRevision: pending.current ? pending.current.expectedRevision : revision.current };
    try { window.localStorage.setItem(key, JSON.stringify(pending.current)); }
    catch { setError('浏览器无法暂存文献本改动，请保持页面打开并重试保存。'); }
    const timer = window.setTimeout(() => { void save(); }, 250);
    return () => window.clearTimeout(timer);
  }, [enabled, key, ready, save, snapshot]);
  return { acceptLoaded, error, conflict, retry: save };
}
