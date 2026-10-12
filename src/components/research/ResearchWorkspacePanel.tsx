"use client";
import { useState, useEffect, useCallback } from "react";
import { ClipboardList } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { notebookIdFromStorageScopeKey } from "@/lib/notebook-scope";
import { clientApiFetch } from "@/lib/client-api";
import { RESEARCH_STAGES, STAGE_LABELS, type ResearchArtifact, type ArtifactInput } from "@/lib/research-workspace-contract";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { JournalDiscovery } from "./JournalDiscovery";
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ResearchWorkspacePanel() {
  const { storageScopeKey, chatMessages, getSelectedPapers, cloudHistoryStatus, reloadCloudHistory, clearChat } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const [open, setOpen] = useState(false), [items, setItems] = useState<ResearchArtifact[]>([]);
  const [stage, setStage] = useState<ArtifactInput["stage"]>("literature"), [title, setTitle] = useState(""), [content, setContent] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const data = await clientApiFetch<{ artifacts: ResearchArtifact[] }>(`/api/research/workspace?notebookId=${encodeURIComponent(notebookId || "")}&view=artifacts`); setItems(data.artifacts); setError(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "研究记录读取失败。"); }
  }, [notebookId]);
  useEffect(() => {
    if (!open) return;
    void load(); const saved = () => void load(); window.addEventListener("lingbi:research-artifact-saved", saved);
    return () => window.removeEventListener("lingbi:research-artifact-saved", saved);
  }, [open, load]);
  async function save() {
    setBusy(true); setError("");
    try {
      await clientApiFetch("/api/research/workspace", { method: "POST", body: JSON.stringify({ action: "artifact", notebookId, artifact: { stage, title: title.trim(), content, sourceIds: getSelectedPapers().map((paper) => paper.id) } }) });
      setTitle(""); setContent(""); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "研究记录保存失败。"); }
    finally { setBusy(false); }
  }
  const feature = { literature: "paper-search", design: "experiment-design", analysis: "data-processing", writing: "academic-writing", journal: "academic-writing" } as const;
  return <>
    <button type="button" className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-2 text-xs" aria-label="研究记录与科研流程" onClick={() => setOpen(true)}><ClipboardList className="h-4 w-4" /><span className="hidden sm:inline">研究记录</span></button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl" data-testid="research-workspace-panel">
        <DialogTitle>研究记录与科研流程</DialogTitle>
        <DialogDescription>按当前账号和文献本长期保存对话、实验记录、研究灵感与阶段成果。保存成果不代表科研阶段已通过核验；私人记录不自动向团队共享。</DialogDescription>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{RESEARCH_STAGES.map((key) => <button type="button" key={key} className="liquid-glass-btn p-3 text-left text-xs" onClick={() => setStage(key)} aria-pressed={key === stage}><strong className="block">{STAGE_LABELS[key]}</strong><span className="mt-1 block">已保存 {items.filter((item) => item.stage === key).length} 项成果</span></button>)}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {stage !== "journal" && <button className="liquid-glass-btn px-3 py-2" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("lingbi:open-studio-tool", { detail: feature[stage] })); }}>打开{STAGE_LABELS[stage]}工具</button>}
          <button className="liquid-glass-btn px-3 py-2" onClick={() => { setStage("literature"); setTitle("学术对话记录"); setContent(chatMessages.map((message) => `${message.role === "user" ? "研究问题" : "回答"}\n${message.content}`).join("\n\n")); }}>将当前对话整理为研究日志</button>
        </div>
        {stage === "journal" && <JournalDiscovery initialQuery={title} defaultOpen />}
        <fieldset disabled={busy} className="space-y-2">
          <label className="block text-xs">记录标题<input className="liquid-glass-input mt-1 w-full" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="block text-xs">实验记录、研究灵感或阶段成果<textarea className="liquid-glass-input mt-1 min-h-40 w-full" maxLength={100000} value={content} onChange={(event) => setContent(event.target.value)} /></label>
          <p className="text-xs text-[var(--text-secondary)]">保存时关联当前已选来源。用户记录与生成稿仍需核验；统计结果请从数据分析结果区保存，以保留真实执行记录。</p>
          <button className="liquid-glass-btn px-3 py-2 text-xs" disabled={!title.trim() || !content.trim()} onClick={() => void save()}>{busy ? "正在保存…" : `保存${STAGE_LABELS[stage]}记录`}</button>
        </fieldset>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        <div className="space-y-2">{items.filter((item) => item.stage === stage).slice().reverse().map((item) => <details key={item.id} className="rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer font-semibold">{item.title}</summary>
          <p className="mt-2 text-[var(--text-secondary)]">保存时间 {item.createdAt} · {item.sourceIds.length} 个关联来源</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-sans">{item.content}</pre>
          {item.analysis && <p className="mt-2 break-all">真实统计结果 {item.analysis.id} · 方法 {item.analysis.method} · 原文件 SHA-256 {item.analysis.sourceFileSha256}</p>}
          <button className="liquid-glass-btn mt-2 px-3 py-2" onClick={() => {
            sessionStorage.setItem("lingbi:writing-context:" + storageScopeKey, item.id); setOpen(false); window.dispatchEvent(new CustomEvent("lingbi:open-studio-tool", { detail: "academic-writing" }));
          }}>作为学术写作的研究记录</button>
        </details>)}</div>
        <section className="space-y-2 rounded-lg border p-3 text-xs">
          <h3 className="font-semibold">账号对话与归档</h3><p role="status">{cloudHistoryStatus}</p>
          <div className="flex flex-wrap gap-2">
            <button className="liquid-glass-btn px-3 py-2" onClick={() => download(chatMessages, "lingbi-local-chat.json")}>导出本地对话副本</button>
            <button className="liquid-glass-btn px-3 py-2" onClick={() => {
              if (window.confirm("读取云端会替换当前显示的本地对话，请先导出未同步内容。继续读取？")) void reloadCloudHistory();
            }}>读取云端对话</button>
            <button className="liquid-glass-btn px-3 py-2" disabled={chatMessages.some((message) => message.generation?.status === "pending")} onClick={() => { if (window.confirm("清除当前文献本的账号对话记录？研究成果与原文献仍保留。")) clearChat(); }}>清除账号对话</button>
            <button className="liquid-glass-btn px-3 py-2" onClick={() => void clientApiFetch(`/api/research/workspace?notebookId=${encodeURIComponent(notebookId || "")}`).then((data) => download(data, "lingbi-research-records.json")).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "归档下载失败。"))}>导出全部研究记录</button>
          </div>
          <p className="text-[var(--text-secondary)]">每个文献本最多保存 500 条对话和 200 项成果，合计 8 MB；达到上限时提示归档，不静默删除旧记录。生成中的回答暂存本机，完成或停止后同步。</p>
        </section>
      </DialogContent>
    </Dialog>
  </>;
}
