import assert from "node:assert/strict";
import JSZip from "jszip";
import { writeFile } from "node:fs/promises";
import { exportDocx, exportLatex } from "../src/lib/manuscript-export";
import type { AcademicWritingDraft } from "../src/lib/academic-writing-contract";
import {
  referenceDoi,
  parseCrossrefReference,
  missingReferenceFields,
  referencesBibtex,
} from "../src/lib/reference-metadata";
assert.equal(
  referenceDoi("https://doi.org/10.1234/example"),
  "10.1234/example",
);
assert.equal(referenceDoi("https://attacker.invalid/x"), null);
const paper = parseCrossrefReference(
  {
    message: {
      DOI: "10.1234/example",
      type: "journal-article",
      title: ["Test & {escaped}"],
      author: [{ family: "Smith", given: "John" }],
      published: { "date-parts": [[2020, 1, 2]] },
      "container-title": ["Actual Journal"],
      volume: "4",
      issue: "2",
      page: "10-18",
    },
  },
  "10.1234/example",
);
assert.deepEqual(paper.authors, [{ name: "Smith, John" }]);
assert.equal(paper.year, 2020);
assert.equal(paper.pages, "10-18");
assert.throws(() =>
  parseCrossrefReference(
    { message: { DOI: "10.1234/other", title: ["Mismatch"] } },
    "10.1234/example",
  ),
);
assert.throws(() =>
  parseCrossrefReference(
    { message: { DOI: "10.1234/example", title: [] } },
    "10.1234/example",
  ),
);
assert.deepEqual(missingReferenceFields(paper), []);
const minimal = { title: "Uploaded note", authors: [], year: "" };
assert(missingReferenceFields(minimal).includes("作者缺失"));
const bib = referencesBibtex([
  { sourceId: "a", paper, kind: paper.kind, origin: "crossref", warnings: [] },
  {
    sourceId: "b",
    paper: minimal,
    kind: "other",
    origin: "library",
    warnings: ["作者缺失"],
  },
]);
assert.match(bib, /@article\{lingbiRef1/);
assert.match(bib, /@misc\{lingbiRef2/);
assert.match(bib, /author = \{Smith, John\}/);
assert.match(bib, /Test \\& \\\{escaped\\\}/);
assert(!bib.includes("Unknown Author"));
assert(!bib.includes("year = {0}"));
console.log(
  "PASS: exact DOI identity, structured author names, dates, missing fields, BibTeX escaping and truthful publication type",
);
async function checkExports() {
  const draft: AcademicWritingDraft = {
    title: "参考文献题录导出验收",
    targetSection: "introduction",
    outline: [],
    paragraphs: [
      {
        role: "evidence",
        text: "保留原文证据编号[1]，题录使用独立编号。",
        evidenceMarkers: [1],
        supportStatus: "supported",
      },
    ],
    claimEvidenceMap: [],
    limitations: ["仅用于文件格式验收。"],
    revisionChecklist: ["核对原文。"],
  };
  const citations = [
    {
      paperId: "a",
      paperShortName: "来源",
      excerpt: "真实字段与证据片段分开保存。",
      page: 2,
    },
  ];
  const references = [
    {
      sourceId: "a",
      paper,
      kind: paper.kind,
      origin: "crossref" as const,
      warnings: [],
    },
  ];
  const bytes = await exportDocx(draft, citations, {
    layout: "single",
    references,
  });
  const zip = await JSZip.loadAsync(bytes),
    document = await zip.file("word/document.xml")!.async("text");
  assert(document.includes("[R1]"));
  assert(document.includes("Smith, John"));
  assert(document.includes("10-18"));
  assert(document.includes("Test &amp; {escaped}"));
  assert(document.includes("对应证据编号："));
  assert(document.includes("第 2 页"));
  const tex = exportLatex(draft, citations, { layout: "single", references });
  assert(tex.includes("[R1]"));
  assert(tex.includes("Test \\& \\{escaped\\}"));
  assert(tex.includes("10.1234/example"));
  if (process.argv[2]) await writeFile(process.argv[2], bytes);
  console.log(
    "PASS: actual DOCX/LaTeX contain resolved metadata and preserve evidence-to-reference mapping",
  );
}
void checkExports().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
