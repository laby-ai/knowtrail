import { NextRequest } from "next/server";
import { z } from "zod";
import { POST as loadReferences } from "../references/route";
import { formatCslReferences } from "@/lib/csl-formatter";
import { CSL_STYLES } from "@/lib/csl-contract";
import type { ReferenceMetadata } from "@/lib/reference-metadata";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
const schema = z
  .object({
    notebookId: z.string().min(1).max(200),
    sourceIds: z.array(z.string().min(1).max(200)).min(1).max(20),
    citationSourceIds: z.array(z.string().min(1).max(200)).min(1).max(100),
    groups: z
      .array(z.array(z.number().int().min(1).max(100)).min(1).max(20))
      .max(100),
    styleId: z.enum(
      CSL_STYLES.map((style) => style.id) as [
        (typeof CSL_STYLES)[number]["id"],
        ...(typeof CSL_STYLES)[number]["id"][],
      ],
    ),
    enrich: z.boolean().default(false),
  })
  .strict();
export async function POST(request: NextRequest) {
  try {
    if (!(await resolveAccountSessionFromRequest(request)))
      return Response.json(
        { error: "请登录后应用引用样式。" },
        { status: 401 },
      );
  } catch {
    return Response.json({ error: "登录已失效。" }, { status: 401 });
  }
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "请选择引用样式及有效的来源编号。" },
      { status: 400 },
    );
  const data = input.data;
  const response = await loadReferences(
    new NextRequest(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        notebookId: data.notebookId,
        sourceIds: data.sourceIds,
        enrich: data.enrich,
      }),
    }),
  );
  if (!response.ok) return response;
  try {
    const loaded = (await response.json()) as { items: ReferenceMetadata[] };
    return Response.json(
      {
        formatted: await formatCslReferences(
          loaded.items,
          data.styleId,
          data.groups,
          data.citationSourceIds,
        ),
        items: loaded.items,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { error: "引用格式处理失败，请检查引用编号或缺失题录。" },
      { status: 422 },
    );
  }
}
