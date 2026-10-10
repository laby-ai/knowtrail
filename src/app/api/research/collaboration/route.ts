import { NextRequest } from "next/server";
import { z } from "zod";
import * as Y from "yjs";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
import {
  listResearchDocuments,
  documentRole,
  mutateResearchDocument,
  CollaborationError,
  type CollaborationActor,
} from "@/lib/research-collaboration-store";
import { documentCrdt } from "@/lib/collaboration-crdt";
import { updatePresence } from "@/lib/collaboration-presence";
const b64 = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const schema = z
  .object({
    id: z.string().uuid(),
    vector: b64.max(6000).default(""),
    clientId: z.string().uuid(),
    cursor: z.number().int().min(0).max(100000).default(0),
    historyRevision: z.number().int().nonnegative().default(0),
    update: b64.max(350000).optional(),
    checkpoint: z.boolean().optional(),
  })
  .strict();
async function handle(request: NextRequest, write: boolean) {
  let actor: CollaborationActor | null = null;
  try {
    const session = await resolveAccountSessionFromRequest(request);
    if (session)
      actor = {
        id: session.member.id,
        email: session.member.email,
        tenantId: session.tenant_id,
        displayName: session.member.display_name,
      };
  } catch {}
  if (!actor)
    return Response.json({ error: "请登录后协同编辑。" }, { status: 401 });
  try {
    let raw: unknown;
    if (write) {
      const text = await request.text();
      if (text.length > 360000)
        return Response.json(
          { error: "协作更新过大，请分批粘贴。" },
          { status: 413 },
        );
      raw = JSON.parse(text);
    } else
      raw = {
        id: request.nextUrl.searchParams.get("id"),
        vector: request.nextUrl.searchParams.get("vector") || "",
        clientId: request.nextUrl.searchParams.get("clientId"),
        cursor: Number(request.nextUrl.searchParams.get("cursor") || 0),
        historyRevision: Number(
          request.nextUrl.searchParams.get("historyRevision") || 0,
        ),
      };
    const data = schema.parse(raw);
    let document = (await listResearchDocuments(actor)).find(
      (item) => item.id === data.id,
    );
    if (!document)
      return Response.json(
        { error: "文档不存在或共享权限已撤销。" },
        { status: 404 },
      );
    if (write) {
      if (!data.update)
        return Response.json({ error: "缺少协作更新。" }, { status: 400 });
      document = await mutateResearchDocument(actor, {
        action: "collaborate",
        id: data.id,
        update: data.update,
        checkpoint: data.checkpoint,
      });
    }
    const doc = documentCrdt(document);
    try {
      const update = Y.encodeStateAsUpdate(
        doc,
        data.vector ? Buffer.from(data.vector, "base64") : undefined,
      );
      return Response.json(
        {
          update: Buffer.from(update).toString("base64"),
          vector: Buffer.from(Y.encodeStateVector(doc)).toString("base64"),
          role: documentRole(document, actor),
          revision: document.revision,
          content: document.content,
          title: document.title,
          updatedAt: document.updatedAt,
          members: document.members,
          sharedSourceIds: document.sharedSourceIds || [],
          sharedSourceScopes: document.sharedSourceScopes,
          comments: document.comments || [],
          ...(data.historyRevision !== document.history.at(-1)?.revision
            ? { history: document.history }
            : {}),
          peers: updatePresence(document, actor, data.clientId, data.cursor),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } finally {
      doc.destroy();
    }
  } catch (caught) {
    return Response.json(
      {
        error:
          caught instanceof CollaborationError
            ? caught.message
            : "协作更新格式无效或读取失败。",
      },
      { status: caught instanceof CollaborationError ? caught.status : 400 },
    );
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
