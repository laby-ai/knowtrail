'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientRequestError, clientApiPath, clientApiRequest } from '@/lib/client-api';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { announceStudioOutputSaved } from '@/lib/studio-output-events';

interface PresentationFile { scopeKey: string; url: string; fileName: string; slideCount?: number; id?: string }

export function useStructuredPresentationFile(scopeKey: string, notebookId: string | undefined, onError: (message: string | null) => void, artifactId?: string | null) {
  const [presentation, setPresentation] = useState<PresentationFile | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const scopeKeyRef = useRef(scopeKey);
  const latestArtifactId = useRef<string | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Set<string>());
  const pptxUrl = presentation?.scopeKey === scopeKey ? presentation.url : null;

  useEffect(() => {
    scopeKeyRef.current = scopeKey; latestArtifactId.current = null;
    downloadController.current?.abort(); downloadController.current = null; setIsDownloading(false);
    const controller = new AbortController();
    setPresentation(null); setRestoreError(null);
    if (!notebookId || scopeKey.startsWith('guest:')) { setIsRestoring(false); return () => controller.abort(); }
    setIsRestoring(true);
    void (async () => {
      try {
        const query = new URLSearchParams({ notebookId });
        if (artifactId) query.set('artifactId', artifactId);
        const response = await clientApiRequest(`/api/ai/ppt-v2?${query}`, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false });
        if (controller.signal.aborted || response.status === 404 && !artifactId) return;
        const payload = await response.json() as { error?: string; artifact?: { id?: string; fileName?: string; slideCount?: number } };
        if (!response.ok) throw new Error(payload.error || 'PPT暂时无法读取，请重试。');
        const artifact = payload.artifact;
        if (!artifact?.id || !/^[a-f0-9]{64}$/.test(artifact.id)) throw new Error('PPT保存信息不完整，请重试。');
        if (artifactId && artifact.id !== artifactId) throw new Error('PPT版本不一致，请重新读取。');
        if (controller.signal.aborted || scopeKeyRef.current !== scopeKey) return;
        latestArtifactId.current = artifact.id;
        if (artifactId !== null) setPresentation({ scopeKey, id: artifact.id, url: clientApiPath(`/api/ai/ppt-v2?${new URLSearchParams({ notebookId, artifactId: artifact.id, download: '1' })}`), fileName: artifact.fileName || 'academic-presentation.pptx', slideCount: artifact.slideCount });
      } catch (error) {
        if (!controller.signal.aborted && scopeKeyRef.current === scopeKey) setRestoreError(error instanceof Error ? error.message : 'PPT暂时无法读取，请重试。');
      } finally {
        if (!controller.signal.aborted && scopeKeyRef.current === scopeKey) setIsRestoring(false);
      }
    })();
    return () => controller.abort();
  }, [artifactId, attempt, notebookId, scopeKey]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => { downloadController.current?.abort(); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  }, [scopeKey]);

  const acceptResponse = useCallback(async (response: Response, requestScopeKey: string, slideCount: number, signal: AbortSignal) => {
    const artifactId = response.headers.get('X-PPT-Artifact-Id');
    const fileName = decodeURIComponent(response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'academic-presentation.pptx');
    if (artifactId && /^[a-f0-9]{64}$/.test(artifactId) && notebookId) {
      await response.body?.cancel();
      if (signal.aborted || scopeKeyRef.current !== requestScopeKey) return;
      latestArtifactId.current = artifactId;
      setPresentation({ scopeKey: requestScopeKey, id: artifactId, url: clientApiPath(`/api/ai/ppt-v2?${new URLSearchParams({ notebookId, artifactId, download: '1' })}`), fileName, slideCount });
      announceStudioOutputSaved(requestScopeKey, 'structured-ppt');
      return { id: artifactId, fileName, slideCount };
    } else {
      if (!scopeKey.startsWith('guest:')) throw new Error('PPT缺少保存信息，请刷新后重新读取。');
      const blob = await response.blob();
      if (signal.aborted || scopeKeyRef.current !== requestScopeKey) return;
      const url = URL.createObjectURL(blob); objectUrls.current.add(url);
      setPresentation({ scopeKey: requestScopeKey, url, fileName });
    }
  }, [notebookId, scopeKey]);

  const handleDownload = useCallback(async () => {
    if (!presentation || !pptxUrl || isDownloading) return;
    const controller = new AbortController(); downloadController.current = controller;
    setIsDownloading(true); onError(null);
    try {
      // Check access before letting the browser handle the versioned attachment itself.
      if (!pptxUrl.startsWith('blob:')) {
        const response = await clientApiRequest(pptxUrl, { method: 'HEAD', headers: accountAuthHeaders(), signal: controller.signal, timeoutMs: 60_000, redirectOnUnauthorized: false });
        if (!response.ok) throw new ClientRequestError('PPT暂时无法下载，请重新读取。', 'http_error', response.status);
        if (!response.headers.get('Content-Type')?.includes('presentationml.presentation')) throw new Error('返回的文件类型异常，请重新读取PPT。');
      }
      if (controller.signal.aborted || scopeKeyRef.current !== scopeKey) return;
      const link = document.createElement('a'); link.href = pptxUrl; link.download = presentation.fileName;
      document.body.appendChild(link); link.click(); link.remove();
    } catch (error) {
      if (!controller.signal.aborted && scopeKeyRef.current === scopeKey) {
        if (error instanceof ClientRequestError && [401, 403].includes(error.status || 0)) {
          onError(null); setPresentation(null); setRestoreError('登录状态已变化，请登录或重新读取。');
        } else onError(error instanceof Error ? error.message : 'PPT下载失败，请重试。');
      }
    } finally {
      if (downloadController.current === controller) { downloadController.current = null; if (scopeKeyRef.current === scopeKey) setIsDownloading(false); }
    }
  }, [isDownloading, onError, pptxUrl, presentation, scopeKey]);

  return { presentation, setPresentation, latestArtifactId, pptxUrl, isRestoring, restoreError, retryRestore: () => setAttempt(value => value + 1), isDownloading, handleDownload, scopeKeyRef, acceptResponse };
}
