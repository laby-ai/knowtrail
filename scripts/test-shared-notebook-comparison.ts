import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { NextRequest } from "next/server";
import { mutateResearchDocument, listResearchDocuments } from "../src/lib/research-collaboration-store";
import { sharedNotebookSources } from "../src/lib/shared-notebook-sources";
import { compareLiterature } from "../src/lib/literature-comparison";
import type { StoredSourceRecord } from "../src/lib/ingestion-store";
import { POST as comparisonApi } from "../src/app/api/research/literature-comparison/route";
import { GET as sourceApi } from "../src/app/api/research/shared-sources/route";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingbi-shared-book-"));
  process.env.RESEARCH_DOCUMENT_STORE_PATH = path.join(root, "documents");
  process.env.SOURCE_STORE_PATH = path.join(root, "sources.json");
  process.env.SOURCE_STORE_ADAPTER = "local-json";
  const owner = { id: "owner", tenantId: "org", email: "owner@example.invalid" };
  const editor = { id: "editor", tenantId: "org", email: "editor@example.invalid" };
  const viewer = { id: "viewer", tenantId: "org", email: "viewer@example.invalid" };
  const server = createServer((request, response) => {
    const actor = [owner, editor, viewer].find(item => `Bearer ${item.id}` === request.headers.authorization);
    response.setHeader("Content-Type", "application/json");
    if (!actor || request.url !== "/v1/auth/me") { response.writeHead(401).end('{"error":"invalid_fixture"}'); return; }
    response.end(JSON.stringify({ tenant_id: actor.tenantId, member: { id: actor.id, email: actor.email } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  process.env.ACCOUNT_CENTER_API_BASE = `http://127.0.0.1:${address.port}`;
  const source = (id: string, year?: number): StoredSourceRecord => ({
    id, ownerMemberId: owner.id, notebookId: "book", title: `${id} 方法结果测试文献`, shortName: id,
    fileName: id + ".txt", fileType: "txt", status: "succeeded", createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z",
    stages: [], chunkCount: 1, tokenEstimate: 20, vectorIndex: { status: "pending", updatedAt: "2026-10-12T00:00:00Z" },
    chunks: [{ id: id + "-chunk", sourceId: id, sourceIndex: 0, chunkIndex: 2, page: 4, paperShortName: id, sourceTitle: id, text: "我们采用回归方法研究样本。数据来自 50 名参与者。结果显示提升 1.5%，仍存在样本局限。", tokenEstimate: 20 }],
    ...(year ? { literature: { title: id, authors: [], year, abstract: "", venue: "Fixture Journal", url: "", source: "crossref", provider: "Crossref", evidenceScope: "fulltext", retrievedAt: "2026-10-12T00:00:00Z" } } : {}),
  });
  let sources = [source("a", 2020), source("b", 2022), source("undated")];
  const saveSources = () => writeFile(process.env.SOURCE_STORE_PATH!, JSON.stringify({ version: 1, updatedAt: "2026-10-12T00:00:00Z", sources }));
  const request = (actorId: string, input: unknown) => new NextRequest("http://localhost/api/research/literature-comparison", { method: "POST", headers: { Authorization: `Bearer ${actorId}` }, body: JSON.stringify(input) });
  try {
    await saveSources();
    const existing = await mutateResearchDocument(owner, { action: "create", notebookId: "book", title: "既有实验记录", content: "已有真实记录" });
    let book = await mutateResearchDocument(owner, { action: "create", notebookId: "book", title: "共享文献本入口", content: "团队研究说明" });
    book = await mutateResearchDocument(owner, { action: "members", id: book.id, revision: book.revision, members: [{ email: editor.email, role: "editor" }, { email: viewer.email, role: "viewer" }] });
    assert(!(await listResearchDocuments(editor)).some(item => item.id === existing.id));
    book = await mutateResearchDocument(owner, { action: "share-notebook", id: book.id, revision: book.revision, enabled: true });
    assert((await listResearchDocuments(editor)).some(item => item.id === existing.id));
    assert.equal((await sharedNotebookSources(viewer, book.id)).sources.length, 3);
    sources.push(source("future", 2024)); await saveSources();
    assert.equal((await sharedNotebookSources(editor, book.id)).sources.length, 4);
    const child = await mutateResearchDocument(editor, { action: "create", sharedNotebookId: book.id, notebookId: "forged-book", title: "团队新建实验记录", content: "编辑成员实际创建" });
    assert.equal(child.ownerId, owner.id); assert.equal(child.notebookId, "book");
    await assert.rejects(mutateResearchDocument(viewer, { action: "create", sharedNotebookId: book.id, notebookId: "book", title: "无权创建", content: "" }), /没有新建权限/);
    await assert.rejects(mutateResearchDocument(viewer, { action: "rename", id: child.id, revision: child.revision, title: "无权改名" }), /没有修改权限/);
    assert.equal((await sharedNotebookSources(editor, child.id)).sources.length, 4);
    book = await mutateResearchDocument(editor, { action: "remove-shared-source", id: book.id, sourceId: "future" });
    assert.equal((await sharedNotebookSources(viewer, child.id)).sources.length, 3);
    assert.equal(sources.length, 4);
    const matrix = compareLiterature(sources);
    assert.deepEqual(matrix.timeline.map(item => item.year), [2020, 2022, 2024]);
    assert.deepEqual(matrix.undatedSourceIds, ["undated"]);
    assert(matrix.rows[0].facets.find(item => item.key === "result")?.quote.includes("1.5%"));
    for (const row of matrix.rows) for (const evidence of row.facets) {
      assert.equal(evidence.chunkIndex, 2); assert.equal(evidence.page, 4);
      assert(sources.find(item => item.id === row.sourceId)!.chunks[0].text.includes(evidence.quote));
    }
    const metadata = source("metadata", 2023); metadata.literature!.evidenceScope = "metadata";
    assert.equal(compareLiterature([metadata]).rows[0].facets.length, 0);
    const headingOnly = source("heading-only"); headingOnly.chunks = [];
    assert.equal(compareLiterature([headingOnly]).rows[0].facets.length, 0);
    assert.equal((await comparisonApi(request("viewer", { sharedDocumentId: child.id, sourceIds: ["a", "b"] }))).status, 200);
    assert.equal((await comparisonApi(request("viewer", { notebookId: "book", sourceIds: ["a", "b"] }))).status, 404);
    assert.equal((await comparisonApi(request("owner", { notebookId: "other-book", sourceIds: ["a", "b"] }))).status, 404);
    assert.equal((await comparisonApi(request("viewer", { sharedDocumentId: child.id, sourceIds: ["a", "future"] }))).status, 404);
    assert.equal((await comparisonApi(request("invalid", { sharedDocumentId: child.id, sourceIds: ["a", "b"] }))).status, 401);
    book = await mutateResearchDocument(owner, { action: "share-notebook", id: book.id, revision: book.revision, enabled: false });
    await assert.rejects(sharedNotebookSources(editor, child.id), /权限已撤销/);
    assert(!(await listResearchDocuments(editor)).some(item => item.id === existing.id));
    book = await mutateResearchDocument(owner, { action: "share-notebook", id: book.id, revision: book.revision, enabled: true });
    await mutateResearchDocument(owner, { action: "members", id: book.id, revision: book.revision, members: [] });
    assert.equal((await listResearchDocuments(editor)).length, 0);
    assert.equal((await listResearchDocuments({ ...editor, tenantId: "other-org" })).length, 0);
    assert.equal((await sourceApi(new NextRequest(`http://localhost/api/research/shared-sources?documentId=${child.id}&sourceId=a&download=1`, { headers: { Authorization: "Bearer editor" } }))).status, 404);
    assert.equal((await comparisonApi(request("viewer", { sharedDocumentId: child.id, sourceIds: ["a", "b"] }))).status, 404);
    console.log("PASS: whole notebook inheritance, future sources, editor create scope, viewer denial, source exclusion, disable/revoke, tenant isolation, actual API access, paragraph/page fidelity, decimals, metadata-only rejection and non-fabricated publication timeline");
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
