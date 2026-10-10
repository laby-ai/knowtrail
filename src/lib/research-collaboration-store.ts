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
let queue: Promise<unknown> = Promise.resolve();
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
): "owner" | "viewer" | "editor" | undefined {
  if (document.tenantId !== actor.tenantId) return;
  if (document.ownerId === actor.id) return "owner";
  if (!actor.email.trim()) return;
  return document.members.find((member) => member.email === email(actor.email))
    ?.role;
}
export async function listResearchDocuments(actor: CollaborationActor) {
  return (await read(actor.tenantId)).filter((document) =>
    documentRole(document, actor),
  );
}
export type DocumentMutation =
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
  | { action: "create"; notebookId: string; title: string; content: string }
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
  const job = queue.then(async () => {
    const documents = await read(actor.tenantId);
    const at = new Date().toISOString();
    let document: ResearchDocument;
    if (mutation.action === "create") {
      if (documents.filter((item) => item.ownerId === actor.id).length >= 200)
        throw new CollaborationError("研究文档数量已达上限。", 409);
      document = {
        id: randomUUID(),
        notebookId: mutation.notebookId,
        title: mutation.title,
        content: mutation.content,
        ownerId: actor.id,
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
      if (!existing || !documentRole(existing, actor))
        throw new CollaborationError("研究文档不存在或无权访问。", 404);
      const role = documentRole(existing, actor);
      if (
        role === "viewer" ||
        ((mutation.action === "members" || mutation.action === "sources") &&
          role !== "owner")
      )
        throw new CollaborationError("没有修改权限。", 403);
      if ("revision" in mutation && existing.revision !== mutation.revision)
        throw new CollaborationError(
          "文档已被其他成员修改。请先刷新版本，保留并合并你的修改后再保存。",
          409,
        );
      document = existing;
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
        } else if (mutation.action === "members")
          document.members = mutation.members.map((member) => ({
            email: email(member.email),
            role: member.role,
          }));
        else document.sharedSourceIds = [...new Set(mutation.sourceIds)];
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
  queue = job.catch(() => undefined);
  return job;
}
