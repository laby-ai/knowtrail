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
import {
  CSL_STYLES,
  citationGroups,
  type CslStyleId,
  type FormattedReferences,
} from "@/lib/csl-contract";
import type { AcademicWritingDraft } from "@/lib/academic-writing-contract";
import { CslFormattedText } from "./CslFormattedText";
import { useResearchPreferences } from "./ResearchPreferencesProvider";
import { RESEARCH_DISCIPLINES } from "@/lib/research-preferences";

export function ReferenceMetadataPanel({
  citations,
  onLoaded,
  draft,
  onFormatted,
}: {
  citations: Citation[];
  onLoaded: (items: ReferenceMetadata[]) => void;
  draft: AcademicWritingDraft;
  onFormatted: (value: FormattedReferences | null) => void;
}) {
  const { storageScopeKey } = useApp();
  const [items, setItems] = useState<ReferenceMetadata[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { preferences } = useResearchPreferences();
  const disciplineStyle = RESEARCH_DISCIPLINES.find(
    (discipline) => discipline.id === preferences.disciplines[0],
  )?.citationStyle;
  const [styleId, setStyleId] = useState<CslStyleId>(
    disciplineStyle === "apa"
      ? "apa"
      : disciplineStyle === "vancouver"
        ? "vancouver"
        : disciplineStyle === "GB/T 7714"
          ? "gbt2015"
          : "ieee",
  );
  const [formatted, setFormatted] = useState<FormattedReferences | null>(null);
  async function format() {
    setBusy(true);
    setError("");
    try {
      const response = await clientApiRequest(
        "/api/research/reference-format",
        {
          method: "POST",
          headers: {
            ...accountAuthHeaders(),
            "Content-Type": "application/json",
          },
          timeoutMs: 65000,
          body: JSON.stringify({
            notebookId: notebookIdFromStorageScopeKey(storageScopeKey),
            sourceIds,
            citationSourceIds: citations.map(
              (item) => item.sourceId || item.paperId,
            ),
            groups: citationGroups(draft),
            styleId,
            enrich: true,
          }),
        },
      );
      const payload = (await response.json()) as {
        items?: ReferenceMetadata[];
        formatted?: FormattedReferences;
        error?: string;
      };
      if (!response.ok || !payload.items || !payload.formatted)
        throw new Error(payload.error || "引用格式处理失败");
      setItems(payload.items);
      onLoaded(payload.items);
      setFormatted(payload.formatted);
      onFormatted(payload.formatted);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "引用格式处理失败");
    } finally {
      setBusy(false);
    }
  }
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
      setFormatted(null);
      onFormatted(null);
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
      <div className="flex flex-wrap items-end gap-2">
        <label>
          期刊引用样式
          <select
            aria-label="期刊引用样式"
            value={styleId}
            disabled={busy}
            onChange={(event) => {
              setStyleId(event.target.value as CslStyleId);
              setFormatted(null);
              onFormatted(null);
            }}
            className="liquid-glass-input mt-1 block"
          >
            {CSL_STYLES.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !sourceIds.length || sourceIds.length > 20}
          onClick={() => void format()}
          className="liquid-glass-btn px-3 py-2"
        >
          应用期刊引用格式
        </button>
      </div>
      {formatted && (
        <div
          className="space-y-2 rounded border p-2"
          data-testid="formatted-bibliography"
        >
          <p>
            已应用：
            {
              CSL_STYLES.find((style) => style.id === formatted.styleId)?.label
            }{" "}
            · 正文引文与参考文献将写入 Word / LaTeX。
          </p>
          {formatted.entries.map((item) => (
            <p key={item.sourceId} className="break-words">
              <CslFormattedText runs={item.runs || [{ text: item.text }]} />
            </p>
          ))}
        </div>
      )}
      <p className="text-[var(--text-tertiary)]">
        <a
          href="https://github.com/Juris-M/citeproc-js"
          target="_blank"
          rel="noopener noreferrer"
        >
          citeproc-js © Frank Bennett（CPAL）
        </a>{" "}
        ·{" "}
        <a
          href="https://github.com/citation-style-language/styles"
          target="_blank"
          rel="noopener noreferrer"
        >
          CSL 样式来源（CC BY-SA）
        </a>
      </p>
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
