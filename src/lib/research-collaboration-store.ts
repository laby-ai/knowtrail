import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import * as Y from "yjs";
import {
  documentCrdt,
  replaceSharedText,
  serializedCrdt,
} from "./collaboration-crdt";

export interface CollaborationActor {
  id: string;
  email: string;
  tenantId: string;
  displayName?: string;
}
export interface ResearchDocument {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  ownerId: string;
  tenantId: string;
  revision: number;
  updatedAt: string;
  members: Array<{ email: string; role: "viewer" | "editor" }>;
  sharedSourceIds?: string[];
  shareWholeNotebook?: boolean;
  sharedNotebookId?: string;
  excludedSourceIds?: string[];
  sharedSourceScopes?: Array<{
    sourceId: string;
    ownerMemberId: string;
    notebookId: string;
  }>;
  crdtState?: string;
  comments?: Array<{
    id: string;
    authorId: string;
    authorName: string;
    text: string;
    quote: string;
    resolved: boolean;
    at: string;
  }>;
  history: Array<{
    revision: number;
    actorId: string;
    action: string;
    at: string;
    title: string;
    content: string;
    members?: ResearchDocument["members"];
    sharedSourceIds?: string[];
    shareWholeNotebook?: boolean;
  }>;
}
export class CollaborationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
// Next may bundle this store into multiple route modules in the same process.
// They must serialize writes through one shared queue, not overwrite each other.
const processStore = globalThis as typeof globalThis & { lingbiResearchDocumentQueue?: Promise<unknown> };
processStore.lingbiResearchDocumentQueue ||= Promise.resolve();
const root = () =>
  process.env.RESEARCH_DOCUMENT_STORE_PATH ||
  path.join(
    path.dirname(
      process.env.SOURCE_STORE_PATH ||
        path.join(process.cwd(), ".data/sources/sources.json"),
    ),
    "research-documents",
  );
const filename = (tenantId: string) =>
  path.join(
    root(),
    createHash("sha256").update(tenantId).digest("hex") + ".json",
  );
const email = (value: string) => value.trim().toLowerCase();
async function read(tenantId: string): Promise<ResearchDocument[]> {
  try {
    const value: unknown = JSON.parse(
      await readFile(filename(tenantId), "utf8"),
    );
    if (!Array.isArray(value)) throw new Error("invalid_document_store");
    return value;
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw caught;
  }
}
export function documentRole(
  document: ResearchDocument,
  actor: CollaborationActor,
  documents: ResearchDocument[] = [],
): "owner" | "viewer" | "editor" | undefined {
  if (document.tenantId !== actor.tenantId) return;
  if (document.ownerId === actor.id) return "owner";
  if (!actor.email.trim()) return;
  const shared = sharedNotebookRoot(document, documents);
  if (document.sharedNotebookId)
    return shared?.members.find(member => member.email === email(actor.email))?.role;
  return document.members.find((member) => member.email === email(actor.email))?.role
    || shared?.members.find(member => member.email === email(actor.email))?.role;
}
export function sharedNotebookRoot(document: ResearchDocument, documents: ResearchDocument[]) {
  return documents.find(item => item.shareWholeNotebook && !item.sharedNotebookId
    && item.tenantId === document.tenantId && item.ownerId === document.ownerId
    && item.notebookId === document.notebookId
    && (document.sharedNotebookId ? item.id === document.sharedNotebookId : true));
}
export function sharedNotebookParentId(document: ResearchDocument, documents: ResearchDocument[]) {
  const root = sharedNotebookRoot(document, documents);
  return document.sharedNotebookId || (root?.id !== document.id ? root?.id : undefined);
}
export async function listResearchDocuments(actor: CollaborationActor) {
  const documents = await read(actor.tenantId);
  return documents.filter((document) =>
    documentRole(document, actor, documents),
  );
}
export type DocumentMutation =
  | {
      action: "add-shared-sources";
      id: string;
      sources: NonNullable<ResearchDocument["sharedSourceScopes"]>;
    }
  | { action: "remove-shared-source"; id: string; sourceId: string }
  | { action: "collaborate"; id: string; update: string; checkpoint?: boolean }
  | { action: "rename"; id: string; revision: number; title: string }
  | { action: "restore"; id: string; revision: number; restoreRevision: number }
  | { action: "comment"; id: string; text: string; quote: string }
  | {
      action: "resolve-comment";
      id: string;
      commentId: string;
      resolved: boolean;
    }
  | { action: "create"; notebookId: string; title: string; content: string; sharedNotebookId?: string }
  | { action: "share-notebook"; id: string; revision: number; enabled: boolean }
  | {
      action: "save";
      id: string;
      revision: number;
      title: string;
      content: string;
    }
  | {
      action: "members";
      id: string;
      revision: number;
      members: ResearchDocument["members"];
    }
  | { action: "sources"; id: string; revision: number; sourceIds: string[] };
export async function mutateResearchDocument(
  actor: CollaborationActor,
  mutation: DocumentMutation,
): Promise<ResearchDocument> {
  const job = processStore.lingbiResearchDocumentQueue!.then(async () => {
    const documents = await read(actor.tenantId);
    const at = new Date().toISOString();
    let document: ResearchDocument;
    if (mutation.action === "create") {
      const shared = mutation.sharedNotebookId ? documents.find(item => item.id === mutation.sharedNotebookId && item.shareWholeNotebook && !item.sharedNotebookId) : undefined;
      if (mutation.sharedNotebookId && (!shared || !["owner", "editor"].includes(documentRole(shared, actor, documents) || "")))
        throw new CollaborationError("共享文献本不存在或没有新建权限。", 403);
      if (documents.filter((item) => item.ownerId === (shared?.ownerId || actor.id)).length >= 200)
        throw new CollaborationError("研究文档数量已达上限。", 409);
      document = {
        id: randomUUID(),
        notebookId: shared?.notebookId || mutation.notebookId,
        title: mutation.title,
        content: mutation.content,
        ownerId: shared?.ownerId || actor.id,
        ...(shared ? { sharedNotebookId: shared.id } : {}),
        tenantId: actor.tenantId,
        revision: 1,
        updatedAt: at,
        members: [],
        history: [],
      };
      documents.push(document);
      const crdt = documentCrdt(document);
      document.crdtState = serializedCrdt(crdt);
      crdt.destroy();
    } else {
      const existing = documents.find((item) => item.id === mutation.id);
      if (!existing || !documentRole(existing, actor, documents))
        throw new CollaborationError("研究文档不存在或无权访问。", 404);
      const role = documentRole(existing, actor, documents);
      if (
        role === "viewer" ||
        ((mutation.action === "members" || mutation.action === "sources" || mutation.action === "share-notebook") &&
          role !== "owner")
      )
        throw new CollaborationError("没有修改权限。", 403);
      if ("revision" in mutation && existing.revision !== mutation.revision)
        throw new CollaborationError(
          "文档已被其他成员修改。请先刷新版本，保留并合并你的修改后再保存。",
          409,
        );
      document = existing;
      if (document.sharedNotebookId && (mutation.action === "members" || mutation.action === "share-notebook"))
        throw new CollaborationError("子文档继承共享文献本成员权限，请在文献本入口管理。", 403);
      const crdt = documentCrdt(document);
      try {
        if (mutation.action === "save") {
          document.title = mutation.title;
          document.content = mutation.content;
          replaceSharedText(crdt, mutation.content);
        } else if (mutation.action === "collaborate") {
          try {
            Y.applyUpdate(crdt, Buffer.from(mutation.update, "base64"));
            document.crdtState = serializedCrdt(crdt);
          } catch {
            throw new CollaborationError(
              "协作更新无效或文档超过容量限制。",
              422,
            );
          }
          document.content = crdt.getText("content").toString();
        } else if (mutation.action === "rename")
          document.title = mutation.title;
        else if (mutation.action === "restore") {
          const saved = document.history.find(
            (item) => item.revision === mutation.restoreRevision,
          );
          if (!saved)
            throw new CollaborationError("历史版本已超出保留范围。", 404);
          if (
            !document.history.some(
              (item) => item.revision === document.revision,
            )
          )
            document.history.push({
              revision: document.revision,
              actorId: actor.id,
              action: "before-restore",
              at,
              title: document.title,
              content: document.content,
            });
          document.title = saved.title;
          document.content = saved.content;
          replaceSharedText(crdt, saved.content);
        } else if (mutation.action === "comment") {
          if (mutation.quote && !document.content.includes(mutation.quote))
            throw new CollaborationError(
              "批注锚点原文已变化，请重新选择或清除锚点。",
              409,
            );
          if ((document.comments?.length || 0) >= 200)
            throw new CollaborationError("评论已达 200 条上限。", 409);
          document.comments = [
            ...(document.comments || []),
            {
              id: randomUUID(),
              authorId: actor.id,
              authorName: actor.displayName || actor.email,
              text: mutation.text,
              quote: mutation.quote,
              resolved: false,
              at,
            },
          ];
        } else if (mutation.action === "resolve-comment") {
          const comment = document.comments?.find(
            (item) => item.id === mutation.commentId,
          );
          if (!comment) throw new CollaborationError("评论不存在。", 404);
          comment.resolved = mutation.resolved;
        } else if (mutation.action === "share-notebook") {
          if (mutation.enabled && documents.some(item => item.id !== document.id && item.ownerId === document.ownerId && item.notebookId === document.notebookId && item.shareWholeNotebook))
            throw new CollaborationError("当前文献本已有共享入口，请使用已有入口管理成员。", 409);
          document.shareWholeNotebook = mutation.enabled;
        } else if (mutation.action === "members")
          document.members = mutation.members.map((member) => ({
            email: email(member.email),
            role: member.role,
          }));
        else if (mutation.action === "add-shared-sources") {
          if (
            mutation.sources.some((source) => source.ownerMemberId !== actor.id)
          )
            throw new CollaborationError("只能主动共享自己的原始来源。", 403);
          const grants = new Map(
            documentSharedSourceScopes(document).map((source) => [
              source.sourceId,
              source,
            ]),
          );
          for (const source of mutation.sources)
            grants.set(source.sourceId, source);
          if (grants.size > 100)
            throw new CollaborationError(
              "共享文献库达到 100 个来源上限。",
              409,
            );
          document.sharedSourceScopes = [...grants.values()];
          document.sharedSourceIds = [...grants.keys()];
          document.excludedSourceIds = (document.excludedSourceIds || []).filter(id => !mutation.sources.some(source => source.sourceId === id));
        } else if (mutation.action === "remove-shared-source") {
          if (document.shareWholeNotebook) document.excludedSourceIds = [...new Set([...(document.excludedSourceIds || []), mutation.sourceId])];
          document.sharedSourceScopes = documentSharedSourceScopes(
            document,
          ).filter((source) => source.sourceId !== mutation.sourceId);
          document.sharedSourceIds = document.sharedSourceScopes.map(
            (source) => source.sourceId,
          );
        } else {
          document.sharedSourceScopes = [
            ...documentSharedSourceScopes(document).filter(
              (source) => source.ownerMemberId !== document.ownerId,
            ),
            ...[...new Set(mutation.sourceIds)].map((sourceId) => ({
              sourceId,
              ownerMemberId: document.ownerId,
              notebookId: document.notebookId,
            })),
          ];
          document.sharedSourceIds = document.sharedSourceScopes.map(
            (source) => source.sourceId,
          );
        }
        document.crdtState = serializedCrdt(crdt);
      } finally {
        crdt.destroy();
      }
      document.revision++;
      document.updatedAt = at;
    }
    const lastSnapshot = document.history.at(-1);
    if (
      mutation.action !== "collaborate" ||
      mutation.checkpoint ||
      !lastSnapshot ||
      Date.parse(at) - Date.parse(lastSnapshot.at) >= 30000
    )
      document.history.push({
        revision: document.revision,
        actorId: actor.id,
        action: mutation.action,
        at,
        title: document.title,
        content: document.content,
        members: document.members.map((member) => ({ ...member })),
        sharedSourceIds: [...(document.sharedSourceIds || [])],
        shareWholeNotebook: document.shareWholeNotebook,
      });
    // Retain the most recent 20 revisions; UI exposes this retention boundary.
    document.history = document.history.slice(-20);
    const serialized = JSON.stringify(documents);
    if (Buffer.byteLength(serialized) > 20 * 1024 * 1024)
      throw new CollaborationError(
        "组织研究文档存储达到 20 MB 上限，请精简历史内容。",
        413,
      );
    await mkdir(root(), { recursive: true });
    const target = filename(actor.tenantId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, serialized, { mode: 0o600 });
    await rename(temporary, target);
    return document;
  });
  processStore.lingbiResearchDocumentQueue = job.catch(() => undefined);
  return job;
}
export function documentSharedSourceScopes(
  document: ResearchDocument,
): NonNullable<ResearchDocument["sharedSourceScopes"]> {
  return (
    document.sharedSourceScopes ||
    (document.sharedSourceIds || []).map((sourceId) => ({
      sourceId,
      ownerMemberId: document.ownerId,
      notebookId: document.notebookId,
    }))
  );
}
