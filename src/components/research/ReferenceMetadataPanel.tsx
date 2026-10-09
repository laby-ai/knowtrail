"use client";
import { useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { notebookIdFromStorageScopeKey } from "@/lib/notebook-scope";
import { accountAuthHeaders } from "@/lib/account-session-browser";
import { clientApiRequest } from "@/lib/client-api";
import {
  referencesBibtex,
  type ReferenceMetadata,
} from "@/lib/reference-metadata";
import type { Citation } from "@/types";

export function ReferenceMetadataPanel({
  citations,
  onLoaded,
}: {
  citations: Citation[];
  onLoaded: (items: ReferenceMetadata[]) => void;
}) {
  const { storageScopeKey } = useApp();
  const [items, setItems] = useState<ReferenceMetadata[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sourceIds = [
    ...new Set(
      citations.map((item) => item.sourceId || item.paperId).filter(Boolean),
    ),
  ];
  async function load(enrich: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await clientApiRequest("/api/research/references", {
        method: "POST",
        headers: {
          ...accountAuthHeaders(),
          "Content-Type": "application/json",
        },
        timeoutMs: 65000,
        body: JSON.stringify({
          notebookId: notebookIdFromStorageScopeKey(storageScopeKey),
          sourceIds,
          enrich,
        }),
      });
      const payload = (await response.json()) as {
        items?: ReferenceMetadata[];
        error?: string;
      };
      if (!response.ok || !payload.items)
        throw new Error(payload.error || "参考文献读取失败。");
      setItems(payload.items);
      onLoaded(payload.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "参考文献读取失败。");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([referencesBibtex(items)], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "references.bib";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="space-y-2 rounded-lg border p-3 text-xs"
      data-testid="reference-metadata-panel"
    >
      <h4 className="font-semibold">参考文献题录</h4>
      <p className="leading-relaxed text-[var(--text-tertiary)]">
        从当前文献本读取真实题录，可按 DOI
        补全作者、刊名、卷期及页码。正文证据编号对应片段；下面的 R
        编号对应去重后的文献，保留两者映射。BibTeX 可供 LaTeX
        或文献管理器使用，投稿样式由其模板决定。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !sourceIds.length || sourceIds.length > 20}
          onClick={() => void load(false)}
          className="liquid-glass-btn px-3 py-2"
        >
          读取文献库题录
        </button>
        <button
          type="button"
          disabled={busy || !sourceIds.length || sourceIds.length > 20}
          onClick={() => void load(true)}
          className="liquid-glass-btn px-3 py-2"
        >
          {busy ? "正在核对题录…" : "补全 DOI 题录"}
        </button>
        {!!items.length && (
          <button
            type="button"
            disabled={busy}
            onClick={download}
            className="liquid-glass-btn px-3 py-2"
            data-testid="reference-bibtex"
          >
            下载 BibTeX
          </button>
        )}
      </div>
      {sourceIds.length > 20 && <p>本次引用超过 20 个来源，请分批整理题录。</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <div className="max-h-64 space-y-3 overflow-auto">
        {items.map((item, index) => (
          <article
            key={item.sourceId}
            className="space-y-1 break-words rounded border p-2"
          >
            <p className="font-medium">
              [R{index + 1}] {item.paper.title}
            </p>
            <p>
              {[
                item.paper.authors.map((author) => author.name).join("; "),
                item.paper.year,
                item.paper.venue,
                item.paper.volume &&
                  `${item.paper.volume}${item.paper.issue ? "(" + item.paper.issue + ")" : ""}`,
                item.paper.pages,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {item.paper.doi && <p>DOI: {item.paper.doi}</p>}
            <p className="text-[var(--text-tertiary)]">
              证据编号：
              {citations
                .flatMap((citation, number) =>
                  (citation.sourceId || citation.paperId) === item.sourceId
                    ? [`[${number + 1}]`]
                    : [],
                )
                .join("、")}{" "}
              · 题录来源：{item.origin === "crossref" ? "Crossref" : "文献库"}
            </p>
            {!!item.warnings.length && (
              <p className="text-amber-700">
                待核对：{item.warnings.join("；")}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
