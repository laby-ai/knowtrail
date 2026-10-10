import assert from "node:assert/strict";
import {
  auditFulltextCitations,
  applySemanticAudit,
} from "../src/lib/fulltext-citation-audit";
import type { StoredSourceRecord } from "../src/lib/ingestion-store";
const source: StoredSourceRecord = {
  id: "source",
  ownerMemberId: "owner",
  notebookId: "book",
  title: "Actual source",
  shortName: "Source",
  fileName: "qa.txt",
  fileType: "txt",
  status: "succeeded",
  createdAt: "",
  updatedAt: "",
  stages: [],
  chunkCount: 1,
  tokenEstimate: 10,
  vectorIndex: { status: "not_configured", updatedAt: "" },
  chunks: [
    {
      id: "chunk",
      sourceId: "source",
      sourceIndex: 0,
      chunkIndex: 0,
      page: 3,
      paperShortName: "Source",
      sourceTitle: "Actual source",
      tokenEstimate: 10,
      text: "The measured improvement was 20%, not 100%. The method is limited to this experiment.",
    },
  ],
};
const claims = [
  { text: "Measured improvement was 20%[1].", markers: [1] },
  { text: "All experiments improve by 100%[1].", markers: [1] },
  { text: "Uncited claim.", markers: [] },
  { text: "Invalid source[2-3].", markers: [] },
];
const citations = [
  {
    sourceId: "source",
    excerpt: "The measured improvement was 20%, not 100%.",
    page: 3,
    chunkIndex: 0,
  },
];
const report = auditFulltextCitations(claims, citations, [source]);
assert.equal(report.semanticStatus, "not-requested");
assert.equal(report.claims[0].findings.length, 0);
assert(!report.claims[1].semantic);
assert(report.claims[2].findings.includes("主张没有引用编号"));
assert(report.claims[3].findings.some((item) => item.includes("[2]")));
assert.equal(report.claims[0].sources[0].sha256.length, 64);
const reviewed = applySemanticAudit(report, [
  {
    index: 0,
    status: "supported",
    reason: "The quote contains 20%.",
    evidence: [{ sourceId: "source", quote: citations[0].excerpt }],
  },
  {
    index: 1,
    status: "supported",
    reason: "Fabricated proof.",
    evidence: [
      { sourceId: "source", quote: "Every experiment improves by 100%." },
    ],
  },
]);
assert.equal(reviewed.claims[0].semantic?.status, "supported");
assert.equal(reviewed.claims[1].semantic?.status, "insufficient");
assert.equal(reviewed.semanticStatus, "incomplete");
const wrong = auditFulltextCitations(
  [claims[0]],
  [{ ...citations[0], page: 4, chunkIndex: 2 }],
  [source],
);
assert(wrong.claims[0].findings.some((item) => item.includes("页码")));
assert(wrong.claims[0].findings.some((item) => item.includes("片段位置")));
const changed = auditFulltextCitations([claims[0]], citations, [
  {
    ...source,
    chunks: [{ ...source.chunks[0], text: "Changed original content only." }],
  },
]);
assert(!changed.claims[0].sources[0].quoteFound);
assert.notEqual(
  changed.claims[0].sources[0].sha256,
  report.claims[0].sources[0].sha256,
);
const abstract = {
  ...source,
  literature: {
    title: "Abstract",
    authors: [],
    year: 2020,
    abstract: source.chunks[0].text,
    venue: "",
    url: "",
    source: "crossref" as const,
    provider: "Crossref",
    evidenceScope: "abstract" as const,
    retrievedAt: "",
  },
};
const limited = applySemanticAudit(
  auditFulltextCitations([claims[0]], citations, [abstract]),
  [
    {
      index: 0,
      status: "supported",
      reason: "Only abstract.",
      evidence: [{ sourceId: "source", quote: citations[0].excerpt }],
    },
  ],
);
assert.equal(limited.claims[0].semantic?.status, "insufficient");
console.log(
  "PASS: exact stored quotes, ranges, wrong locators, absent citations, changed-source hashes, invented proof rejection and abstract/fulltext boundaries",
);
