"use client";
import { useState } from "react";
import { clientApiRequest } from "@/lib/client-api";
import { accountAuthHeaders } from "@/lib/account-session-browser";
import type { ResearchDocument } from "@/lib/research-collaboration-store";
import {
  useCollaborativeDocument,
  type Reply,
} from "@/hooks/useCollaborativeDocument";
export function CollaborativeDocumentEditor({
  document,
  onText,
  onSync,
}: {
  document: ResearchDocument;
  onText: (text: string) => void;
  onSync: (data: Reply) => void;
}) {
  const {
    text,
    role,
    status,
    setStatus,
    ready,
    peers,
    comments,
    textarea,
    change,
    saveSnapshot,
    syncNow,
    compositionStart,
    compositionEnd,
  } = useCollaborativeDocument(document, onText, onSync);
  const [comment, setComment] = useState(""),
    [quote, setQuote] = useState("");
  async function commentAction(body: unknown) {
    try {
      await saveSnapshot();
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
      await syncNow();
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
            compositionStart();
          }}
          onCompositionEnd={() => {
            compositionEnd();
            void syncNow();
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
          onClick={() => void saveSnapshot()}
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
