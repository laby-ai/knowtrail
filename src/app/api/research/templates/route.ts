import { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveAccountSessionFromRequest } from "@/lib/account-session";
import { IEEE_ACCESS_TEMPLATE } from "@/lib/journal-template-catalog";
export async function GET(request: NextRequest) {
  try {
    if (!(await resolveAccountSessionFromRequest(request)))
      return Response.json(
        { error: "请登录后使用期刊模板。" },
        { status: 401 },
      );
  } catch {
    return Response.json(
      { error: "登录已失效，请重新登录。" },
      { status: 401 },
    );
  }
  if (request.nextUrl.searchParams.get("id") !== IEEE_ACCESS_TEMPLATE.id)
    return Response.json({ error: "期刊模板不存在。" }, { status: 404 });
  try {
    const root =
      process.env.JOURNAL_TEMPLATE_CACHE_PATH ||
      path.join(
        path.dirname(
          process.env.SOURCE_STORE_PATH ||
            path.join(process.cwd(), ".data/sources/sources.json"),
        ),
        "journal-templates",
      );
    const target = path.join(root, `${IEEE_ACCESS_TEMPLATE.sha256}.docx`);
    let bytes: Buffer;
    try {
      bytes = await readFile(target);
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
      const response = await fetch(IEEE_ACCESS_TEMPLATE.fileUrl, {
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      if (!response.ok || !response.body)
        throw new Error("template_source_unavailable");
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.length;
        if (total > 5 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("template_too_large");
        }
        chunks.push(chunk.value);
      }
      bytes = Buffer.concat(chunks);
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        IEEE_ACCESS_TEMPLATE.sha256
      )
        throw new Error("template_changed");
      await mkdir(root, { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, target);
    }
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      IEEE_ACCESS_TEMPLATE.sha256
    )
      throw new Error("invalid_cached_template");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Cache-Control": "private, no-store",
        "X-Template-Sha256": IEEE_ACCESS_TEMPLATE.sha256,
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "官方模板暂时不可用或版本已更新。请重试，或导入已下载的 Word 模板。",
      },
      { status: 502 },
    );
  }
}
