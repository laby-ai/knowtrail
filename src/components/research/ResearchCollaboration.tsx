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
  "id" | "title" | "notebookId" | "revision" | "shareWholeNotebook" | "sharedNotebookId"
>;
export function ResearchCollaboration({
  initialContent,
  initialTitle,
  sharedOnly = false,
}: {
  initialContent?: string;
  initialTitle?: string;
  sharedOnly?: boolean;
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
  const [sharedParent, setSharedParent] = useState<string | undefined>();
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
    setDocuments((data.documents || []).filter(item => !sharedOnly || item.shareWholeNotebook || item.sharedNotebookId));
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
            ...(sharedParent ? { sharedNotebookId: sharedParent } : {}),
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
          className="grid max-h-[90dvh] gap-6 overflow-y-auto p-5 sm:max-w-6xl sm:p-8"
          data-testid="research-collaboration-dialog"
        >
          <div className="space-y-2 pr-8">
          <DialogTitle>课题组共享</DialogTitle>
          <DialogDescription className="leading-6">
            管理共享文献本、协作研究文档和成员权限。
          </DialogDescription>
          <details className="text-xs leading-6 text-[var(--text-tertiary)]">
            <summary className="cursor-pointer">共享与协作说明</summary>
            <p className="mt-2 max-w-3xl">同一组织内按邮箱授予权限。正文每 2 秒合并协作修改，支持在线状态、批注和版本恢复；原文件单独授权共享。自动每 30 秒留存快照，可手动保存，保留最近 20 个版本。</p>
          </details>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-xs text-red-700"
            >
              {error}
            </p>
          )}
          <div className="grid min-w-0 gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="min-w-0 space-y-3 rounded-2xl border p-4 md:self-start">
              <h3 className="text-sm font-semibold">文献本与文档</h3>
              {!sharedOnly && <button
                type="button"
                disabled={busy}
                className="liquid-glass-btn w-full p-2 text-xs"
                onClick={() => {
                  if (!canReplaceDraft()) return;
                  setDocument(null);
                  setSharedParent(undefined);
                  setTitle(initialTitle || "");
                  setContent(initialContent || "");
                  setRole("owner");
                }}
              >
                新建研究文档
              </button>}
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
                  className="liquid-glass-btn w-full min-w-0 break-words text-left text-xs"
                  style={{ flexDirection: "column", alignItems: "flex-start", background: document?.id === item.id ? "var(--bg-secondary)" : undefined }}
                  aria-pressed={document?.id === item.id}
                  onClick={() => {
                    if (canReplaceDraft()) void run(() => load(item.id));
                  }}
                >
                  {item.shareWholeNotebook ? "共享文献本 · " : item.sharedNotebookId ? "共享文档 · " : ""}{item.title}
                  <span className="block text-[var(--text-tertiary)]">
                    版本 {item.revision}
                  </span>
                </button>
              ))}
            </aside>
            <div className="min-w-0 space-y-6">
              <h3 className="text-sm font-semibold">研究文档</h3>
              <label className="block text-sm leading-6">
                文档标题
                <input
                  className="liquid-glass-input mt-2 w-full"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={busy || role === "viewer"}
                  maxLength={160}
                />
              </label>
              {!document ? (
                <label className="block text-sm leading-6">
                  研究正文 / 实验日志
                  <textarea
                    className="liquid-glass-input mt-2 min-h-64 w-full leading-7"
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
                  onAccessLost={() => setRole("viewer")}
                  onSync={(data) => {
                    if (data.revision < document.revision) return;
                    setTitle((current) =>
                      current === document.title ? data.title : current,
                    );
                    setDocument((current) =>
                      current?.id === document.id &&
                      data.revision >= current.revision
                        ? {
                            ...current,
                            title: data.title,
                            content: data.content,
                            revision: data.revision,
                            updatedAt: data.updatedAt,
                            members: data.members,
                            sharedSourceIds: data.sharedSourceIds,
                            sharedSourceScopes: data.sharedSourceScopes,
                            shareWholeNotebook: data.shareWholeNotebook,
                            sharedNotebookId: data.sharedNotebookId,
                            comments: data.comments,
                            history: data.history || current.history,
                          }
                        : current,
                    );
                    setRole(data.role);
                  }}
                />
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy || role === "viewer" || !title.trim() || (sharedOnly && !document && !sharedParent)}
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
                  {role !== "viewer" && (document.shareWholeNotebook || document.sharedNotebookId) && <button type="button" className="liquid-glass-btn px-3 py-2 text-xs" disabled={busy} onClick={() => {
                    if (!canReplaceDraft()) return;
                    setSharedParent(document.shareWholeNotebook ? document.id : document.sharedNotebookId);
                    setDocument(null); setTitle(""); setContent(""); setRole("editor");
                  }}>在共享文献本中新建研究文档</button>}
                  {document.sharedNotebookId && <p className="text-xs">本研究文档继承共享文献本成员权限。请在列表中的共享文献本入口管理成员。</p>}
                  {role === "owner" && !document.sharedNotebookId && (
                    <section className="grid gap-4 rounded-2xl border p-5 text-sm leading-6">
                      <button type="button" className="liquid-glass-btn px-3 py-2" disabled={busy} onClick={() => {
                        const enabled = !document.shareWholeNotebook;
                        if (!window.confirm(enabled ? "共享当前文献本内所有研究文档、所有文献来源及后续新增内容？被移出共享库的来源除外。私人对话和个人科研记录不共享。成员可读取原文件，请确认共享范围。" : "停止整个文献本共享？继承权限的文档将不可访问；本入口原有的单文档授权及其他明确授权仍保留。")) return;
                        void run(async () => { const data = await api("", { action: "share-notebook", id: document.id, revision: document.revision, enabled }); if (data.document) setDocument(data.document); await reloadList(); });
                      }}>{document.shareWholeNotebook ? "停止整个文献本共享" : "共享整个文献本"}</button>
                      {document.shareWholeNotebook && <p>本入口的成员权限同时应用于整个文献本。现有单文档独立授权仍按其授权生效。</p>}
                      <h4 className="border-t pt-4 font-semibold">成员权限</h4>
                      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
                      <input
                        className="liquid-glass-input min-w-0 w-full"
                        aria-label="协作成员邮箱"
                        placeholder="同一组织成员的账号邮箱"
                        value={memberEmail}
                        onChange={(event) => setMemberEmail(event.target.value)}
                        type="email"
                      />
                      <select
                        className="liquid-glass-input w-full"
                        aria-label="成员访问权限"
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
                      </div>
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
                          className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
                        >
                          <span className="min-w-0 break-all">
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
                    canEdit={role !== "viewer"}
                    onUpdated={setDocument}
                  />
                  <details className="rounded-2xl border p-5 text-sm leading-6">
                    <summary className="cursor-pointer">
                      版本与修改记录（最近 20 次）
                    </summary>
                    {[...document.history].reverse().map((item) => (
                      <details
                        key={item.revision}
                        className="mt-3 rounded-xl border p-3"
                      >
                        <summary className="cursor-pointer break-words">
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
