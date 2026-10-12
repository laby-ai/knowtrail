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
      <DialogContent style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="grid max-h-[90dvh] gap-6 overflow-y-auto p-5 sm:max-w-5xl sm:p-8" data-testid="research-workspace-panel">
        <div className="space-y-3 pr-6"><DialogTitle className="text-xl">研究记录与科研流程</DialogTitle>
        <DialogDescription className="max-w-3xl text-sm leading-7">按当前账号和文献本长期保存对话、实验记录、研究灵感与阶段成果。保存成果不代表科研阶段已通过核验；私人记录不自动向团队共享。</DialogDescription></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{RESEARCH_STAGES.map((key) => <button type="button" key={key} style={{ flexDirection: "column", alignItems: "flex-start" }} className="liquid-glass-btn min-h-20 px-4 py-3 text-left text-sm leading-6 aria-pressed:border-blue-500/50 aria-pressed:bg-blue-500/10" onClick={() => setStage(key)} aria-pressed={key === stage}><strong className="block">{STAGE_LABELS[key]}</strong><span className="mt-1 block text-xs text-[var(--text-secondary)]">已保存 {items.filter((item) => item.stage === key).length} 项成果</span></button>)}</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {stage !== "journal" && <button className="liquid-glass-btn min-h-11 px-4 py-2.5" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("lingbi:open-studio-tool", { detail: feature[stage] })); }}>打开{STAGE_LABELS[stage]}工具</button>}
          <button className="liquid-glass-btn min-h-11 px-4 py-2.5" onClick={() => { setStage("literature"); setTitle("学术对话记录"); setContent(chatMessages.map((message) => `${message.role === "user" ? "研究问题" : "回答"}\n${message.content}`).join("\n\n")); }}>将当前对话整理为研究日志</button>
        </div>
        {stage === "journal" && <JournalDiscovery initialQuery={title} defaultOpen />}
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
        <fieldset disabled={busy} className="min-w-0 space-y-5 rounded-2xl border border-[var(--border-subtle)] p-4 sm:p-5">
          <h3 className="text-base font-semibold">新建{STAGE_LABELS[stage]}记录</h3>
          <label className="block space-y-2 text-sm font-medium leading-6">记录标题<input className="liquid-glass-input mt-2 block min-h-11 w-full px-3 py-2.5 text-sm" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="block space-y-2 text-sm font-medium leading-6">实验记录、研究灵感或阶段成果<textarea className="liquid-glass-input mt-2 block min-h-56 w-full resize-y px-3 py-3 text-sm font-normal leading-7" maxLength={100000} value={content} onChange={(event) => setContent(event.target.value)} /></label>
          <p className="text-sm font-normal leading-6 text-[var(--text-secondary)]">保存时关联当前已选来源。用户记录与生成稿仍需核验；统计结果请从数据分析结果区保存，以保留真实执行记录。</p>
          <button className="liquid-glass-btn min-h-11 px-4 py-2.5 text-sm" disabled={!title.trim() || !content.trim()} onClick={() => void save()}>{busy ? "正在保存…" : `保存${STAGE_LABELS[stage]}记录`}</button>
        </fieldset>
        <section className="min-w-0 space-y-3" aria-label="已保存的研究记录">
          <h3 className="text-base font-semibold">已保存的记录</h3>
          {!items.some((item) => item.stage === stage) && <p className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-5 py-8 text-sm leading-7 text-[var(--text-secondary)]">当前阶段还没有记录。填写标题和内容后保存，记录会显示在这里。</p>}
          {items.filter((item) => item.stage === stage).slice().reverse().map((item) => <details key={item.id} className="min-w-0 rounded-2xl border border-[var(--border-subtle)] p-4 text-sm leading-7">
          <summary className="cursor-pointer break-words pr-2 font-semibold leading-7">{item.title}</summary>
          <p className="mt-2 text-[var(--text-secondary)]">保存时间 <time dateTime={item.createdAt} className="break-all">{item.createdAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time><span className="block">{item.sourceIds.length} 个关联来源</span></p>
          <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--bg-secondary)] p-4 font-sans text-sm leading-7 [overflow-wrap:anywhere]">{item.content}</pre>
          {item.analysis && <dl className="mt-4 space-y-3 rounded-xl border border-[var(--border-subtle)] p-3 text-xs leading-6"><div><dt className="text-[var(--text-secondary)]">真实统计结果</dt><dd className="break-all">{item.analysis.id}</dd></div><div><dt className="text-[var(--text-secondary)]">分析方法</dt><dd className="break-words">{item.analysis.method}</dd></div><div><dt className="text-[var(--text-secondary)]">原文件 SHA-256</dt><dd className="break-all font-mono">{item.analysis.sourceFileSha256}</dd></div></dl>}
          <button className="liquid-glass-btn mt-4 min-h-11 px-4 py-2.5 text-sm" onClick={() => {
            sessionStorage.setItem("lingbi:writing-context:" + storageScopeKey, item.id); setOpen(false); window.dispatchEvent(new CustomEvent("lingbi:open-studio-tool", { detail: "academic-writing" }));
          }}>作为学术写作的研究记录</button>
        </details>)}
        </section>
        </div>
        {error && <p role="alert" className="text-sm leading-6 text-rose-600">{error}</p>}
        <section className="space-y-4 min-w-0 rounded-2xl border border-[var(--border-subtle)] p-4 text-sm leading-7">
          <h3 className="text-base font-semibold">账号对话与归档</h3><p role="status">{cloudHistoryStatus}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button className="liquid-glass-btn min-h-11 px-4 py-2.5" onClick={() => download(chatMessages, "lingbi-local-chat.json")}>导出本地对话副本</button>
            <button className="liquid-glass-btn min-h-11 px-4 py-2.5" onClick={() => {
              if (window.confirm("读取云端会替换当前显示的本地对话，请先导出未同步内容。继续读取？")) void reloadCloudHistory();
            }}>读取云端对话</button>
            <button className="liquid-glass-btn min-h-11 px-4 py-2.5" disabled={chatMessages.some((message) => message.generation?.status === "pending")} onClick={() => { if (window.confirm("清除当前文献本的账号对话记录？研究成果与原文献仍保留。")) clearChat(); }}>清除账号对话</button>
            <button className="liquid-glass-btn min-h-11 px-4 py-2.5" onClick={() => void clientApiFetch(`/api/research/workspace?notebookId=${encodeURIComponent(notebookId || "")}`).then((data) => download(data, "lingbi-research-records.json")).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "归档下载失败。"))}>导出全部研究记录</button>
          </div>
          <p className="text-[var(--text-secondary)]">每个文献本最多保存 500 条对话和 200 项成果，合计 8 MB；达到上限时提示归档，不静默删除旧记录。生成中的回答暂存本机，完成或停止后同步。</p>
        </section>
      </DialogContent>
    </Dialog>
  </>;
}
