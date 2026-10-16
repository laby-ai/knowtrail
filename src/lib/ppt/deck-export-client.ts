'use client';

import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import type { NotebookDocument } from '@/lib/private-notebook-document';
import type { PptDeckKind } from '@/lib/ppt/deck-document';

export async function readDeckForExport<T>(kind: PptDeckKind, notebookId: string | undefined, revision: string | null, validate: (value: unknown) => value is T) {
  if (!notebookId || !revision) throw new Error('请先保存简报后导出。');
  const params = new URLSearchParams({ kind, notebookId, revision });
  const response = await clientApiRequest('/api/studio/artifacts?' + params, { headers: accountAuthHeaders(), redirectOnUnauthorized: false });
  const payload = await response.json() as { document?: NotebookDocument<T> };
  if (!response.ok || !payload.document || !validate(payload.document.data)) throw new Error('简报版本暂时无法读取，请重试。');
  return { data: payload.document.data, params };
}

export async function saveAndDownloadDeckExport(params: URLSearchParams, blob: Blob) {
  const response = await clientApiRequest('/api/studio/artifacts?' + params, { method: 'POST', headers: { ...accountAuthHeaders(), 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }, body: blob, timeoutMs: 120_000, redirectOnUnauthorized: false });
  const payload = await response.json() as { export?: { url: string; fileName: string }; error?: string };
  if (!response.ok || !payload.export) throw new Error(payload.error || '导出文件尚未保存，请重试。');
  const link = document.createElement('a'); link.href = payload.export.url; link.download = payload.export.fileName;
  document.body.appendChild(link); link.click(); link.remove();
}
