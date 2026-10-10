"use client";
import { useState } from "react";
import { Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { accountAuthHeaders } from "@/lib/account-session-browser";
import { clientApiRequest } from "@/lib/client-api";
import { useApp } from "@/contexts/AppContext";
import { notebookIdFromStorageScopeKey } from "@/lib/notebook-scope";
import type { ResearchDocument } from "@/lib/research-collaboration-store";
import { SharedSourcesPanel } from "./SharedSourcesPanel";
import { CollaborativeDocumentEditor } from "./CollaborativeDocumentEditor";
type Summary = Pick<
  ResearchDocument,
  "id" | "title" | "notebookId" | "revision"
>;
export function ResearchCollaboration({
  initialContent,
  initialTitle,
}: {
  initialContent?: string;
  initialTitle?: string;
}) {
  const { storageScopeKey } = useApp();
  const [open, setOpen] = useState(false),
    [documents, setDocuments] = useState<Summary[]>([]),
    [document, setDocument] = useState<ResearchDocument | null>(null);
  const [title, setTitle] = useState(initialTitle || ""),
    [content, setContent] = useState(initialContent || ""),
    [role, setRole] = useState("owner");
  const [memberEmail, setMemberEmail] = useState(""),
    [memberRole, setMemberRole] = useState<"viewer" | "editor">("viewer"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function api(path = "", body?: unknown) {
    const response = await clientApiRequest(`/api/research/documents${path}`, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: { ...accountAuthHeaders(), "Content-Type": "application/json" },
    });
    const data = (await response.json()) as {
      error?: string;
      documents?: Summary[];
      document?: ResearchDocument;
      role?: string;
    };
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "请求失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  const reloadList = async () => {
    const data = await api();
    setDocuments(data.documents || []);
  };
  function canReplaceDraft() {
    const dirty = document
      ? title !== document.title || content !== document.content
      : Boolean(title || content);
    return (
      !dirty ||
      window.confirm(
        "当前内容尚未保存。请先复制你的修改；继续将读取另一份文档。",
      )
    );
  }
  async function load(id: string) {
    const data = await api(`?id=${encodeURIComponent(id)}`);
    if (data.document) {
      setDocument(data.document);
      setTitle(data.document.title);
      setContent(data.document.content);
      setRole(data.role || "viewer");
    }
  }
  async function save() {
    const data = await api(
      "",
      document
        ? {
            action: "rename",
            id: document.id,
            revision: document.revision,
            title,
          }
        : {
            action: "create",
            notebookId:
              notebookIdFromStorageScopeKey(storageScopeKey) ||
              "default-workspace",
            title,
            content,
          },
    );
    if (data.document) {
      setDocument(data.document);
      setRole(data.role || "owner");
    }
    await reloadList();
  }
  async function members(next: ResearchDocument["members"]) {
    if (!document) return;
    const data = await api("", {
      action: "members",
      id: document.id,
      revision: document.revision,
      members: next,
    });
    if (data.document) setDocument(data.document);
  }
  return (
    <>
      <button
        type="button"
        className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-2 text-xs"
        onClick={() => {
          setOpen(true);
          void run(reloadList);
        }}
        data-testid="research-collaboration-open"
        aria-label={initialContent ? "保存并共享草稿" : "课题组共享"}
      >
        <Users className="h-4 w-4" />
        <span className={initialContent ? "" : "hidden sm:inline"}>
          {initialContent ? "保存并共享草稿" : "课题组共享"}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          style={{
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
          }}
          className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl"
          data-testid="research-collaboration-dialog"
        >
          <DialogTitle>课题组共享研究文档</DialogTitle>
          <DialogDescription>
            同一组织内按邮箱授予权限。正文每 2
            秒合并协作修改，支持在线状态、批注和版本恢复；原文件单独授权共享。自动每
            30 秒留存快照，可手动保存，保留最近 20 个版本。
          </DialogDescription>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-xs text-red-700"
            >
              {error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <aside className="space-y-2">
              <button
                type="button"
                disabled={busy}
                className="liquid-glass-btn w-full p-2 text-xs"
                onClick={() => {
                  if (!canReplaceDraft()) return;
                  setDocument(null);
                  setTitle(initialTitle || "");
                  setContent(initialContent || "");
                  setRole("owner");
                }}
              >
                新建研究文档
              </button>
              <button
                type="button"
                disabled={busy}
                className="liquid-glass-btn w-full p-2 text-xs"
                onClick={() => void run(reloadList)}
              >
                刷新文档列表
              </button>
              {documents.length === 0 && (
                <p className="text-xs text-[var(--text-tertiary)]">
                  暂无你创建或有权访问的研究文档。
                </p>
              )}
              {documents.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy}
                  className="liquid-glass-btn w-full break-words p-2 text-left text-xs"
                  onClick={() => {
                    if (canReplaceDraft()) void run(() => load(item.id));
                  }}
                >
                  {item.title}
                  <span className="mt-1 block text-[var(--text-tertiary)]">
                    版本 {item.revision}
                  </span>
                </button>
              ))}
            </aside>
            <div className="space-y-3">
              <label className="block text-xs">
                文档标题
                <input
                  className="liquid-glass-input mt-1 w-full"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={busy || role === "viewer"}
                  maxLength={160}
                />
              </label>
              {!document ? (
                <label className="block text-xs">
                  研究正文 / 实验日志
                  <textarea
                    className="liquid-glass-input mt-1 min-h-64 w-full"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    disabled={busy || role === "viewer"}
                    maxLength={100000}
                  />
                </label>
              ) : (
                <CollaborativeDocumentEditor
                  key={document.id}
                  document={document}
                  onText={setContent}
                  onSync={(data) => {
                    setTitle((current) =>
                      current === document.title ? data.title : current,
                    );
                    setDocument((current) =>
                      current?.id === document.id
                        ? {
                            ...current,
                            title: data.title,
                            content: data.content,
                            revision: data.revision,
                            comments: data.comments,
                            history: data.history || current.history,
                          }
                        : current,
                    );
                    setRole(data.role);
                  }}
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || role === "viewer" || !title.trim()}
                  onClick={() => void run(save)}
                  className="liquid-glass-btn px-3 py-2 text-xs"
                >
                  {busy ? "正在同步…" : document ? "保存标题" : "保存到服务器"}
                </button>
                {document && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "刷新会覆盖当前未保存的修改。请先复制你的修改以便合并。",
                        )
                      )
                        void run(() => load(document.id));
                    }}
                    className="liquid-glass-btn px-3 py-2 text-xs"
                  >
                    读取最新版本
                  </button>
                )}
              </div>
              {document && (
                <>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    当前权限：
                    {role === "owner"
                      ? "所有者"
                      : role === "editor"
                        ? "可编辑"
                        : "仅查看"}{" "}
                    · 版本 {document.revision}
                  </p>
                  {role === "owner" && (
                    <section className="space-y-2 rounded-lg border p-3 text-xs">
                      <h4 className="font-semibold">成员权限</h4>
                      <input
                        className="liquid-glass-input w-full"
                        aria-label="协作成员邮箱"
                        placeholder="同一组织成员的账号邮箱"
                        value={memberEmail}
                        onChange={(event) => setMemberEmail(event.target.value)}
                        type="email"
                      />
                      <select
                        className="liquid-glass-input w-full"
                        value={memberRole}
                        onChange={(event) =>
                          setMemberRole(
                            event.target.value as "viewer" | "editor",
                          )
                        }
                      >
                        <option value="viewer">仅查看</option>
                        <option value="editor">可编辑</option>
                      </select>
                      <button
                        disabled={busy || !memberEmail.includes("@")}
                        type="button"
                        className="liquid-glass-btn px-3 py-2"
                        onClick={() =>
                          void run(async () => {
                            await members([
                              ...document.members.filter(
                                (item) =>
                                  item.email !==
                                  memberEmail.trim().toLowerCase(),
                              ),
                              { email: memberEmail, role: memberRole },
                            ]);
                            setMemberEmail("");
                          })
                        }
                      >
                        授予权限
                      </button>
                      <p className="text-[var(--text-tertiary)]">
                        成员登录同一组织后，可从“课题组共享”查看文档。授权后不发送邮件。
                      </p>
                      {document.members.map((member) => (
                        <div
                          key={member.email}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>
                            {member.email} ·{" "}
                            {member.role === "editor" ? "可编辑" : "仅查看"}
                          </span>
                          <button
                            disabled={busy}
                            type="button"
                            onClick={() =>
                              void run(() =>
                                members(
                                  document.members.filter(
                                    (item) => item.email !== member.email,
                                  ),
                                ),
                              )
                            }
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </section>
                  )}
                  <SharedSourcesPanel
                    key={document.id}
                    document={document}
                    owner={role === "owner"}
                    onUpdated={setDocument}
                  />
                  <details className="text-xs">
                    <summary className="cursor-pointer">
                      版本与修改记录（最近 20 次）
                    </summary>
                    {[...document.history].reverse().map((item) => (
                      <details
                        key={item.revision}
                        className="mt-2 rounded-lg border p-2"
                      >
                        <summary>
                          版本 {item.revision} · {item.action} · {item.at} ·{" "}
                          {item.actorId}
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap break-words">
                          {item.title}
                          {"\n\n"}
                          {item.content}
                        </pre>
                        {role !== "viewer" && (
                          <button
                            type="button"
                            className="mt-2 liquid-glass-btn px-3 py-2"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "恢复将更新共享正文；当前版本会先保存在历史中。请确认本地修改已同步。",
                                )
                              )
                                void run(async () => {
                                  await api("", {
                                    action: "restore",
                                    id: document.id,
                                    revision: document.revision,
                                    restoreRevision: item.revision,
                                  });
                                  await load(document.id);
                                });
                            }}
                          >
                            恢复此版本
                          </button>
                        )}
                      </details>
                    ))}
                  </details>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
