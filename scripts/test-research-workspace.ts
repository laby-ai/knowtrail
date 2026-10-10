import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mutateResearchWorkspace, readResearchWorkspace } from "../src/lib/research-workspace-store";
import { mergeCloudHistory } from "../src/lib/cloud-history-merge";
import { chatPayload } from "../src/lib/research-workspace-contract";
import { researchWritingContext } from "../src/lib/research-writing-context";
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingbi-workspace-"));
  process.env.RESEARCH_WORKSPACE_STORE_DIR = root;
  process.env.SOURCE_STORE_PATH = path.join(root, "sources.json");
  process.env.SOURCE_STORE_ADAPTER = "local-json";
  const actor = { tenantId: "qa-org", memberId: "qa-owner", notebookId: "qa-book" };
  const message = (id: string, content: string) => chatPayload({ id, role: "assistant", content, timestamp: "2026-01-01T00:00:00Z" });
  try {
    const a = message("a", "Actual local record 1.5%"), b = message("b", "Independent device record");
    await Promise.all([a, b].map((entry) => mutateResearchWorkspace(actor, { action: "merge", changes: [{ message: entry, expectedDigest: null }] })));
    const initial = await readResearchWorkspace(actor);
    assert.deepEqual(initial.messages.map((entry) => entry.id).sort(), ["a", "b"]);
    const changed = message("a", "Edited by device A");
    await mutateResearchWorkspace(actor, { action: "merge", changes: [{ message: changed, expectedDigest: initial.digests.a }] });
    await assert.rejects(mutateResearchWorkspace(actor, { action: "merge", changes: [{ message: message("a", "Stale overwrite"), expectedDigest: initial.digests.a }] }), /另一设备/);
    const remote = await readResearchWorkspace(actor);
    assert.equal(remote.messages.find((entry) => entry.id === "a")?.content, changed.content);
    const unsent = message("a", "Newer local draft while acknowledgement is in flight");
    const merged = mergeCloudHistory([unsent], remote, new Map([["a", a]]), new Map([["a", changed]]));
    assert.equal(merged.find((entry) => entry.id === "a")?.content, unsent.content);
    assert(merged.some((entry) => entry.id === "b"));
    assert.equal((await readResearchWorkspace({ ...actor, memberId: "other" })).messages.length, 0);
    assert.equal((await readResearchWorkspace({ ...actor, notebookId: "other" })).messages.length, 0);
    assert.equal((await readResearchWorkspace({ ...actor, tenantId: "other" })).messages.length, 0);
    await mutateResearchWorkspace(actor, { action: "artifact", artifact: { stage: "design", title: "Research protocol fixture", content: "Recorded sample count: 50; no fabricated data.", sourceIds: [] } });
    const recorded = await readResearchWorkspace(actor);
    const context = await researchWritingContext(actor, [recorded.artifacts[0].id]);
    assert(context.text.includes("sample count: 50"));
    await assert.rejects(researchWritingContext({ ...actor, memberId: "other" }, [recorded.artifacts[0].id]), /不属于/);
    await assert.rejects(mutateResearchWorkspace(actor, { action: "clear", revision: initial.revision }), /已更新/);
    const cleared = await mutateResearchWorkspace(actor, { action: "clear", revision: recorded.revision });
    assert.equal(cleared.messages.length, 0); assert.equal(cleared.artifacts.length, 1);
    await assert.rejects(mutateResearchWorkspace(actor, { action: "merge", changes: [{ message: a, expectedDigest: null }] }), /已被清除/);
    assert.equal(mergeCloudHistory([a], cleared, new Map()).length, 0);
    assert.equal((await readResearchWorkspace(actor)).artifacts[0].authorId, actor.memberId);
    console.log("PASS: durable workspace isolation, concurrent append, stale update rejection, in-flight draft retention, record context scope, clear tombstones and artifact preservation");
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
