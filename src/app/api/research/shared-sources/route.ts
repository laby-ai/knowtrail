import { NextRequest } from "next/server";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
import {
  listResearchDocuments,
  documentSharedSourceScopes,
  documentRole,
  mutateResearchDocument,
  CollaborationError,
} from "@/lib/research-collaboration-store";
import { z } from "zod";
import {
  getIngestionSource,
  listIngestionSources,
  listIngestionSourcesByScopes,
} from "@/lib/ingestion-store";
import { retrieveFileBuffer } from "@/lib/storage";

export async function GET(request: NextRequest) {
  let session;
  try {
    session = await resolveAccountSessionFromRequest(request);
  } catch {
    session = null;
  }
  if (!session)
    return Response.json({ error: "请登录后查看共享来源。" }, { status: 401 });
  try {
    const id = request.nextUrl.searchParams.get("documentId");
    const document = (
      await listResearchDocuments({
        id: session.member.id,
        email: session.member.email,
        tenantId: session.tenant_id,
      })
    ).find((item) => item.id === id);
    if (!document)
      return Response.json(
        { error: "共享文档不存在或权限已撤销。" },
        { status: 404 },
      );
    const grants = documentSharedSourceScopes(document);
    const sourceId = request.nextUrl.searchParams.get("sourceId");
    const headers = { "Cache-Control": "private, no-store" };
    if (sourceId) {
      const grant = grants.find((item) => item.sourceId === sourceId);
      if (!grant)
        return Response.json({ error: "此来源未共享。" }, { status: 404 });
      const source = await getIngestionSource(sourceId, grant);
      if (!source || source.ownerMemberId !== grant.ownerMemberId)
        return Response.json({ error: "共享来源已移除。" }, { status: 404 });
      if (request.nextUrl.searchParams.get("download") === "1") {
        if (
          !source.storageKey?.startsWith("/uploads/") ||
          /\.\.|\\|\0/.test(source.storageKey) ||
          (source.fileSize || 0) > 25 * 1024 * 1024
        )
          return Response.json(
            { error: "当前来源不支持原文件下载。" },
            { status: 422 },
          );
        const buffer = await retrieveFileBuffer(source.storageKey);
        if (!buffer || buffer.length > 25 * 1024 * 1024)
          return Response.json(
            { error: "原文件不存在或超出下载限制。" },
            { status: 404 },
          );
        return new Response(new Uint8Array(buffer), {
          headers: {
            ...headers,
            "Content-Type": "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": `attachment; filename="shared-source.${source.fileType.replace(/[^a-z0-9]/gi, "") || "bin"}"; filename*=UTF-8''${encodeURIComponent(source.fileName).replace(/'/g, "%27")}`,
          },
        });
      }
      return Response.json(
        {
          source: {
            id: source.id,
            title: source.title,
            fileName: source.fileName,
            fileType: source.fileType,
            chunks: source.chunks,
          },
        },
        { headers },
      );
    }
    const sources = (await listIngestionSourcesByScopes(grants)).filter(
      (source) =>
        grants.some(
          (grant) =>
            grant.sourceId === source.id &&
            grant.ownerMemberId === source.ownerMemberId &&
            grant.notebookId === source.notebookId,
        ),
    );
    return Response.json(
      {
        sources: sources.map((source) => ({
          id: source!.id,
          title: source!.title,
          fileName: source!.fileName,
          fileType: source!.fileType,
        })),
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "共享来源读取失败，请重试。" },
      { status: 500 },
    );
  }
}
const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add"),
      documentId: z.string().uuid(),
      notebookId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/),
      sourceIds: z.array(z.string().min(1).max(200)).min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      documentId: z.string().uuid(),
      sourceId: z.string().min(1).max(200),
    })
    .strict(),
]);
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await resolveAccountSessionFromRequest(request);
  } catch {
    session = null;
  }
  if (!session)
    return Response.json(
      { error: "请登录后维护共享文献库。" },
      { status: 401 },
    );
  const actor = {
    id: session.member.id,
    email: session.member.email,
    tenantId: session.tenant_id,
    displayName: session.member.display_name,
  };
  try {
    const parsed = mutationSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: "共享来源设置无效。" }, { status: 400 });
    const data = parsed.data,
      document = (await listResearchDocuments(actor)).find(
        (item) => item.id === data.documentId,
      );
    if (!document)
      return Response.json(
        { error: "文档不存在或权限已撤销。" },
        { status: 404 },
      );
    if (documentRole(document, actor) === "viewer")
      return Response.json(
        { error: "查看者不能维护共享文献库。" },
        { status: 403 },
      );
    let updated;
    if (data.action === "add") {
      const sources = await listIngestionSources({
        ownerMemberId: actor.id,
        notebookId: data.notebookId,
      });
      if (
        data.sourceIds.some(
          (id) =>
            !sources.some(
              (source) => source.id === id && source.ownerMemberId === actor.id,
            ),
        )
      )
        return Response.json(
          { error: "只能主动共享自己文献本内的来源。" },
          { status: 404 },
        );
      updated = await mutateResearchDocument(actor, {
        action: "add-shared-sources",
        id: document.id,
        sources: [...new Set(data.sourceIds)].map((sourceId) => ({
          sourceId,
          ownerMemberId: actor.id,
          notebookId: data.notebookId,
        })),
      });
    } else
      updated = await mutateResearchDocument(actor, {
        action: "remove-shared-source",
        id: document.id,
        sourceId: data.sourceId,
      });
    return Response.json(
      { document: updated },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (caught) {
    return Response.json(
      {
        error:
          caught instanceof CollaborationError
            ? caught.message
            : "共享来源更新失败。",
      },
      { status: caught instanceof CollaborationError ? caught.status : 400 },
    );
  }
}
