"use client";
import { useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { notebookIdFromStorageScopeKey } from "@/lib/notebook-scope";
import { clientApiFetch } from "@/lib/client-api";
import type { ArtifactInput } from "@/lib/research-workspace-contract";
export function SaveResearchArtifact({ artifact }: { artifact: ArtifactInput }) {
  const { storageScopeKey } = useApp();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      await clientApiFetch("/api/research/workspace", { method: "POST", body: JSON.stringify({ action: "artifact", notebookId: notebookIdFromStorageScopeKey(storageScopeKey), artifact }) });
      setMessage("已保存到此文献本的研究记录。");
      window.dispatchEvent(new Event("lingbi:research-artifact-saved"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-1 text-xs">
    <button type="button" className="liquid-glass-btn px-3 py-2" disabled={busy} onClick={() => void save()}>{busy ? "正在保存研究记录…" : "保存到研究记录"}</button>
    {message && <p role="status" className="text-[var(--text-secondary)]">{message}</p>}
  </div>;
}
