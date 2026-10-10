"use client";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { accountAuthHeaders } from "@/lib/account-session-browser";
import { clientApiRequest, ClientRequestError } from "@/lib/client-api";
import { encodeCrdtBytes, decodeCrdtBytes } from "@/lib/crdt-browser-bytes";
import { replaceSharedText } from "@/lib/crdt-text";
import type { ResearchDocument } from "@/lib/research-collaboration-store";
import type { CollaborationPresence } from "@/lib/collaboration-presence";
type Reply = {
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
export function CollaborativeDocumentEditor({
  document,
  onText,
  onSync,
}: {
  document: ResearchDocument;
  onText: (text: string) => void;
  onSync: (data: Reply) => void;
}) {
  const [text, setText] = useState(document.content),
    [role, setRole] = useState<Reply["role"]>("viewer"),
    [status, setStatus] = useState("正在连接协作服务…"),
    [ready, setReady] = useState(false),
    [peers, setPeers] = useState<CollaborationPresence[]>([]),
    [comments, setComments] = useState<Reply["comments"]>([]);
  const [comment, setComment] = useState(""),
    [quote, setQuote] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null),
    crdt = useRef<Y.Doc | null>(null),
    sync = useRef<(checkpoint?: boolean) => Promise<void>>(async () => {}),
    composing = useRef(false),
    callbacks = useRef({ onText, onSync });
  useEffect(() => {
    callbacks.current = { onText, onSync };
  }, [onText, onSync]);
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
        const response = await clientApiRequest(
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
        const data = (await response.json()) as Reply;
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
            blocked = true;
            setRole("viewer");
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
  }, [document.id]);
  function change(next: string) {
    const doc = crdt.current;
    if (!doc || role === "viewer") return;
    replaceSharedText(doc, next, "local");
  }
  async function commentAction(body: unknown) {
    try {
      await sync.current(true);
      await clientApiRequest("/api/research/documents", {
        method: "POST",
        headers: {
          ...accountAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      setComment("");
      setQuote("");
      await sync.current();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "评论保存失败");
    }
  }
  function recover() {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = "collaboration-local-draft.txt";
    globalThis.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="space-y-2" data-testid="collaborative-editor">
      <label className="block text-xs">
        研究正文 / 实验日志
        <textarea
          ref={textarea}
          aria-label="协同研究正文"
          className="liquid-glass-input mt-1 min-h-64 w-full"
          value={text}
          disabled={!ready || role === "viewer"}
          maxLength={100000}
          onChange={(event) => change(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            void sync.current();
          }}
          onSelect={() => {
            const field = textarea.current;
            if (field && field.selectionStart !== field.selectionEnd)
              setQuote(
                text
                  .slice(field.selectionStart, field.selectionEnd)
                  .slice(0, 500),
              );
          }}
        />
      </label>
      <p className="text-xs text-[var(--text-tertiary)]" role="status">
        {status}
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          disabled={!ready || role === "viewer"}
          onClick={() => void sync.current(true)}
          className="liquid-glass-btn px-3 py-2"
        >
          保存版本快照
        </button>
        <button
          type="button"
          onClick={recover}
          className="liquid-glass-btn px-3 py-2"
        >
          导出本地备份
        </button>
      </div>
      <p className="text-xs" data-testid="collaboration-presence">
        在线：
        {peers
          .map(
            (peer) =>
              `${peer.name}（${peer.role === "viewer" ? "查看" : "编辑"}，光标 ${peer.cursor}）`,
          )
          .join(" · ") || "正在确认在线状态"}
      </p>
      <section className="space-y-2 rounded border p-3 text-xs">
        <h4 className="font-semibold">批注与讨论</h4>
        {quote && (
          <blockquote className="rounded bg-[var(--bg-secondary)] p-2">
            选中原文：{quote}
            <button
              type="button"
              className="ml-2 text-[var(--accent-blue)]"
              onClick={() => setQuote("")}
            >
              清除锚点
            </button>
          </blockquote>
        )}
        <textarea
          aria-label="协作评论"
          className="liquid-glass-input w-full"
          value={comment}
          maxLength={2000}
          disabled={!ready || role === "viewer"}
          onChange={(event) => setComment(event.target.value)}
          placeholder="评论或修订意见；可先选中正文作为锚点"
        />
        <button
          type="button"
          disabled={!comment.trim() || role === "viewer"}
          onClick={() =>
            void commentAction({
              action: "comment",
              id: document.id,
              text: comment,
              quote,
            })
          }
          className="liquid-glass-btn px-3 py-2"
        >
          提交评论
        </button>
        <div className="max-h-56 space-y-2 overflow-auto">
          {comments.map((item) => (
            <article key={item.id} className="rounded border p-2">
              <p>
                {item.authorName} · {item.resolved ? "已解决" : "待处理"}
              </p>
              {item.quote && (
                <blockquote>
                  {item.quote}
                  {!text.includes(item.quote) && "（原文已改动）"}
                </blockquote>
              )}
              <p className="whitespace-pre-wrap">{item.text}</p>
              {role !== "viewer" && (
                <button
                  type="button"
                  onClick={() =>
                    void commentAction({
                      action: "resolve-comment",
                      id: document.id,
                      commentId: item.id,
                      resolved: !item.resolved,
                    })
                  }
                  className="mt-1 text-[var(--accent-blue)]"
                >
                  {item.resolved ? "重新打开" : "标记已解决"}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
