import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
import { listIngestionSources } from "@/lib/ingestion-store";
import { sharedNotebookSources } from "@/lib/shared-notebook-sources";
import { compareLiterature } from "@/lib/literature-comparison";
import { CollaborationError } from "@/lib/research-collaboration-store";
const schema = z.object({
  notebookId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/).optional(),
  sharedDocumentId: z.string().uuid().optional(),
  sourceIds: z.array(z.string().min(1).max(200)).min(2).max(30),
}).strict().refine(value => Boolean(value.notebookId) !== Boolean(value.sharedDocumentId));
export async function POST(request: NextRequest) {
  const session = await resolveAccountSessionFromRequest(request).catch(() => null);
  if (!session) return Response.json({ error: "请登录后比较文献。" }, { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 10000) return Response.json({ error: "请求过大。" }, { status: 413 });
    const input = schema.parse(JSON.parse(raw));
    const ids = [...new Set(input.sourceIds)];
    if (ids.length < 2) return Response.json({ error: "至少选择两篇不同来源。" }, { status: 400 });
    const available = input.sharedDocumentId
      ? (await sharedNotebookSources({ id: session.member.id, email: session.member.email, tenantId: session.tenant_id }, input.sharedDocumentId)).sources
      : await listIngestionSources({ ownerMemberId: session.member.id, notebookId: input.notebookId });
    const sources = ids.map(id => available.find(source => source.id === id));
    if (sources.some(source => !source)) return Response.json({ error: "来源不存在、属于其他文献本或共享权限已撤销。" }, { status: 404 });
    if (sources.reduce((total, source) => total + (source?.chunks.reduce((count, chunk) => count + chunk.text.length, 0) || 0), 0) > 10000000)
      return Response.json({ error: "所选原文过多，请分批比较；不会截断文献后冒充完整比较。" }, { status: 413 });
    return Response.json(compareLiterature(sources.filter(source => source !== undefined)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof CollaborationError ? error.message : "文献对比读取失败或参数无效。" }, { status: error instanceof CollaborationError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500 });
  }
}
