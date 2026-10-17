'use client';

import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiPath, clientApiRequest } from '@/lib/client-api';
import type { NotebookDocument } from '@/lib/private-notebook-document';

export async function requestGeneratedDeck<T>(input: {
  endpoint: string;
  body: { notebookId?: string; runId: string } & Record<string, unknown>;
  signal: AbortSignal;
  validate: (value: unknown) => value is T;
  acceptSaved: (document: NotebookDocument<T>) => void;
  updateLocal: (change: () => T) => void;
  onEvent: (data: Record<string, unknown>) => void;
}): Promise<T> {
  const headers = accountAuthHeaders();
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(600_000)]);
  // Closing a streamed response is not reliably propagated through reverse proxies.
  // Cancel the verified request explicitly, without deleting its previous saved deck.
  const cancel = () => { void fetch(clientApiPath(input.endpoint), { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: input.body.notebookId, runId: input.body.runId }), keepalive: true, signal: AbortSignal.timeout(20_000) }).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
  const response = await clientApiRequest(input.endpoint, { method: 'POST', headers, body: JSON.stringify(input.body), signal, timeoutMs: 120_000, redirectOnUnauthorized: false });
  if (!response.ok || !response.body) throw new Error('简报生成请求失败，请重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  while (true) {
    const { done, value } = await reader.read();
    signal.throwIfAborted();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n'); buffer = events.pop() || '';
    for (const line of events) {
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if (data.stage === 'error') throw new Error(String(data.message || '简报生成失败。'));
      input.onEvent(data);
      if (input.validate(data.unsavedDocument)) {
        input.updateLocal(() => data.unsavedDocument as T);
        throw new Error(String(data.saveError || '简报已生成但尚未保存，请重试保存。'));
      }
      if (data.document) {
        const document = data.document as NotebookDocument<T>;
        if (!input.validate(document.data)) throw new Error('简报内容不完整，请重新读取。');
        input.acceptSaved(document);
        result = document.data;
      }
    }
  }
  if (!result) throw new Error('生成未完成，已保存的简报仍保留，请重试。');
  return result;
  } finally { signal.removeEventListener('abort', cancel); }
}
