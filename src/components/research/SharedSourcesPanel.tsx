"use client";
import { useEffect, useState } from "react";
import { clientApiFetch, clientApiDownloadBlob } from "@/lib/client-api";
import { accountAuthHeaders } from "@/lib/account-session-browser";
import type { ResearchDocument } from "@/lib/research-collaboration-store";
import { useApp } from "@/contexts/AppContext";
import { notebookIdFromStorageScopeKey } from "@/lib/notebook-scope";
interface SourceSummary {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
}
interface SourcePreview {
  title: string;
  chunks: Array<{ text: string; page?: number; chunkIndex?: number }>;
}
export function SharedSourcesPanel({
  document,
  canEdit,
  onUpdated,
}: {
  document: ResearchDocument;
  canEdit: boolean;
  onUpdated: (document: ResearchDocument) => void;
}) {
  const { storageScopeKey } = useApp();
  const ownNotebookId =
    notebookIdFromStorageScopeKey(storageScopeKey) || "default-workspace";
  const [sources, setSources] = useState<SourceSummary[]>([]),
    [selection, setSelection] = useState<string[]>([]),
    [choosing, setChoosing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const base = `/api/research/shared-sources?documentId=${encodeURIComponent(document.id)}`;
  const grantsKey = JSON.stringify(document.sharedSourceIds || []);
  useEffect(() => {
    if (choosing) return;
    const controller = new AbortController();
    void clientApiFetch<{ sources: SourceSummary[] }>(
      `/api/research/shared-sources?documentId=${encodeURIComponent(document.id)}`,
      { headers: accountAuthHeaders(), signal: controller.signal },
    )
      .then((data) => setSources(data.sources))
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error ? caught.message : "共享来源读取失败",
          );
      });
    return () => controller.abort();
  }, [document.id, grantsKey, choosing]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "共享来源请求失败");
    } finally {
      setBusy(false);
    }
  }
  async function list(choose: boolean) {
    const data = await clientApiFetch<{ sources: SourceSummary[] }>(
      choose
        ? `/api/ingestion/sources?notebookId=${encodeURIComponent(ownNotebookId)}`
        : base,
      { headers: accountAuthHeaders() },
    );
    setSources(data.sources);
    setChoosing(choose);
    setSelection([]);
    setPreview(null);
  }
  async function save() {
    const data = await clientApiFetch<{ document: ResearchDocument }>(
      "/api/research/shared-sources",
      {
        method: "POST",
        headers: {
          ...accountAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "add",
          documentId: document.id,
          notebookId: ownNotebookId,
          sourceIds: selection,
        }),
      },
    );
    onUpdated(data.document);
    await list(false);
  }
  async function remove(source: SourceSummary) {
    const data = await clientApiFetch<{ document: ResearchDocument }>(
      "/api/research/shared-sources",
      {
        method: "POST",
        headers: {
          ...accountAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "remove",
          documentId: document.id,
          sourceId: source.id,
        }),
      },
    );
    onUpdated(data.document);
    await list(false);
  }
  async function view(source: SourceSummary) {
    const data = await clientApiFetch<{ source: SourcePreview }>(
      `${base}&sourceId=${encodeURIComponent(source.id)}`,
      { headers: accountAuthHeaders() },
    );
    setPreview(data.source);
  }
  async function download(source: SourceSummary) {
    const blob = await clientApiDownloadBlob(
      `${base}&sourceId=${encodeURIComponent(source.id)}&download=1`,
      { headers: accountAuthHeaders(), timeoutMs: 60000 },
    );
    const url = URL.createObjectURL(blob),
      anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = source.fileName;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="space-y-2 rounded-lg border p-3 text-xs">
      <h4 className="font-semibold">
        共享文献来源（{document.sharedSourceIds?.length || 0}）
      </h4>
      <p className="text-[var(--text-tertiary)]">
        所有者与编辑成员可从自己的当前文献本贡献来源，共同维护共享文献库。勾选共享后成员可读取原文件；移除只取消本项目的共享，不删除上传者的原文件。撤销成员权限后，后续读取和下载将被拒绝。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="liquid-glass-btn px-3 py-2"
          onClick={() => void run(() => list(false))}
        >
          查看共享来源
        </button>
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            className="liquid-glass-btn px-3 py-2"
            onClick={() => void run(() => list(true))}
          >
            从我的文献本添加
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {sources.map((source) => (
        <div
          key={source.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
        >
          {choosing && (
            <input
              aria-label={`共享 ${source.title}`}
              type="checkbox"
              checked={selection.includes(source.id)}
              onChange={(event) =>
                setSelection((current) =>
                  event.target.checked
                    ? [...current, source.id]
                    : current.filter((id) => id !== source.id),
                )
              }
            />
          )}
          <span className="min-w-0 flex-1 break-words">
            {source.title || source.fileName}
          </span>
          {!choosing && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => view(source))}
              >
                查看原文片段
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "从共享文献库移除此来源？上传者的原文件仍会保留。",
                      )
                    )
                      void run(() => remove(source));
                  }}
                >
                  移出共享文献库
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => download(source))}
              >
                下载原文件
              </button>
            </>
          )}
        </div>
      ))}
      {choosing && (
        <button
          type="button"
          disabled={busy || !selection.length}
          className="liquid-glass-btn px-3 py-2"
          onClick={() => void run(save)}
        >
          添加选定来源
        </button>
      )}
      {preview && (
        <div className="max-h-80 overflow-y-auto rounded-lg border bg-[var(--bg-card)] p-3">
          <h5 className="font-semibold">{preview.title}</h5>
          {preview.chunks.length === 0 && (
            <p>暂无提取文本，可下载原文件查看。</p>
          )}
          {preview.chunks.map((chunk, index) => (
            <article key={index} className="mt-3">
              <p className="mb-1 text-[var(--text-tertiary)]">
                {chunk.page ? `第 ${chunk.page} 页 · ` : ""}片段{" "}
                {(chunk.chunkIndex ?? index) + 1}
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">
                {chunk.text}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
