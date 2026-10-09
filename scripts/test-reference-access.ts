import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "lingbi-reference-test-")),
    originalFetch = globalThis.fetch;
  const previous = {
    SOURCE_STORE_ADAPTER: process.env.SOURCE_STORE_ADAPTER,
    SOURCE_STORE_PATH: process.env.SOURCE_STORE_PATH,
    ACCOUNT_CENTER_API_BASE: process.env.ACCOUNT_CENTER_API_BASE,
  };
  try {
    process.env.SOURCE_STORE_ADAPTER = "local-json";
    process.env.SOURCE_STORE_PATH = path.join(root, "sources.json");
    process.env.ACCOUNT_CENTER_API_BASE = "http://reference.fixture";
    const at = new Date().toISOString();
    const source = {
      id: "own",
      ownerMemberId: "owner",
      notebookId: "book",
      title: "Stored title",
      shortName: "Original",
      fileName: "paper.txt",
      fileType: "txt",
      status: "succeeded",
      createdAt: at,
      updatedAt: at,
      stages: [],
      chunks: [],
      chunkCount: 0,
      tokenEstimate: 0,
      vectorIndex: { status: "not_configured", updatedAt: at },
      literature: {
        title: "Stored title",
        authors: [{ name: "Stored Author" }],
        year: 2020,
        doi: "10.1234/reference",
        abstract: "",
        venue: "Journal",
        url: "https://doi.org/10.1234/reference",
        source: "crossref",
        provider: "Crossref",
        evidenceScope: "metadata",
        retrievedAt: at,
      },
    };
    await writeFile(
      process.env.SOURCE_STORE_PATH,
      JSON.stringify({
        version: 1,
        updatedAt: at,
        sources: [
          source,
          { ...source, id: "foreign", ownerMemberId: "other" },
          { ...source, id: "other-book", notebookId: "other-book" },
        ],
      }),
    );
    let lookups = 0,
      mismatch = false,
      oversize = false;
    globalThis.fetch = async (url, options) => {
      if (String(url) === "http://reference.fixture/v1/auth/me") {
        const token = new Headers(options?.headers).get("Authorization");
        if (token !== "Bearer owner")
          return Response.json({ error: "invalid" }, { status: 401 });
        return Response.json({
          tenant_id: "tenant",
          tenant_name: "QA",
          member: {
            id: "owner",
            email: "owner@example.invalid",
            display_name: "Owner",
            role_key: "member",
            status: "active",
          },
        });
      }
      assert.equal(
        String(url),
        "https://api.crossref.org/works/10.1234%2Freference",
      );
      lookups++;
      if (oversize) return new Response("x".repeat(1024 * 1024 + 1));
      return Response.json({
        message: {
          DOI: mismatch ? "10.1234/wrong" : "10.1234/reference",
          type: "journal-article",
          title: ["Resolved title"],
          author: [{ family: "Author", given: "Real" }],
          issued: { "date-parts": [[2021]] },
          "container-title": ["Resolved Journal"],
          volume: "9",
          issue: "2",
          page: "1-8",
        },
      });
    };
    const { POST } = await import("../src/app/api/research/references/route");
    const post = (body: unknown, token = "owner") =>
      POST(
        new NextRequest("http://localhost/api/research/references", {
          method: "POST",
          headers: {
            ...(token ? { Authorization: "Bearer " + token } : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    const body = {
      notebookId: "book",
      sourceIds: ["own", "own"],
      enrich: true,
    };
    assert.equal((await post(body, "")).status, 401);
    assert.equal((await post({ ...body, sourceIds: ["foreign"] })).status, 404);
    assert.equal(
      (await post({ ...body, sourceIds: ["other-book"] })).status,
      404,
    );
    assert.equal(lookups, 0);
    const stored = await (await post({ ...body, enrich: false })).json();
    assert.equal(stored.items[0].paper.title, "Stored title");
    assert.equal(lookups, 0);
    const resolved = await (await post(body)).json();
    assert.equal(resolved.items.length, 1);
    assert.equal(resolved.items[0].paper.title, "Resolved title");
    assert.equal(resolved.items[0].paper.pages, "1-8");
    assert.equal(resolved.items[0].origin, "crossref");
    assert.equal(lookups, 1);
    mismatch = true;
    const fallback = await (await post(body)).json();
    assert.equal(fallback.items[0].paper.title, "Stored title");
    assert(fallback.items[0].warnings.length);
    oversize = true;
    const large = await (await post(body)).json();
    assert.equal(large.items[0].origin, "library");
    assert.equal(
      (await post({ ...body, sourceIds: Array(21).fill("own") })).status,
      400,
    );
    console.log(
      "PASS: canonical auth, owner/book isolation, deduplication, exact DOI request, malformed/oversize fallback and truthful stored fields",
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
