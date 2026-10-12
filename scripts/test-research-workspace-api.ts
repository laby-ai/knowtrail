import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/research/workspace/route";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingbi-workspace-api-"));
  process.env.RESEARCH_WORKSPACE_STORE_DIR = root;
  process.env.SOURCE_STORE_PATH = path.join(root, "sources.json");
  process.env.SOURCE_STORE_ADAPTER = "local-json";
  process.env.DATA_ANALYSIS_STORE_DIR = path.join(root, "analyses");
  const server = createServer((request, response) => {
    const token = request.headers.authorization?.slice(7);
    response.setHeader("Content-Type", "application/json");
    if (request.url !== "/v1/auth/me" || !token || !["owner", "other", "other-tenant"].includes(token)) {
      response.writeHead(401).end('{"error":"invalid_fixture_token"}');
      return;
    }
    response.end(JSON.stringify({ tenant_id: token === "other-tenant" ? "other-org" : "org", member: { id: token === "other" ? "other" : "owner", email: `${token}@example.invalid` } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  process.env.ACCOUNT_CENTER_API_BASE = `http://127.0.0.1:${address.port}`;
  const request = (token: string, body?: unknown, book = "qa-book", view = "") => new NextRequest(`http://localhost/api/research/workspace?notebookId=${book}${view}`, {
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    headers: { Authorization: token ? `Bearer ${token}` : "", "Content-Type": "application/json" },
  });
  try {
    assert.equal((await GET(request(""))).status, 401);
    assert.equal((await POST(request("invalid", { action: "clear", notebookId: "qa-book", revision: 0 }))).status, 401);
    const body = { action: "artifact", notebookId: "qa-book", artifact: { stage: "design", title: "实际保存的实验记录", content: "样本量待核验", sourceIds: [] } };
    const saved = await POST(request("owner", body));
    assert.equal(saved.status, 200);
    const state = await saved.json();
    assert.equal(state.artifacts[0].authorId, "owner");
    assert.equal(saved.headers.get("Cache-Control"), "private, no-store");
    for (const token of ["other", "other-tenant"]) {
      assert.equal((await (await GET(request(token))).json()).artifacts.length, 0);
    }
    assert.equal((await (await GET(request("owner", undefined, "another-book"))).json()).artifacts.length, 0);
    const summary = await (await GET(request("owner", undefined, "qa-book", "&view=artifacts"))).json();
    assert.equal(summary.messages, undefined);
    assert.equal(summary.artifacts.length, 1);
    assert.equal((await POST(request("owner", { ...body, memberId: "other" }))).status, 400);
    assert.equal((await POST(request("owner", { ...body, artifact: { ...body.artifact, sourceIds: ["unowned-source"] } }))).status, 404);
    assert.equal((await POST(request("owner", { ...body, artifact: { ...body.artifact, analysisId: "00000000-0000-4000-8000-000000000001" } }))).status, 404);
    assert.equal((await POST(request("owner", { action: "clear", notebookId: "qa-book", revision: 0 }))).status, 409);
    console.log("PASS: canonical API authentication, member/tenant/notebook isolation, no-store response, private chat omission, forged identity and missing analysis/source rejection");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
