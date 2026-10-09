"use client";

import { useState } from "react";
import type { AcademicWritingDraft } from "@/lib/academic-writing-contract";
import {
  evidenceEntries,
  exportDocx,
  exportLatex,
  type ManuscriptLayout,
} from "@/lib/manuscript-export";
import type { Citation } from "@/types";
import { JournalDiscovery } from "./JournalDiscovery";
import { ResearchCollaboration } from "./ResearchCollaboration";
import { JournalTemplatePicker } from "./JournalTemplatePicker";
import type { JournalWordTemplate } from "@/lib/journal-word-template";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ManuscriptDelivery({
  draft,
  citations,
}: {
  draft: AcademicWritingDraft;
  citations: Citation[];
}) {
  const [layout, setLayout] = useState<ManuscriptLayout>("single");
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<JournalWordTemplate | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  async function word() {
    setError("");
    setBusy(true);
    try {
      const bytes = await exportDocx(draft, citations, layout, template);
      download(
        new Blob([new Uint8Array(bytes).buffer], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        "manuscript.docx",
      );
    } catch {
      setError("Word 导出失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="liquid-glass-card space-y-3 p-3"
      data-testid="manuscript-delivery"
    >
      <h3 className="text-sm font-semibold">论文排版与导出</h3>
      <label className="block text-xs">
        排版方案
        <select
          className="liquid-glass-input mt-1"
          value={layout}
          disabled={Boolean(template)}
          onChange={(event) =>
            setLayout(event.target.value as ManuscriptLayout)
          }
        >
          <option value="single">通用学术稿 · A4 单栏</option>
          <option value="double">通用学术稿 · A4 双栏</option>
        </select>
      </label>
      <p className="text-[11px] text-[var(--text-tertiary)]">
        通用排版方案；目标期刊的篇幅、引用规范和官方模板需另外核对。LaTeX 使用
        XeLaTeX 编译，保留中文与证据编号。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || templateBusy}
          onClick={() => void word()}
          className="liquid-glass-btn px-3 py-2 text-xs"
          data-testid="manuscript-docx"
        >
          {busy ? "正在导出…" : "下载 Word"}
        </button>
        <button
          type="button"
          onClick={() =>
            download(
              new Blob([exportLatex(draft, citations, layout)], {
                type: "text/plain;charset=utf-8",
              }),
              "manuscript.tex",
            )
          }
          className="liquid-glass-btn px-3 py-2 text-xs"
          data-testid="manuscript-latex"
        >
          下载 LaTeX
        </button>
        <button
          type="button"
          onClick={() => setPreview((value) => !value)}
          className="liquid-glass-btn px-3 py-2 text-xs"
        >
          {preview ? "收起预览" : "论文排版预览"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <JournalDiscovery initialQuery={draft.title} />
      <JournalTemplatePicker
        value={template}
        onChange={(next) => {
          setTemplate(next);
          if (next) setLayout(next.columns === 2 ? "double" : "single");
        }}
        onBusyChange={setTemplateBusy}
      />
      <ResearchCollaboration
        initialTitle={draft.title}
        initialContent={
          draft.paragraphs.map((item) => item.text).join("\n\n") +
          "\n\n引用证据索引\n" +
          evidenceEntries(citations)
            .map(
              (item) =>
                `[${item.number}] ${item.title} ${item.locator}\n${item.excerpt}`,
            )
            .join("\n\n")
        }
      />
      {preview && (
        <article
          className="rounded-lg border bg-white p-5 text-black"
          data-testid="manuscript-preview"
        >
          <h4 className="mb-4 text-center font-serif text-lg font-bold">
            {draft.title}
          </h4>
          <div
            style={{
              columnCount: layout === "double" ? 2 : 1,
              columnGap: "1.5rem",
            }}
            className="font-serif text-xs leading-6"
          >
            {draft.paragraphs.map((item, index) => (
              <p key={index} className="mb-3 text-justify">
                {item.text}
                {item.evidenceMarkers
                  .filter((marker) => !item.text.includes(`[${marker}]`))
                  .map((marker) => (
                    <sup key={marker}>[{marker}]</sup>
                  ))}
              </p>
            ))}
            <h5 className="font-bold">引用证据索引</h5>
            {evidenceEntries(citations).map((item) => (
              <p key={item.number} className="mb-2 break-words">
                [{item.number}] {item.title} {item.locator}
              </p>
            ))}
          </div>
          <p className="mt-4 text-[10px] text-gray-500">
            网页预览用于检查结构；Word 与 LaTeX 的实际分页由各自排版引擎决定。
          </p>
        </article>
      )}
    </section>
  );
}
