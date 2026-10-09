import { NextRequest } from "next/server";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
import { listResearchDocuments } from "@/lib/research-collaboration-store";
import {
  getIngestionSource,
  listIngestionSources,
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
    const scope = {
      ownerMemberId: document.ownerId,
      notebookId: document.notebookId,
    };
    const sourceId = request.nextUrl.searchParams.get("sourceId");
    const headers = { "Cache-Control": "private, no-store" };
    if (sourceId) {
      if (!document.sharedSourceIds?.includes(sourceId))
        return Response.json({ error: "此来源未共享。" }, { status: 404 });
      const source = await getIngestionSource(sourceId, scope);
      if (!source || source.ownerMemberId !== document.ownerId)
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
    const sharedIds = new Set(document.sharedSourceIds || []);
    const sources = (await listIngestionSources(scope)).filter((source) =>
      sharedIds.has(source.id),
    );
    return Response.json(
      {
        sources: sources
          .filter(
            (source) => source && source.ownerMemberId === document.ownerId,
          )
          .map((source) => ({
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
