import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
import { listIngestionSources } from "@/lib/ingestion-store";
import {
  missingReferenceFields,
  parseCrossrefReference,
  referenceDoi,
  type ReferenceMetadata,
} from "@/lib/reference-metadata";
const schema = z
  .object({
    notebookId: z.string().min(1).max(200),
    sourceIds: z.array(z.string().min(1).max(200)).min(1).max(20),
    enrich: z.boolean().default(false),
  })
  .strict();
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty metadata");
  const decoder = new TextDecoder();
  let bytes = 0,
    body = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw new Error("Metadata too large");
      }
      body += decoder.decode(result.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await resolveAccountSessionFromRequest(request);
  } catch {
    session = null;
  }
  if (!session)
    return Response.json({ error: "请登录后读取参考文献。" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "请选择当前文献本中最多 20 个来源。" },
      { status: 400 },
    );
  const data = input.data;
  const scope = {
    ownerMemberId: session.member.id,
    notebookId: data.notebookId,
  };
  const sources = new Map(
    (await listIngestionSources(scope)).map((source) => [source.id, source]),
  );
  const ids = [...new Set(data.sourceIds)];
  if (ids.some((id) => !sources.has(id)))
    return Response.json({ error: "文献已移除或无权读取。" }, { status: 404 });
  const items: ReferenceMetadata[] = [];
  // Two fixed workers bound upstream concurrency. Every DOI comes from an authorized stored source.
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const index = next++,
        id = ids[index],
        source = sources.get(id)!,
        metadata = source.literature;
      const item: ReferenceMetadata = {
        sourceId: id,
        kind: "other",
        origin: "library",
        warnings: [],
        paper: {
          title: metadata?.title || source.title,
          authors: metadata?.authors || [],
          year: metadata?.year || "",
          venue: metadata?.venue,
          doi: metadata?.doi,
          url: metadata?.url,
          arxivId: metadata?.arxivId,
        },
      };
      const doi = referenceDoi(metadata?.doi);
      if (data.enrich && doi) {
        try {
          const response = await fetch(
            `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
            {
              redirect: "error",
              signal: AbortSignal.timeout(5000),
              headers: {
                Accept: "application/json",
                "User-Agent":
                  "KnowTrail/1.0 (https://airai.world/lingbi/; reference metadata)",
              },
            },
          );
          if (!response.ok) throw new Error("Crossref unavailable");
          const parsed = parseCrossrefReference(
            await boundedJson(response),
            doi,
          );
          item.paper = parsed;
          item.kind = parsed.kind;
          item.origin = "crossref";
        } catch {
          item.warnings.push("DOI 题录暂未补全，保留文献库字段");
        }
      } else if (data.enrich)
        item.warnings.push("无有效 DOI，未向 Crossref 查询");
      item.warnings.push(...missingReferenceFields(item.paper));
      if (item.kind !== "journal-article")
        item.warnings.push("载体类型未核验；不自动标作期刊论文");
      items[index] = item;
    }
  }
  await Promise.all([worker(), worker()]);
  return Response.json(
    { items, retrievedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
