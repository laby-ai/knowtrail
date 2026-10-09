import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CollaborationActor {
  id: string;
  email: string;
  tenantId: string;
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
      if (existing.revision !== mutation.revision)
        throw new CollaborationError(
          "文档已被其他成员修改。请先刷新版本，保留并合并你的修改后再保存。",
          409,
        );
      document = existing;
      if (mutation.action === "save") {
        document.title = mutation.title;
        document.content = mutation.content;
      } else if (mutation.action === "members")
        document.members = mutation.members.map((member) => ({
          email: email(member.email),
          role: member.role,
        }));
      else document.sharedSourceIds = [...new Set(mutation.sourceIds)];
      document.revision++;
      document.updatedAt = at;
    }
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
