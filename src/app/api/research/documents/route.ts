import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
import {
  CollaborationError,
  documentRole,
  listResearchDocuments,
  mutateResearchDocument,
  type CollaborationActor,
} from "@/lib/research-collaboration-store";
import { listIngestionSources } from "@/lib/ingestion-store";
const fields = {
  title: z.string().trim().min(1).max(160),
  content: z.string().max(100000),
};
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      notebookId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/),
      ...fields,
    })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      ...fields,
    })
    .strict(),
  z
    .object({
      action: z.literal("members"),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      members: z
        .array(
          z
            .object({
              email: z.string().trim().email().max(254),
              role: z.enum(["viewer", "editor"]),
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
  z
    .object({
      action: z.literal("sources"),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      sourceIds: z.array(z.string().min(1).max(200)).max(100),
    })
    .strict(),
]);
async function actorFromRequest(
  request: NextRequest,
): Promise<CollaborationActor | null> {
  const session = await resolveAccountSessionFromRequest(request);
  return session
    ? {
        id: session.member.id,
        email: session.member.email,
        tenantId: session.tenant_id,
      }
    : null;
}
async function handle(request: NextRequest, write: boolean) {
  let actor: CollaborationActor | null;
  try {
    actor = await actorFromRequest(request);
  } catch {
    actor = null;
  }
  if (!actor)
    return Response.json(
      { error: "请登录后使用课题组共享。" },
      { status: 401 },
    );
  try {
    if (write) {
      const raw = await request.text();
      if (raw.length > 120000)
        return Response.json(
          { error: "文档过大，请拆分后保存。" },
          { status: 413 },
        );
      const parsed = schema.safeParse(JSON.parse(raw));
      if (!parsed.success)
        return Response.json(
          { error: "文档或成员设置无效。" },
          { status: 400 },
        );
      const mutation = parsed.data;
      if (mutation.action === "sources") {
        const document = (await listResearchDocuments(actor)).find(
          (item) => item.id === mutation.id,
        );
        if (!document || document.ownerId !== actor.id)
          return Response.json(
            { error: "只有所有者可以共享来源。" },
            { status: 403 },
          );
        const sources = await listIngestionSources({
          ownerMemberId: actor.id,
          notebookId: document.notebookId,
        });
        for (const id of mutation.sourceIds) {
          const source = sources.find((item) => item.id === id);
          if (!source || source.ownerMemberId !== actor.id)
            return Response.json(
              { error: "来源不属于当前文献本，无法共享。" },
              { status: 400 },
            );
        }
      }
      const document = await mutateResearchDocument(actor, mutation);
      return Response.json(
        { document, role: documentRole(document, actor) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const documents = await listResearchDocuments(actor);
    const id = request.nextUrl.searchParams.get("id");
    if (id) {
      const document = documents.find((item) => item.id === id);
      if (!document)
        return Response.json(
          { error: "研究文档不存在或无权访问。" },
          { status: 404 },
        );
      return Response.json(
        { document, role: documentRole(document, actor) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json(
      {
        documents: documents.map(
          ({ id, title, notebookId, updatedAt, revision, ownerId }) => ({
            id,
            title,
            notebookId,
            updatedAt,
            revision,
            ownerId,
          }),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (caught) {
    return Response.json(
      {
        error:
          caught instanceof CollaborationError
            ? caught.message
            : "研究文档保存或读取失败，请重试。",
      },
      {
        status:
          caught instanceof CollaborationError
            ? caught.status
            : caught instanceof SyntaxError
              ? 400
              : 500,
      },
    );
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
