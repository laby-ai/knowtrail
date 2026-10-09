import assert from "node:assert/strict";
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
