"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { clientApiFetch } from "@/lib/client-api";
import { SOURCE_MATRIX_FACETS } from "@/lib/source-matrix";
import type { LiteratureComparison, LiteratureComparisonRow, MatrixEvidence } from "@/lib/literature-comparison-contract";
import { HighlightedEvidence } from "./HighlightedEvidence";

interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; sourceIds: string[];
  notebookId?: string; sharedDocumentId?: string;
}
function download(value: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function LiteratureComparisonDialog({ open, onOpenChange, sourceIds, notebookId, sharedDocumentId }: Props) {
  const [data, setData] = useState<LiteratureComparison | null>(null);
  const [tab, setTab] = useState<"matrix" | "timeline">("matrix");
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [focus, setFocus] = useState<{ row: LiteratureComparisonRow; evidence: MatrixEvidence; text: string } | null>(null);
  const idsKey = JSON.stringify(sourceIds);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData(null); setFocus(null); setError(""); setLoading(true);
    void clientApiFetch<LiteratureComparison>("/api/research/literature-comparison", {
      method: "POST", signal: controller.signal,
      body: JSON.stringify({ sourceIds: JSON.parse(idsKey), ...(sharedDocumentId ? { sharedDocumentId } : { notebookId }) }),
    }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "文献比较读取失败。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, idsKey, notebookId, sharedDocumentId]);
  async function locate(row: LiteratureComparisonRow, evidence: MatrixEvidence) {
    setError(""); setFocus(null);
    try {
      const url = sharedDocumentId
        ? `/api/research/shared-sources?documentId=${encodeURIComponent(sharedDocumentId)}&sourceId=${encodeURIComponent(row.sourceId)}`
        : `/api/ingestion/sources?id=${encodeURIComponent(row.sourceId)}&notebookId=${encodeURIComponent(notebookId || "")}`;
      const result = await clientApiFetch<{ source: { chunks: Array<{ id: string; text: string }> } }>(url);
      const chunk = result.source.chunks.find(item => item.id === evidence.chunkId);
      if (!chunk || !chunk.text.includes(evidence.quote)) throw new Error("原文片段已变化或被移除，请重新打开文献矩阵。旧引用不会冒充当前证据。");
      setFocus({ row, evidence, text: chunk.text });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "原文读取失败。"); }
  }
  function exportCsv() {
    if (!data) return;
    const header = ["来源 ID", "标题", "发表年份", "DOI", "原文 SHA-256", ...SOURCE_MATRIX_FACETS.flatMap(item => [item.label, item.label + "定位"] )];
    const rows = data.rows.map(row => [row.sourceId, row.title, row.year ? String(row.year) : "年份未取得", row.doi || "", row.sourceHash,
      ...SOURCE_MATRIX_FACETS.flatMap(item => { const evidence = row.facets.find(facet => facet.key === item.key); return [evidence?.quote || "未识别到线索", evidence ? `${evidence.chunkId};片段 ${evidence.chunkIndex + 1}${evidence.page ? `;第 ${evidence.page} 页` : ""}` : ""]; })]);
    download("\uFEFF" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n"), "lingbi-literature-matrix.csv", "text/csv;charset=utf-8");
  }
  const evidenceButton = (row: LiteratureComparisonRow, evidence: MatrixEvidence) => <button type="button" key={evidence.key} className="block w-full text-left text-xs leading-relaxed" onClick={() => void locate(row, evidence)}>
    <span className="block font-medium text-blue-500">{evidence.label} · {evidence.page ? `第 ${evidence.page} 页 · ` : ""}片段 {evidence.chunkIndex + 1}</span>
    <span className="mt-1 block max-h-32 overflow-y-auto whitespace-pre-wrap">{evidence.quote}</span><span className="mt-1 block underline">定位原文</span>
  </button>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }} className="max-h-[90dvh] overflow-y-auto sm:max-w-6xl" data-testid="literature-comparison-dialog">
    <DialogTitle>文献矩阵与研究演化时间线</DialogTitle>
    <DialogDescription>从服务端已入库原文中提取可定位的线索。关键词分类仍需作者核验；不会把标题、上传日期或缺失数据当作研究证据。</DialogDescription>
    <div className="flex flex-wrap gap-2 text-xs"><button className="liquid-glass-btn px-3 py-2" aria-pressed={tab === "matrix"} onClick={() => setTab("matrix")}>结构化文献矩阵</button><button className="liquid-glass-btn px-3 py-2" aria-pressed={tab === "timeline"} onClick={() => setTab("timeline")}>研究演化时间线</button>
      {data && <><button className="liquid-glass-btn px-3 py-2" onClick={exportCsv}>导出矩阵 CSV</button><button className="liquid-glass-btn px-3 py-2" onClick={() => download(JSON.stringify(data, null, 2), "lingbi-literature-evidence.json", "application/json")}>导出证据与时间线</button></>}
    </div>
    {loading && <p role="status">正在读取已选来源与原文定位…</p>}{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    {data && tab === "matrix" && <div className="overflow-x-auto"><table className="w-full min-w-[850px] border-collapse text-xs"><thead><tr><th className="border p-3 text-left">文献</th>{SOURCE_MATRIX_FACETS.map(item => <th key={item.key} className="border p-3 text-left">{item.label}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.sourceId}><td className="max-w-52 border p-3 align-top"><strong>{row.title}</strong><p className="mt-2">{row.year || "发表年份未取得"}</p><p>{row.evidenceScope === "fulltext" ? "全文" : row.evidenceScope === "abstract" ? "仅摘要" : row.evidenceScope === "metadata" ? "仅元数据" : "上传文本"}</p>{row.doi && <p className="mt-1 break-all">DOI：{row.doi}</p>}</td>{SOURCE_MATRIX_FACETS.map(item => { const evidence = row.facets.find(facet => facet.key === item.key); return <td key={item.key} className="max-w-64 border p-3 align-top">{evidence ? evidenceButton(row, evidence) : <span>未识别到可定位的{item.label}线索，请核验原文。</span>}</td>; })}</tr>)}</tbody></table></div>}
    {data && tab === "timeline" && <section className="space-y-4 text-sm" data-testid="research-evolution-timeline"><p>仅按已取得的真实发表年份排序。同年文献不推断先后；时间顺序不等于因果或已验证的学术演进关系。对比各年的方法与结果原文，判断演化方向。</p>{data.timeline.map(event => <article key={event.year} className="border-l-2 border-blue-400 pl-4"><h3 className="font-semibold">{event.year}</h3>{event.sourceIds.map(id => { const row = data.rows.find(item => item.sourceId === id)!; return <div key={id} className="mt-2 space-y-2 rounded-lg border p-3"><h4>{row.title}</h4>{row.facets.filter(item => item.key === "method" || item.key === "result").map(item => evidenceButton(row, item))}{!row.facets.some(item => item.key === "method" || item.key === "result") && <p>尚未识别到方法或结果线索。</p>}</div>; })}</article>)}{data.undatedSourceIds.length > 0 && <article className="rounded-lg border p-3"><h3 className="font-semibold">发表年份未取得（不使用上传时间替代）</h3>{data.undatedSourceIds.map(id => <p key={id} className="mt-2">{data.rows.find(row => row.sourceId === id)?.title}</p>)}</article>}</section>}
    {focus && <section className="rounded-lg border p-3 text-sm" data-testid="comparison-source-evidence"><h3 className="font-semibold">{focus.row.title} · {focus.evidence.page ? `第 ${focus.evidence.page} 页 · ` : ""}片段 {focus.evidence.chunkIndex + 1}</h3><p className="mb-2 text-xs">来源 ID：{focus.evidence.sourceId} · 片段 ID：{focus.evidence.chunkId}</p><div className="max-h-72 overflow-auto whitespace-pre-wrap"><HighlightedEvidence text={focus.text} quote={focus.evidence.quote} /></div></section>}
  </DialogContent></Dialog>;
}
