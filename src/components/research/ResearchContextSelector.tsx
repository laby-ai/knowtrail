"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { notebookIdFromStorageScopeKey } from "@/lib/notebook-scope";
import { clientApiFetch } from "@/lib/client-api";
import type { ResearchArtifact } from "@/lib/research-workspace-contract";
export function ResearchContextSelector({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const { storageScopeKey } = useApp();
  const [items, setItems] = useState<ResearchArtifact[]>([]), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const chosen = sessionStorage.getItem("lingbi:writing-context:" + storageScopeKey);
    if (chosen) onChange([chosen]);
    void clientApiFetch<{ artifacts: ResearchArtifact[] }>(`/api/research/workspace?notebookId=${encodeURIComponent(notebookIdFromStorageScopeKey(storageScopeKey) || "")}&view=artifacts`, { signal: controller.signal })
      .then((data) => { setItems(data.artifacts); setError(""); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "研究记录读取失败。"); });
    return () => controller.abort();
  }, [storageScopeKey, onChange]);
  return <details className="rounded-lg border p-3 text-xs">
    <summary className="cursor-pointer font-semibold">关联实验数据与研究记录（已选 {value.length} 项）</summary>
    <p className="mt-2 text-[var(--text-secondary)]">最多选择 5 项记录。服务端重新核对账号与文献本，统计记录使用已执行的真实结果；用户记录不冒充论文证据。</p>
    {error && <p role="alert" className="mt-2 text-rose-600">{error}</p>}
    {!items.length && !error && <p className="mt-2">暂无研究记录。可从数据分析结果区保存 Results，或打开顶部“研究记录”保存实验日志。</p>}
    <fieldset disabled={disabled} className="mt-2 space-y-2">{items.slice().reverse().map((item) => <label key={item.id} className="flex items-start gap-2"><input type="checkbox" checked={value.includes(item.id)} disabled={!value.includes(item.id) && value.length >= 5} onChange={(event) => onChange(event.target.checked ? [...value, item.id] : value.filter((id) => id !== item.id))} /><span>{item.title}{item.analysis ? " · 已执行统计结果" : " · 用户研究记录"}</span></label>)}</fieldset>
  </details>;
}
