import { readAppPreferences } from '@/lib/app-preferences-store';
import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
import { normalizeNotebookId } from "@/lib/notebook-scope";
import { storedChatSchema, artifactInputSchema } from "@/lib/research-workspace-contract";
import { readResearchWorkspace, mutateResearchWorkspace, WorkspaceError } from "@/lib/research-workspace-store";
import { listIngestionSources } from "@/lib/ingestion-store";
import { readDataAnalysis } from "@/lib/data-analysis-store";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("merge"), notebookId: z.string(), changes: z.array(z.object({ message: storedChatSchema, expectedDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict()).max(100) }).strict(),
  z.object({ action: z.literal("clear"), notebookId: z.string(), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("artifact"), notebookId: z.string(), artifact: artifactInputSchema }).strict(),
]);
async function handle(request: NextRequest, write: boolean) {
  const session = await resolveAccountSessionFromRequest(request).catch(() => null);
  if (!session) return Response.json({ error: "请登录后保存科研记录。" }, { status: 401 });
  try {
    const raw = write ? await request.text() : "";
    if (raw.length > 2 * 1024 * 1024) return Response.json({ error: "本次同步记录过大，请分批归档。" }, { status: 413 });
    const input = write ? schema.parse(JSON.parse(raw)) : undefined;
    const notebookId = normalizeNotebookId(input?.notebookId || request.nextUrl.searchParams.get("notebookId"));
    if (!notebookId) return Response.json({ error: "文献本编号无效。" }, { status: 400 });
    const actor = { tenantId: session.tenant_id, memberId: session.member.id, notebookId };
    if (input?.action === "merge" && !(await readAppPreferences(session.member.id)).saveHistory) return Response.json({ error: "已关闭历史保存。" }, { status: 409 });
    let state;
    if (input?.action === "artifact") {
      const sources = await listIngestionSources({ ownerMemberId: actor.memberId, notebookId });
      const artifact = { ...input.artifact };
      let analysis;
      if (artifact.analysisId) {
        const result = await readDataAnalysis(actor.memberId, artifact.analysisId).catch(() => null);
        if (!result || result.notebookId !== notebookId || !sources.some((source) => source.id === result.sourceId)) return Response.json({ error: "统计结果不属于当前文献本或原文件已移除。" }, { status: 404 });
        artifact.stage = "analysis"; artifact.content = result.resultsDraft; artifact.sourceIds = [result.sourceId];
        analysis = { id: result.id, sourceId: result.sourceId, sourceFileSha256: result.sourceFileSha256, method: result.method };
      }
      if (artifact.sourceIds.some((id) => !sources.some((source) => source.id === id))) return Response.json({ error: "关联来源不属于当前账号及文献本。" }, { status: 404 });
      state = await mutateResearchWorkspace(actor, { action: "artifact", artifact: { ...artifact, analysis } });
    } else state = input ? await mutateResearchWorkspace(actor, input) : await readResearchWorkspace(actor);
    const payload = request.nextUrl.searchParams.get("view") === "artifacts" ? { artifacts: state.artifacts, revision: state.revision, messageCount: state.messages.length } : state;
    return Response.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof WorkspaceError ? error.message : error instanceof z.ZodError || error instanceof SyntaxError ? "科研记录格式无效。" : "科研记录读取或保存失败，请重试。" }, { status: error instanceof WorkspaceError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500 });
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
