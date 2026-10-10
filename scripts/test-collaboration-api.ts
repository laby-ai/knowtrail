import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { NextRequest } from "next/server";
import type { ResearchDocument } from "../src/lib/research-collaboration-store";
async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "lingbi-crdt-test-")),
    originalFetch = globalThis.fetch;
  process.env.RESEARCH_DOCUMENT_STORE_PATH = root;
  process.env.ACCOUNT_CENTER_API_BASE = "http://collaboration.fixture";
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "http://collaboration.fixture/v1/auth/me");
    const token =
      new Headers(options?.headers)
        .get("Authorization")
        ?.replace("Bearer ", "") || "";
    if (!["owner", "editor", "viewer", "foreign"].includes(token))
      return Response.json({ error: "invalid" }, { status: 401 });
    return Response.json({
      tenant_id: token === "foreign" ? "another-tenant" : "tenant",
      tenant_name: "QA",
      member: {
        id: token,
        email: token + "@example.invalid",
        display_name: token.toUpperCase(),
        role_key: "member",
        status: "active",
      },
    });
  };
  try {
    const docs = await import("../src/app/api/research/documents/route"),
      collab = await import("../src/app/api/research/collaboration/route");
    const post = (token: string, body: unknown) =>
      docs.POST(
        new NextRequest("http://localhost/api/research/documents", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    const created = (await (
      await post("owner", {
        action: "create",
        notebookId: "book",
        title: "Concurrent research",
        content: "Original research.",
      })
    ).json()) as { document: ResearchDocument };
    let document = (
      (await (
        await post("owner", {
          action: "members",
          id: created.document.id,
          revision: created.document.revision,
          members: [
            { email: "editor@example.invalid", role: "editor" },
            { email: "viewer@example.invalid", role: "viewer" },
          ],
        })
      ).json()) as { document: ResearchDocument }
    ).document;
    const ownerClient = randomUUID(),
      editorClient = randomUUID(),
      viewerClient = randomUUID();
    const get = (
      token: string,
      clientId: string,
      vector = "",
      historyRevision = 0,
    ) =>
      collab.GET(
        new NextRequest(
          `http://localhost/api/research/collaboration?id=${document.id}&clientId=${clientId}&vector=${encodeURIComponent(vector)}&historyRevision=${historyRevision}`,
          { headers: token ? { Authorization: "Bearer " + token } : {} },
        ),
      );
    const update = (
      token: string,
      clientId: string,
      bytes: Uint8Array,
      checkpoint = false,
    ) =>
      collab.POST(
        new NextRequest("http://localhost/api/research/collaboration", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: document.id,
            clientId,
            vector: "",
            update: Buffer.from(bytes).toString("base64"),
            checkpoint,
          }),
        }),
      );
    assert.equal((await get("", viewerClient)).status, 401);
    assert.equal((await get("foreign", viewerClient)).status, 404);
    const first = await (await get("owner", ownerClient)).json();
    const a = new Y.Doc(),
      b = new Y.Doc();
    Y.applyUpdate(a, Buffer.from(first.update, "base64"));
    Y.applyUpdate(b, Buffer.from(first.update, "base64"));
    const base = Y.encodeStateVector(a);
    a.getText("content").insert(0, "A ");
    b.getText("content").insert(b.getText("content").length, " B");
    const deltaA = Y.encodeStateAsUpdate(a, base),
      deltaB = Y.encodeStateAsUpdate(b, base);
    const results = await Promise.all([
      update("owner", ownerClient, deltaA),
      update("editor", editorClient, deltaB),
    ]);
    assert(results.every((response) => response.status === 200));
    let merged = await (await get("viewer", viewerClient)).json();
    assert.equal(merged.content, "A Original research. B");
    assert(
      merged.peers.some((peer: { name: string }) => peer.name === "EDITOR"),
    );
    assert.equal((await update("viewer", viewerClient, deltaB)).status, 403);
    assert.equal((await update("editor", editorClient, deltaB)).status, 200);
    merged = await (await get("owner", ownerClient)).json();
    assert.equal(merged.content, "A Original research. B");
    const cached = await (
      await get(
        "owner",
        ownerClient,
        merged.vector,
        merged.history.at(-1).revision,
      )
    ).json();
    assert.equal(cached.history, undefined);
    assert.equal(cached.update, "AAA=");
    const anchor = "Original research.";
    const comment = (await (
      await post("editor", {
        action: "comment",
        id: document.id,
        text: "Clarify the method.",
        quote: anchor,
      })
    ).json()) as { document: ResearchDocument };
    assert.equal(comment.document.comments?.[0].authorId, "editor");
    assert.equal(
      (
        await post("viewer", {
          action: "comment",
          id: document.id,
          text: "Forbidden",
          quote: "",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("editor", {
          action: "comment",
          id: document.id,
          text: "Bad anchor",
          quote: "Not in document",
        })
      ).status,
      409,
    );
    const resolved = (await (
      await post("owner", {
        action: "resolve-comment",
        id: document.id,
        commentId: comment.document.comments![0].id,
        resolved: true,
      })
    ).json()) as { document: ResearchDocument };
    assert(resolved.document.comments![0].resolved);
    const renamed = (await (
      await post("owner", {
        action: "rename",
        id: document.id,
        revision: resolved.document.revision,
        title: "Updated title",
      })
    ).json()) as { document: ResearchDocument };
    assert.equal(renamed.document.content, "A Original research. B");
    const restored = (await (
      await post("owner", {
        action: "restore",
        id: document.id,
        revision: renamed.document.revision,
        restoreRevision: 1,
      })
    ).json()) as { document: ResearchDocument };
    assert.equal(restored.document.content, "Original research.");
    assert(
      restored.document.history.some(
        (snapshot) => snapshot.content === "A Original research. B",
      ),
    );
    const latest = await (await get("editor", editorClient)).json();
    Y.applyUpdate(a, Buffer.from(latest.update, "base64"));
    assert.equal(a.getText("content").toString(), "Original research.");
    const invalid = new Y.Doc();
    invalid.getMap("intruder").set("x", "x");
    assert.equal(
      (await update("owner", ownerClient, Y.encodeStateAsUpdate(invalid)))
        .status,
      422,
    );
    invalid.destroy();
    const oversized = new Y.Doc();
    Y.applyUpdate(oversized, Buffer.from(latest.update, "base64"));
    oversized.getText("content").insert(0, "x".repeat(100001));
    assert.equal(
      (await update("owner", ownerClient, Y.encodeStateAsUpdate(oversized)))
        .status,
      422,
    );
    oversized.destroy();
    const revoked = await post("owner", {
      action: "members",
      id: document.id,
      revision: restored.document.revision,
      members: [],
    });
    assert.equal(revoked.status, 200);
    assert.equal((await get("editor", editorClient)).status, 404);
    assert.equal((await update("editor", editorClient, deltaB)).status, 404);
    const remaining = await (await get("owner", ownerClient)).json();
    assert(
      !remaining.peers.some((peer: { name: string }) => peer.name === "EDITOR"),
    );
    assert.equal(remaining.content, "Original research.");
    a.destroy();
    b.destroy();
    console.log(
      "PASS: actual concurrent merge, idempotent retries, read-only roles, canonical presence, comments, restore, malicious schema/capacity rejection and immediate revocation",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
