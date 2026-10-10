import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  CSL_STYLES,
  applyCitationStyle,
  citationGroups,
} from "../src/lib/csl-contract";
import { formatCslReferences } from "../src/lib/csl-formatter";
import { cslRichText } from "../src/lib/csl-rich-text";
import { exportDocx, exportLatex } from "../src/lib/manuscript-export";
import type { ReferenceMetadata } from "../src/lib/reference-metadata";
import type { AcademicWritingDraft } from "../src/lib/academic-writing-contract";
async function main() {
  const items: ReferenceMetadata[] = [
    {
      sourceId: "b",
      kind: "journal-article",
      origin: "crossref",
      warnings: [],
      paper: {
        title: "Validated results",
        authors: [{ name: "Smith, John" }],
        year: 2020,
        venue: "Actual Journal",
        volume: "3",
        issue: "2",
        pages: "10-20",
        doi: "10.1234/b",
      },
    },
    {
      sourceId: "a",
      kind: "journal-article",
      origin: "crossref",
      warnings: [],
      paper: {
        title: "Earlier work",
        authors: [{ name: "Adams, Jane" }],
        year: 2019,
        venue: "Evidence Journal",
        pages: "1-4",
        doi: "10.1234/a",
      },
    },
    {
      sourceId: "unused",
      kind: "other",
      origin: "library",
      warnings: [],
      paper: { title: "Unused", authors: [], year: "" },
    },
  ];
  const draft: AcademicWritingDraft = {
    title: "CSL citation and typography verification",
    targetSection: "introduction",
    outline: [],
    paragraphs: [
      {
        role: "evidence",
        text: "Result <0.05 and 50% remains unchanged[1].\nRepeated evidence[2] supports the same publication.",
        evidenceMarkers: [1, 2],
        supportStatus: "supported",
      },
      {
        role: "limitation",
        text: "Earlier work[3] has a different context.",
        evidenceMarkers: [3],
        supportStatus: "supported",
      },
    ],
    claimEvidenceMap: [],
    limitations: ["QA only."],
    revisionChecklist: ["Verify original source."],
  };
  const citations = [
    {
      paperId: "b",
      paperShortName: "Source",
      excerpt: "First verified source.",
    },
    {
      paperId: "b",
      paperShortName: "Source",
      excerpt: "Second verified source.",
    },
    {
      paperId: "a",
      paperShortName: "Earlier",
      excerpt: "Earlier verified source.",
    },
  ];
  for (const style of CSL_STYLES) {
    const formatted = await formatCslReferences(
      items,
      style.id,
      citationGroups(draft),
      ["b", "b", "a"],
    );
    assert.equal(formatted.entries.length, 2);
    assert(!formatted.entries.some((item) => item.sourceId === "unused"));
    assert(formatted.entries.every((item) => item.runs?.length));
    assert(formatted.entries.every((item) => !/^\s/.test(item.runs!.map((run) => run.text).join(""))));
    assert(formatted.entries.every((item) => !/^(\[\d+\]|\d+\.)(?=\S)/.test(item.runs!.map((run) => run.text).join(""))));
    const body = applyCitationStyle(
      draft.paragraphs[0].text,
      [1, 2],
      formatted,
    );
    assert(body.includes("<0.05 and 50%"));
    assert(body.includes("\nRepeated evidence"));
    if (style.id === "ieee") {
      assert.equal(formatted.groups[0].text, "[1]");
      assert.equal(formatted.groups[1].text, "[1]");
      assert(formatted.entries[0].text.includes("J. Smith"));
      assert(!formatted.entries[0].text.includes("J. S. Smith"));
      assert(formatted.entries[0].runs!.map((run) => run.text).join("").includes("[1] J. Smith"));
      assert(body.includes("unchanged [1]"));
      assert(
        formatted.entries.some((item) => item.runs?.some((run) => run.italic)),
      );
    }
    if (style.id === "apa") {
      assert.equal(formatted.entries[0].sourceId, "a");
      assert(formatted.groups[0].text.includes("Smith"));
      assert(formatted.groups[0].text.includes("2020"));
      assert(formatted.hangingIndent);
      assert(body.includes("unchanged (Smith"));
    }
    if (style.id === "nature" || style.id === "gbt2015")
      assert(formatted.groups[0].superscript);
    const bytes = await exportDocx(draft, citations, {
      layout: "single",
      references: items,
      formatted,
      mode: "manuscript",
    });
    const zip = await JSZip.loadAsync(bytes),
      document = await zip.file("word/document.xml")!.async("text");
    assert(document.includes("Actual Journal"));
    assert(!document.includes("Evidence index"));
    assert(!document.includes("QA only."));
    assert(document.includes("50%"));
    assert(document.includes("&lt;0.05"));
    if (formatted.hangingIndent) assert(document.includes('w:hanging="720"'));
    if (style.id === "ieee") {
      assert(document.includes("<w:i/>"));
      assert(!document.includes("w:vertAlign"));
    }
    if (style.id === "nature") assert(document.includes("w:vertAlign"));
    const tex = exportLatex(draft, citations, {
      layout: "single",
      formatted,
      mode: "manuscript",
    });
    assert(!tex.includes("引用证据索引"));
    assert(tex.includes("50\\%"));
    if (formatted.hangingIndent) assert(tex.includes("\\hangindent=1.27cm"));
    if (style.id === "ieee") assert(tex.includes("\\textit{"));
    if (
      process.argv[2] &&
      ["ieee", "apa", "nature", "gbt2015"].includes(style.id)
    ) {
      await mkdir(process.argv[2], { recursive: true });
      await writeFile(
        path.join(process.argv[2], `csl-${style.id}.docx`),
        bytes,
      );
    }
  }
  await assert.rejects(formatCslReferences(items, "ieee", [[4]], ["b"]));
  const runs = cslRichText(
    '<div><i>Journal</i><a href="javascript:bad()">link</a><sup>2</sup></div>',
    "fallback",
  );
  assert(runs.some((run) => run.italic && run.text === "Journal"));
  assert(runs.some((run) => run.superscript));
  assert(!JSON.stringify(runs).includes("javascript"));
  assert.deepEqual(cslRichText("<!DOCTYPE a><root>bad</root>", "safe"), [
    { text: "safe" },
  ]);
  console.log(
    "PASS: nine pinned CSL styles, repeat/unused references, author-date ordering, initials, italic/superscript, facts and actual DOCX/LaTeX",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
