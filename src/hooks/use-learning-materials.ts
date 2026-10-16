'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import { emptyLearningMaterials, isLearningMaterials, type LearningMaterials } from '@/lib/learning-materials';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { NotebookDocument } from '@/lib/private-notebook-document';
import { studioSessionStorageKey } from '@/lib/studio-session-storage';

function sessionMaterials(scopeKey: string): LearningMaterials {
  try {
    const read = (field: string) => JSON.parse(window.sessionStorage.getItem(studioSessionStorageKey(scopeKey, 'learning-artifacts', field)) || 'null');
    const snapshot: unknown = read('snapshot');
    if (isLearningMaterials(snapshot)) return snapshot;
    const legacy: unknown = {
      cards: read('cards') || [], citations: read('citations') || [], retrieval: read('retrieval'), citationAudit: read('citation-audit'),
      cardIndex: read('card-index') || 0, quizIndex: read('quiz-index') || 0, answers: read('quiz-answers') || {},
    };
    return isLearningMaterials(legacy) ? legacy : emptyLearningMaterials();
  } catch { return emptyLearningMaterials(); }
}

export function useLearningMaterials(scopeKey: string) {
  const notebookId = notebookIdFromStorageScopeKey(scopeKey);
  const guest = scopeKey.startsWith('guest:');
  const [data, setData] = useState<LearningMaterials>(emptyLearningMaterials);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = useRef(data);
  const revision = useRef<string | null>(null);
  const active = useRef(false);
  const dirty = useRef(false);
  const writing = useRef(false);
  const blocked = useRef(false);
  const controllers = useRef(new Set<AbortController>());

  const remember = useCallback((next: LearningMaterials) => {
    current.current = next;
    setData(next);
    try { window.sessionStorage.setItem(studioSessionStorageKey(scopeKey, 'learning-artifacts', 'snapshot'), JSON.stringify(next)); }
    catch { if (guest) setError('浏览器无法保存进度，关闭页面后将无法恢复。'); }
  }, [guest, scopeKey]);

  const write = useCallback(async (next: LearningMaterials, signal: AbortSignal) => {
    const response = await clientApiRequest('/api/ai/knowledge-cards', {
      method: 'PUT', headers: accountAuthHeaders(), signal, redirectOnUnauthorized: false,
      body: JSON.stringify({ notebookId, data: next, expectedRevision: revision.current }),
    });
    const payload = await response.json() as { document?: NotebookDocument<LearningMaterials>; error?: string };
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (response.status === 409) { blocked.current = true; setConflict(true); }
    if (!response.ok || !payload.document) throw new Error(payload.error || '进度尚未保存，请重试。');
    return payload.document;
  }, [notebookId]);

  const save = useCallback(async () => {
    if (guest || writing.current || blocked.current || !active.current) return;
    writing.current = true;
    setSaving(true);
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      while (dirty.current && active.current && !controller.signal.aborted) {
        const next = current.current;
        const saved = await write(next, controller.signal);
        if (!active.current || controller.signal.aborted) return;
        revision.current = saved.revision;
        dirty.current = current.current !== next;
      }
      if (active.current) setError(null);
    } catch (caught) {
      if (!controller.signal.aborted && active.current) setError(caught instanceof Error ? caught.message : '进度尚未保存，请重试。');
    } finally {
      controllers.current.delete(controller);
      writing.current = false;
      if (active.current) setSaving(false);
    }
  }, [guest, write]);

  useEffect(() => {
    active.current = true;
    dirty.current = false;
    blocked.current = false;
    revision.current = null;
    setConflict(false);
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    const pending = controllers.current;
    pending.add(controller);
    const legacy = sessionMaterials(scopeKey);
    void (async () => {
      try {
        if (guest || !notebookId) { remember(legacy); return; }
        const response = await clientApiRequest(`/api/ai/knowledge-cards?${new URLSearchParams({ notebookId })}`, {
          headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false,
        });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          // Only the already identity-scoped account session can be imported; never guest storage.
          const saved = legacy.cards.length ? await write(legacy, controller.signal) : null;
          if (controller.signal.aborted) return;
          revision.current = saved?.revision || null;
          remember(saved?.data || legacy);
          return;
        }
        const payload = await response.json() as { document?: NotebookDocument<LearningMaterials>; error?: string };
        if (!response.ok || !payload.document || !isLearningMaterials(payload.document.data)) throw new Error(payload.error || '学习材料暂时无法读取，请重试。');
        if (controller.signal.aborted) return;
        revision.current = payload.document.revision;
        remember(payload.document.data);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '学习材料暂时无法读取，请重试。');
      } finally {
        pending.delete(controller);
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => { active.current = false; pending.forEach(item => item.abort()); pending.clear(); };
  }, [attempt, guest, notebookId, remember, scopeKey, write]);

  const update = useCallback((change: (previous: LearningMaterials) => LearningMaterials) => {
    remember(change(current.current));
    dirty.current = true;
    void save();
  }, [remember, save]);

  const acceptSaved = useCallback((saved: NotebookDocument<LearningMaterials>) => {
    revision.current = saved.revision;
    dirty.current = false;
    remember(saved.data);
    setError(null);
  }, [remember]);

  return { data, loading, saving, error, conflict, revision, update, acceptSaved,
    retry: () => void save(), reload: () => setAttempt(value => value + 1) };
}
