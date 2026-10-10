"use client";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { accountAuthHeaders } from "@/lib/account-session-browser";
import { clientApiFetch, ClientRequestError } from "@/lib/client-api";
import { encodeCrdtBytes, decodeCrdtBytes } from "@/lib/crdt-browser-bytes";
import { replaceSharedText } from "@/lib/crdt-text";
import type { ResearchDocument } from "@/lib/research-collaboration-store";
import type { CollaborationPresence } from "@/lib/collaboration-presence";
export type Reply = {
  update: string;
  vector: string;
  role: "owner" | "editor" | "viewer";
  revision: number;
  content: string;
  title: string;
  comments: NonNullable<ResearchDocument["comments"]>;
  history?: ResearchDocument["history"];
  peers: CollaborationPresence[];
};
export function useCollaborativeDocument(
  document: ResearchDocument,
  onText: (text: string) => void,
  onSync: (data: Reply) => void,
  draftScope: string,
  onAccessLost?: () => void,
) {
  const [text, setText] = useState(document.content),
    [role, setRole] = useState<Reply["role"]>("viewer"),
    [status, setStatus] = useState("正在连接协作服务…"),
    [ready, setReady] = useState(false),
    [peers, setPeers] = useState<CollaborationPresence[]>([]),
    [comments, setComments] = useState<Reply["comments"]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null),
    crdt = useRef<Y.Doc | null>(null),
    sync = useRef<(checkpoint?: boolean) => Promise<void>>(async () => {}),
    composing = useRef(false),
    callbacks = useRef({ onText, onSync, onAccessLost });
  useEffect(() => {
    callbacks.current = { onText, onSync, onAccessLost };
  }, [onText, onSync, onAccessLost]);
  useEffect(() => {
    const doc = new Y.Doc(),
      shared = doc.getText("content"),
      clientId = crypto.randomUUID();
    crdt.current = doc;
    let stopped = false,
      working = false,
      historyRevision = 0,
      initialized = false,
      changed = false,
      vector = "",
      currentRole: Reply["role"] = "viewer",
      blocked = false;
    let active: Promise<void> | null = null;
    const abort = new AbortController();
    const backupKey =
      "knowtrail:collaboration-draft:" + draftScope + ":" + document.id;
    const observe = () => {
      if (!stopped) {
        const value = shared.toString();
        setText(value);
        callbacks.current.onText(value);
      }
    };
    shared.observe(observe);
    const update = (_bytes: Uint8Array, origin: unknown) => {
      if (origin === "local") {
        changed = true;
        try {
          sessionStorage.setItem(backupKey, shared.toString());
        } catch {}
        setStatus("本地修改等待同步…");
      }
    };
    doc.on("update", update);
    const run = async (checkpoint = false) => {
      if (stopped || composing.current || blocked) return;
      if (working) return;
      working = true;
      const send =
        initialized && currentRole !== "viewer" && (changed || checkpoint);
      changed = false;
      const state = {
        id: document.id,
        vector: encodeCrdtBytes(Y.encodeStateVector(doc)),
        clientId,
        cursor: textarea.current?.selectionStart || 0,
        historyRevision,
      };
      try {
        const data = await clientApiFetch<Reply>(
          "/api/research/collaboration" +
            (send
              ? ""
              : "?" +
                new URLSearchParams({
                  id: state.id,
                  vector: state.vector,
                  clientId,
                  cursor: String(state.cursor),
                  historyRevision: String(historyRevision),
                })),
          {
            ...(send
              ? {
                  method: "POST",
                  body: JSON.stringify({
                    ...state,
                    update: encodeCrdtBytes(
                      Y.encodeStateAsUpdate(doc, decodeCrdtBytes(vector)),
                    ),
                    checkpoint,
                  }),
                }
              : {}),
            headers: {
              ...accountAuthHeaders(),
              "Content-Type": "application/json",
            },
            signal: abort.signal,
            timeoutMs: 15000,
          },
        );
        if (stopped) return;
        if (composing.current) {
          changed = changed || send;
          return;
        }
        const focused = globalThis.document.activeElement === textarea.current;
        const selection =
          focused && initialized
            ? Y.createRelativePositionFromTypeIndex(
                shared,
                textarea.current?.selectionStart || 0,
              )
            : null;
        Y.applyUpdate(doc, decodeCrdtBytes(data.update), "remote");
        vector = data.vector;
        initialized = true;
        currentRole = data.role;
        if (currentRole === "viewer") {
          setText(data.content);
          callbacks.current.onText(data.content);
        } else changed = changed || shared.toString() !== data.content;
        if (!changed && shared.toString() === data.content)
          try {
            sessionStorage.removeItem(backupKey);
          } catch {}
        setReady(true);
        setRole(data.role);
        setPeers(data.peers);
        setComments(data.comments);
        callbacks.current.onSync(data);
        if (data.history) historyRevision = data.history.at(-1)?.revision || 0;
        setStatus(
          changed
            ? "新修改等待下一次同步…"
            : checkpoint
              ? "已保存版本快照"
              : "已同步 · 每 2 秒合并更新",
        );
        if (selection) {
          const position = Y.createAbsolutePositionFromRelativePosition(
            selection,
            doc,
          );
          if (position)
            requestAnimationFrame(() => {
              if (globalThis.document.activeElement === textarea.current)
                textarea.current?.setSelectionRange(
                  position.index,
                  position.index,
                );
            });
        }
      } catch (caught) {
        changed = changed || send;
        if (!stopped) {
          setStatus(
            "同步失败，本地修改仍保留。" +
              (caught instanceof Error ? caught.message : ""),
          );
          if (
            caught instanceof ClientRequestError &&
            [401, 403, 404].includes(caught.status || 0)
          ) {
            blocked = caught.status !== 403;
            currentRole = "viewer";
            setRole("viewer");
            callbacks.current.onAccessLost?.();
          }
        }
      } finally {
        working = false;
      }
    };
    const dispatch = (checkpoint = false): Promise<void> => {
      if (active)
        return active.then(() => (checkpoint ? dispatch(true) : undefined));
      active = run(checkpoint).finally(() => {
        active = null;
      });
      return active;
    };
    sync.current = dispatch;
    void dispatch();
    const timer = setInterval(() => void dispatch(), 2000);
    return () => {
      stopped = true;
      abort.abort();
      clearInterval(timer);
      shared.unobserve(observe);
      doc.off("update", update);
      doc.destroy();
      crdt.current = null;
    };
  }, [document.id, draftScope]);
  function change(next: string) {
    const doc = crdt.current;
    if (!doc || role === "viewer") return;
    replaceSharedText(doc, next, "local");
  }
  return {
    text,
    role,
    status,
    setStatus,
    ready,
    peers,
    comments,
    textarea,
    change,
    localBackup: () => {
      try {
        return sessionStorage.getItem(
          "knowtrail:collaboration-draft:" + draftScope + ":" + document.id,
        );
      } catch {
        return null;
      }
    },
    saveSnapshot: () => sync.current(true),
    syncNow: () => sync.current(),
    compositionStart: () => {
      composing.current = true;
    },
    compositionEnd: () => {
      composing.current = false;
      void sync.current();
    },
  };
}
