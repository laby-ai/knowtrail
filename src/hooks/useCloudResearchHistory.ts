"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clientApiFetch } from "@/lib/client-api";
import { readStoredAccountSession } from "@/lib/account-session-browser";
import { notebookIdFromStorageScopeKey } from "@/lib/notebook-scope";
import { chatPayload, type WorkspaceReply, type StoredChat } from "@/lib/research-workspace-contract";
import type { ChatMessage } from "@/types";
import { mergeCloudHistory } from "@/lib/cloud-history-merge";
interface Baseline { message: StoredChat; digest: string }
type Hydrate = (update: (current: ChatMessage[]) => ChatMessage[]) => void;
export function useCloudResearchHistory(scope: string, messages: ChatMessage[], loaded: boolean, hydrate: Hydrate) {
  const [status, setStatus] = useState("正在读取账号记录…");
  const [ready, setReady] = useState(false);
  const latest = useRef(messages), callbacks = useRef(hydrate), base = useRef(new Map<string, Baseline>());
  const blocked = useRef(false);
  const tasks = useRef<{ reload: () => Promise<void>; clear: () => Promise<void>; sync: () => Promise<void> } | null>(null);
  useEffect(() => { latest.current = messages; callbacks.current = hydrate; }, [messages, hydrate]);
  useEffect(() => {
    if (!loaded) return;
    const session = readStoredAccountSession();
    const notebookId = notebookIdFromStorageScopeKey(scope);
    if (!session || !scope.startsWith(session.member.id + ":") || !notebookId) {
      setStatus("尚未登录，记录仅保存在本机。"); return;
    }
    let stopped = false;
    let working = false;
    const controller = new AbortController();
    const key = "lingbi:cloud-chat-baseline:" + encodeURIComponent(session.tenant_id + ":" + scope);
    base.current = new Map(); blocked.current = false; setReady(false);
    try {
      const cache: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(cache)) for (const value of cache) {
        if (!value || typeof value !== "object" || typeof value.digest !== "string") continue;
        const message = chatPayload(value.message); base.current.set(message.id, { message, digest: value.digest });
      }
    } catch { /* An unavailable local baseline does not grant write access. */ }
    const api = (body?: unknown) => clientApiFetch<WorkspaceReply>(
      "/api/research/workspace" + (body ? "" : "?notebookId=" + encodeURIComponent(notebookId)),
      { ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), signal: controller.signal, timeoutMs: 20000 },
    );
    const remember = () => { try { localStorage.setItem(key, JSON.stringify([...base.current.values()])); } catch {} };
    const apply = (data: WorkspaceReply, sent?: Map<string, StoredChat>, force = false) => {
      if (stopped) return;
      const baseline = new Map([...base.current].map(([id, value]) => [id, value.message]));
      const localMap = new Map(latest.current.map((message) => [message.id, chatPayload(message)]));
        for (const message of data.messages) {
          const previous = base.current.get(message.id);
          const local = localMap.get(message.id);
          if (!force && !sent?.has(message.id) && local && JSON.stringify(local) !== JSON.stringify(previous?.message || message)) continue;
          base.current.set(message.id, { message, digest: data.digests[message.id] });
        }
        if (force || data.clearedAt) for (const id of base.current.keys()) if (!data.digests[id]) base.current.delete(id);
        remember();
      callbacks.current((current) => mergeCloudHistory(current, data, baseline, sent, force));
    };
    const reload = async (force = false) => {
      if (working || stopped) return;
      working = true;
      try {
        const data = await api(); apply(data, undefined, force);
        blocked.current = false; setReady(true); setStatus("云端记录已读取。");
      } catch (error) { if (!stopped) setStatus(error instanceof Error ? error.message : "云端读取失败，本地记录仍保留。"); }
      finally { working = false; }
    };
    const sync = async () => {
      if (working || blocked.current || stopped) return;
      working = true;
      try {
        const changes = latest.current.filter((message) => message.generation?.status !== "pending").map(chatPayload)
          .filter((message) => JSON.stringify(message) !== JSON.stringify(base.current.get(message.id)?.message))
          .slice(0, 100).map((message) => ({ message, expectedDigest: base.current.get(message.id)?.digest || null }));
        if (!changes.length) return;
        setStatus("正在同步账号记录…");
        const data = await api({ action: "merge", notebookId, changes });
        apply(data, new Map(changes.map((change) => [change.message.id, change.message])));
        if (!stopped) setStatus("记录已同步到账号云端。");
      } catch (error) {
        if (!stopped) { blocked.current = true; setStatus((error instanceof Error ? error.message : "云端同步失败。") + " 本地内容仍保留，可导出后读取云端版本。"); }
      } finally { working = false; }
    };
    tasks.current = {
      reload: () => reload(true), sync,
      clear: async () => {
        if (working || stopped) throw new Error("正在同步，请稍后清除。");
        working = true; setStatus("正在清除账号对话记录…");
        try {
          const current = await api();
          const data = await api({ action: "clear", notebookId, revision: current.revision });
          base.current.clear(); apply(data, undefined, true); blocked.current = false;
          if (!stopped) setStatus("账号对话记录已清除，研究成果仍保留。");
        } catch (error) { if (!stopped) setStatus(error instanceof Error ? error.message : "云端清除失败，原记录仍保留。"); throw error; }
        finally { working = false; }
      },
    };
    void reload();
    const online = () => { if (!blocked.current) void reload(); };
    window.addEventListener("online", online); window.addEventListener("focus", online);
    return () => { stopped = true; controller.abort(); tasks.current = null; window.removeEventListener("online", online); window.removeEventListener("focus", online); };
  }, [scope, loaded]);
  useEffect(() => {
    if (!ready || blocked.current) return;
    const timer = setTimeout(() => void tasks.current?.sync(), 1200);
    return () => clearTimeout(timer);
  }, [messages, ready]);
  const reload = useCallback(() => tasks.current?.reload(), []);
  const clear = useCallback(async () => {
    if (!tasks.current) { callbacks.current(() => []); return; }
    await tasks.current.clear();
  }, []);
  return { status, reload, clear };
}
