import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceReply, ResearchWorkspace, ResearchArtifact, StoredChat } from "./research-workspace-contract";
export interface WorkspaceActor { tenantId: string; memberId: string; notebookId: string }
export class WorkspaceError extends Error { constructor(message: string, readonly status: number) { super(message); } }
let queue: Promise<unknown> = Promise.resolve();
function filename(actor: WorkspaceActor) {
  const root = process.env.RESEARCH_WORKSPACE_STORE_DIR || path.join(path.dirname(process.env.SOURCE_STORE_PATH || path.join(process.cwd(), ".data/sources/sources.json")), "research-workspaces");
  return path.join(root, createHash("sha256").update(JSON.stringify([actor.tenantId, actor.memberId, actor.notebookId])).digest("hex") + ".json");
}
const digest = (message: StoredChat) => createHash("sha256").update(JSON.stringify(message)).digest("hex");
function reply(state: ResearchWorkspace): WorkspaceReply {
  return { ...state, digests: Object.fromEntries(state.messages.map((message) => [message.id, digest(message)])) };
}
export async function readResearchWorkspace(actor: WorkspaceActor): Promise<WorkspaceReply> {
  try {
    const state = JSON.parse(await readFile(filename(actor), "utf8")) as ResearchWorkspace;
    if (!Array.isArray(state.messages) || !Array.isArray(state.artifacts) || !Number.isSafeInteger(state.revision)) throw new Error("invalid_workspace_store");
    return reply(state);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply({ revision: 0, messages: [], artifacts: [] });
    throw error;
  }
}
type Mutation =
  | { action: "merge"; changes: Array<{ message: StoredChat; expectedDigest: string | null }> }
  | { action: "clear"; revision: number }
  | { action: "artifact"; artifact: Omit<ResearchArtifact, "id" | "createdAt" | "authorId"> };
export async function mutateResearchWorkspace(actor: WorkspaceActor, mutation: Mutation): Promise<WorkspaceReply> {
  const task = queue.then(async () => {
    const current = await readResearchWorkspace(actor);
    const state: ResearchWorkspace = { revision: current.revision, messages: [...current.messages], artifacts: [...current.artifacts], clearedAt: current.clearedAt };
    if (mutation.action === "merge") {
      const messages = new Map(state.messages.map((message) => [message.id, message]));
      for (const change of mutation.changes) {
        if (state.clearedAt && Date.parse(change.message.timestamp) <= Date.parse(state.clearedAt)) throw new WorkspaceError("这条记录已被清除，不能由离线副本重新恢复。", 409);
        const stored = messages.get(change.message.id);
        if (stored && digest(stored) === digest(change.message)) continue;
        if ((stored ? digest(stored) : null) !== change.expectedDigest) throw new WorkspaceError("另一设备已修改同一记录，本地副本已保留。请导出后读取云端版本。", 409);
        messages.set(change.message.id, change.message);
      }
      state.messages = [...messages.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    } else if (mutation.action === "clear") {
      if (mutation.revision !== state.revision) throw new WorkspaceError("云端记录已更新，请先读取最新记录再清除。", 409);
      state.messages = []; state.clearedAt = new Date().toISOString();
    } else {
      state.artifacts.push({ ...mutation.artifact, id: randomUUID(), createdAt: new Date().toISOString(), authorId: actor.memberId });
    }
    if (state.messages.length > 500 || state.artifacts.length > 200) throw new WorkspaceError("文献本记录已达容量上限，请导出归档或新建文献本。", 413);
    state.revision++;
    const data = JSON.stringify(state);
    if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw new WorkspaceError("研究记录超过 8 MB，请导出归档或拆分文献本。", 413);
    const target = filename(actor); await mkdir(path.dirname(target), { recursive: true });
    const temporary = target + "." + randomUUID() + ".tmp";
    await writeFile(temporary, data, { mode: 0o600 }); await rename(temporary, target);
    return reply(state);
  });
  queue = task.catch(() => undefined);
  return task;
}
