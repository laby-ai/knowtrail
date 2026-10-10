import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { ResearchDocument } from "../src/lib/research-collaboration-store";
async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "lingbi-shared-source-test-")),
    previous = process.cwd(),
    originalFetch = globalThis.fetch;
  try {
    process.chdir(root);
    process.env.RESEARCH_DOCUMENT_STORE_PATH = path.join(root, "documents");
    process.env.SOURCE_STORE_ADAPTER = "local-json";
    process.env.SOURCE_STORE_PATH = path.join(root, "sources.json");
    process.env.FILE_STORAGE_ADAPTER = "local";
    process.env.ACCOUNT_CENTER_API_BASE = "http://account.fixture";
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "http://account.fixture/v1/auth/me");
      const token =
        new Headers(options?.headers)
          .get("Authorization")
          ?.replace("Bearer ", "") || "";
      if (!["source-owner", "source-viewer", "source-editor"].includes(token))
        return Response.json(
          { error: "invalid_fixture_token" },
          { status: 401 },
        );
      return Response.json({
        tenant_id: "source-tenant",
        tenant_name: "QA",
        member: {
          id: token,
          display_name: "QA",
          email: `${token}@example.invalid`,
          role_key: "member",
          status: "active",
        },
      });
    };
    const { POST } = await import("../src/app/api/research/documents/route");
    const { GET, POST: shareSources } = await import(
      "../src/app/api/research/shared-sources/route"
    );
    const post = (token: string, body: unknown) =>
      POST(
        new NextRequest("http://localhost/api/research/documents", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    const get = (token: string, id: string, tail = "") =>
      GET(
        new NextRequest(
          `http://localhost/api/research/shared-sources?documentId=${id}${tail}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        ),
      );
    await mkdir(path.join(root, "public/uploads"), { recursive: true });
    await writeFile(
      path.join(root, "public/uploads/shared.txt"),
      "真实原文件验收内容",
    );
    const at = new Date().toISOString();
    const source = {
      id: "shared-source-test",
      notebookId: "source-book",
      ownerMemberId: "source-owner",
      title: "隔离共享来源",
      shortName: "QA",
      fileName: "shared.txt",
      fileType: "txt",
      fileSize: 30,
      storageKey: "/uploads/shared.txt",
      status: "succeeded",
      createdAt: at,
      updatedAt: at,
      stages: [],
      chunks: [{ id: "chunk-1", text: "原文片段验收内容", chunkIndex: 0 }],
      chunkCount: 1,
      tokenEstimate: 10,
      vectorIndex: { status: "not_configured", updatedAt: at },
    };
    await writeFile(
      process.env.SOURCE_STORE_PATH,
      JSON.stringify({
        version: 1,
        updatedAt: at,
        sources: [
          source,
          { ...source, id: "foreign-source", ownerMemberId: "foreign-owner" },
          {
            ...source,
            id: "editor-source",
            ownerMemberId: "source-editor",
            notebookId: "editor-book",
            title: "编辑成员贡献的文献",
            storageKey: "/uploads/editor.txt",
          },
        ],
      }),
    );
    let response = await post("source-owner", {
      action: "create",
      notebookId: "source-book",
      title: "共享文件验收",
      content: "共享范围须显式选择",
    });
    assert.equal(response.status, 200);
    let data = (await response.json()) as { document: ResearchDocument };
    const id = data.document.id;
    assert.equal((await get("source-viewer", id)).status, 404);
    assert.equal((await get("", id)).status, 401);
    response = await post("source-owner", {
      action: "members",
      id,
      revision: 1,
      members: [
        { email: "source-viewer@example.invalid", role: "viewer" },
        { email: "source-editor@example.invalid", role: "editor" },
      ],
    });
    data = (await response.json()) as { document: ResearchDocument };
    assert.equal(response.status, 200);
    assert.equal(
      (await get("source-viewer", id, "&sourceId=shared-source-test")).status,
      404,
    );
    assert.equal(
      (
        await post("source-editor", {
          action: "sources",
          id,
          revision: data.document.revision,
          sourceIds: [source.id],
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("source-owner", {
          action: "sources",
          id,
          revision: data.document.revision,
          sourceIds: ["foreign-source"],
        })
      ).status,
      400,
    );
    response = await post("source-owner", {
      action: "sources",
      id,
      revision: data.document.revision,
      sourceIds: [source.id],
    });
    data = (await response.json()) as { document: ResearchDocument };
    assert.equal(response.status, 200);
    response = await get("source-viewer", id, "&sourceId=shared-source-test");
    assert.equal(response.status, 200);
    const shared = (await response.json()) as {
      source: { chunks: Array<{ text: string }>; storageKey?: string };
    };
    assert.equal(shared.source.chunks[0].text, "原文片段验收内容");
    assert.equal(shared.source.storageKey, undefined);
    response = await get(
      "source-viewer",
      id,
      "&sourceId=shared-source-test&download=1",
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "真实原文件验收内容");
    await writeFile(
      path.join(root, "public/uploads/editor.txt"),
      "编辑成员的实际原文件",
    );
    const contribute = (token: string, body: unknown) =>
      shareSources(
        new NextRequest("http://localhost/api/research/shared-sources", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    assert.equal(
      (
        await contribute("source-viewer", {
          action: "add",
          documentId: id,
          notebookId: "editor-book",
          sourceIds: ["editor-source"],
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await contribute("source-editor", {
          action: "add",
          documentId: id,
          notebookId: "source-book",
          sourceIds: [source.id],
        })
      ).status,
      404,
    );
    response = await contribute("source-editor", {
      action: "add",
      documentId: id,
      notebookId: "editor-book",
      sourceIds: ["editor-source"],
    });
    assert.equal(response.status, 200);
    data = (await response.json()) as { document: ResearchDocument };
    assert.equal(data.document.sharedSourceIds?.length, 2);
    const contributed = await get(
      "source-viewer",
      id,
      "&sourceId=editor-source&download=1",
    );
    assert.equal(contributed.status, 200);
    assert.equal(await contributed.text(), "编辑成员的实际原文件");
    assert.equal(
      (
        await contribute("source-viewer", {
          action: "remove",
          documentId: id,
          sourceId: "editor-source",
        })
      ).status,
      403,
    );
    response = await contribute("source-editor", {
      action: "remove",
      documentId: id,
      sourceId: "editor-source",
    });
    assert.equal(response.status, 200);
    data = (await response.json()) as { document: ResearchDocument };
    assert.equal(
      (await get("source-viewer", id, "&sourceId=editor-source&download=1"))
        .status,
      404,
    );
    response = await post("source-owner", {
      action: "sources",
      id,
      revision: data.document.revision,
      sourceIds: [],
    });
    data = (await response.json()) as { document: ResearchDocument };
    assert.equal(response.status, 200);
    assert.equal(
      (
        await get(
          "source-viewer",
          id,
          "&sourceId=shared-source-test&download=1",
        )
      ).status,
      404,
    );
    response = await post("source-owner", {
      action: "members",
      id,
      revision: data.document.revision,
      members: [],
    });
    assert.equal(response.status, 200);
    assert.equal((await get("source-viewer", id)).status, 404);
    console.log(
      "PASS: explicit source sharing, original bytes, foreign source denial, owner-only grants and immediate revocation",
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
