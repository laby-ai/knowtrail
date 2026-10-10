import assert from "node:assert/strict";
import { evidenceWindow } from "../src/lib/evidence-highlight";
import { searchLiterature } from "../src/lib/literature/providers";
import { signLiteratureResult, verifyLiteratureResult } from "../src/lib/literature/result-token";
async function main() {
  const text = "原文前缀。The result was\n  1.5% and <0.05. 原文后缀。";
  const window = evidenceWindow(text, "The result was 1.5% and <0.05.");
  assert(window.matched);
  assert(window.match.includes("\n  1.5% and <0.05."));
  assert(!evidenceWindow(text, "The result was 15% and <0.05.").matched);
  assert(!evidenceWindow(text, "1").matched);
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LITERATURE_HMAC_SECRET;
  const originalMode = process.env.APP_RUNTIME_ENV;
  try {
    process.env.LITERATURE_HMAC_SECRET = "isolated-provenance-test-key";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.crossref.org")) {
        assert(url.includes("type,is-referenced-by-count"));
        return Response.json({ message: { items: [{ title: ["Actual metadata fixture"], author: [{ family: "Tester", affiliation: [{ name: "Actual institution fixture" }] }], type: "journal-article", "is-referenced-by-count": 0, DOI: "10.1234/fixture" }] } });
      }
      return Response.json({ results: [{ title: "OpenAlex fixture", type: "review", cited_by_count: 12, authorships: [{ author: { display_name: "Tester" }, institutions: [{ display_name: "Institution fixture" }] }] }] });
    };
    const [crossref] = await searchLiterature("crossref", "qa", 1);
    assert.equal(crossref.evidenceScope, "metadata");
    assert.equal(crossref.citedByCount, 0);
    assert.equal(crossref.publicationType, "journal-article");
    assert.deepEqual(crossref.affiliations, ["Actual institution fixture"]);
    const restored = verifyLiteratureResult(signLiteratureResult(crossref));
    assert.deepEqual(restored?.affiliations, crossref.affiliations);
    assert.equal(restored?.citedByCount, 0);
    const [openalex] = await searchLiterature("openalex", "qa", 1);
    assert.equal(openalex.citedByCount, 12);
    assert.equal(openalex.publicationType, "review");
    assert.deepEqual(openalex.affiliations, ["Institution fixture"]);
    delete process.env.LITERATURE_HMAC_SECRET;
    process.env.APP_RUNTIME_ENV = "production";
    assert.throws(() => signLiteratureResult(crossref), /required in production/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LITERATURE_HMAC_SECRET; else process.env.LITERATURE_HMAC_SECRET = originalKey;
    if (originalMode === undefined) delete process.env.APP_RUNTIME_ENV; else process.env.APP_RUNTIME_ENV = originalMode;
  }
  console.log("PASS: original evidence alignment preserves facts and whitespace; real provider fields survive signed imports; absent abstracts remain metadata; production signing has no public fallback key");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
