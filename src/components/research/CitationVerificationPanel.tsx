"use client";
import { useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { notebookIdFromStorageScopeKey } from "@/lib/notebook-scope";
import { accountAuthHeaders } from "@/lib/account-session-browser";
import { clientApiRequest } from "@/lib/client-api";
import type { FulltextAuditReport } from "@/lib/fulltext-citation-audit";
import type { AcademicWritingDraft } from "@/lib/academic-writing-contract";
import type { Citation } from "@/types";
export function CitationVerificationPanel({
  draft,
  citations,
}: {
  draft: AcademicWritingDraft;
  citations: Citation[];
}) {
  const { storageScopeKey } = useApp();
  const [report, setReport] = useState<FulltextAuditReport | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(semantic: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await clientApiRequest(
        "/api/research/citation-verification",
        {
          method: "POST",
          timeoutMs: 60000,
          headers: {
            ...accountAuthHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            notebookId: notebookIdFromStorageScopeKey(storageScopeKey),
            semantic,
            claims: draft.paragraphs.map((item) => ({
              text: item.text,
              markers: item.evidenceMarkers,
            })),
            citations: citations.map((item) => ({
              sourceId: item.sourceId || item.paperId,
              excerpt: item.excerpt || item.snippet || "",
              ...(typeof item.page === "number" ? { page: item.page } : {}),
              ...(typeof item.chunkIndex === "number"
                ? { chunkIndex: item.chunkIndex }
                : {}),
            })),
          }),
        },
      );
      const payload = (await response.json()) as {
        report?: FulltextAuditReport;
        error?: string;
      };
      if (payload.report) setReport(payload.report);
      if (!response.ok) throw new Error(payload.error || "核验失败");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "核验失败");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "citation-audit.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const statuses = {
    supported: "原文片段支持",
    partial: "部分支持",
    contradicted: "与原文矛盾",
    insufficient: "证据不足",
  };
  return (
    <section
      className="space-y-2 rounded-lg border p-3 text-xs"
      data-testid="citation-verification-panel"
    >
      <h4 className="font-semibold">全文引证核验</h4>
      <p className="leading-relaxed text-[var(--text-tertiary)]">
        检查引用片段、页码和位置是否匹配文献本中的实际解析正文。主张语义评审使用账号模型，逐项返回原文依据；全文未取得、未解析页面及图像会保留为核验缺口。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !citations.length}
          onClick={() => void run(false)}
          className="liquid-glass-btn px-3 py-2"
        >
          检查原文匹配
        </button>
        <button
          type="button"
          disabled={busy || !citations.length || draft.paragraphs.length > 8}
          onClick={() => void run(true)}
          className="liquid-glass-btn px-3 py-2"
        >
          {busy ? "正在核验…" : "主张语义评审（账号模型）"}
        </button>
        {report && (
          <button
            type="button"
            onClick={download}
            className="liquid-glass-btn px-3 py-2"
          >
            下载核验报告
          </button>
        )}
      </div>
      {draft.paragraphs.length > 8 && (
        <p>语义评审每批最多 8 段，请分批核验。</p>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {report && (
        <div
          className="max-h-96 space-y-3 overflow-auto"
          data-testid="citation-verification-results"
        >
          <p className="text-[var(--text-tertiary)]">{report.coverage}</p>
          {report.claims.map((claim) => (
            <article key={claim.index} className="space-y-2 rounded border p-2">
              <p className="font-medium">
                第 {claim.index + 1} 段 · 引用{" "}
                {claim.markers.map((marker) => `[${marker}]`).join("、") ||
                  "无"}
              </p>
              <p>{claim.text}</p>
              <p
                className={
                  claim.findings.length ? "text-amber-700" : "text-emerald-700"
                }
              >
                {claim.findings.join("；") ||
                  "引用片段已在解析原文中找到；主张支持程度仍需语义评审。"}
              </p>
              {claim.semantic && (
                <p
                  className={
                    claim.semantic.status === "supported"
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }
                >
                  语义评审建议：{statuses[claim.semantic.status]} ·{" "}
                  {claim.semantic.reason}
                </p>
              )}
              {claim.sources.map((source) => (
                <details key={source.sourceId}>
                  <summary>
                    {source.title} ·{" "}
                    {source.scope === "fulltext" ||
                    source.scope === "parsed-document"
                      ? "已解析正文"
                      : "仅摘要 / 题录"}{" "}
                    · {source.quoteFound ? "引用片段已找到" : "引用片段未找到"}
                  </summary>
                  {source.quotes.map((quote) => (
                    <blockquote
                      key={quote.chunkIndex}
                      className="my-2 whitespace-pre-wrap rounded bg-[var(--bg-secondary)] p-2"
                    >
                      {typeof quote.page === "number"
                        ? `第 ${quote.page} 页 · `
                        : ""}
                      片段 {quote.chunkIndex + 1}
                      <br />
                      {quote.text}
                    </blockquote>
                  ))}
                  <p className="break-all text-[var(--text-tertiary)]">
                    解析原文 SHA-256：{source.sha256}
                  </p>
                </details>
              ))}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
