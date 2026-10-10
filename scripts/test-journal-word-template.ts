import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { inspectJournalWordTemplate } from "../src/lib/journal-word-template";
import { exportDocx } from "../src/lib/manuscript-export";
import type { AcademicWritingDraft } from "../src/lib/academic-writing-contract";
async function main() {
  const draft: AcademicWritingDraft = {
    title: "Evidence based manuscript template verification",
    targetSection: "introduction",
    outline: [],
    paragraphs: [
      {
        role: "evidence",
        text: "This is an isolated formatting test. The evidence marker must be preserved[1].",
        evidenceMarkers: [1],
        supportStatus: "supported",
      },
      {
        role: "limitation",
        text: "Template instructions and example author details are excluded from the generated body.",
        evidenceMarkers: [],
        supportStatus: "needs-evidence",
      },
    ],
    claimEvidenceMap: [],
    limitations: ["The author must verify citations and journal requirements."],
    revisionChecklist: ["Complete the author information before submission."],
  };
  const citations = [
    {
      paperId: "qa-source",
      paperShortName: "QA source",
      excerpt: "This excerpt is isolated verification material.",
      page: 3,
    },
  ];
  const base = await exportDocx(draft, citations, "double");
  const template = await inspectJournalWordTemplate(
    base,
    "Generic test template",
  );
  assert.equal(template.columns, 2);
  assert.equal(template.titleStyle, "Title");
  const out = await exportDocx(draft, citations, {
    layout: "single",
    template,
  });
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file("word/document.xml")!.async("text");
  assert(xml.includes('w:num="2"'));
  assert(xml.includes('w:num="1"'));
  assert.equal(
    await zip.file("word/styles.xml")!.async("text"),
    template.stylesXml,
  );
  await assert.rejects(
    inspectJournalWordTemplate(new Uint8Array(6 * 1024 * 1024), "too large"),
    /5 MB/,
  );
  const bad = await JSZip.loadAsync(base);
  bad.file(
    "word/styles.xml",
    '<!DOCTYPE styles [<!ENTITY external SYSTEM "file:///etc/passwd">]><styles/>',
  );
  await assert.rejects(
    inspectJournalWordTemplate(
      await bad.generateAsync({ type: "uint8array" }),
      "bad",
    ),
    /XML/,
  );
  const invalidLayout = await JSZip.loadAsync(base);
  const document = await invalidLayout.file("word/document.xml")!.async("text");
  invalidLayout.file(
    "word/document.xml",
    document.replace('w:num="2"', 'w:num="3"'),
  );
  await assert.rejects(
    inspectJournalWordTemplate(
      await invalidLayout.generateAsync({ type: "uint8array" }),
      "invalid columns",
    ),
    /参数无效/,
  );
  if (process.argv[2]) {
    const official = await inspectJournalWordTemplate(
      await readFile(process.argv[2]),
      "IEEE Access official",
    );
    assert.equal(official.titleStyle, "PaperTitle");
    assert.equal(official.bodyStyle, "PARA");
    assert.equal(official.columns, 2);
    const output = await exportDocx(draft, citations, {
      layout: "single",
      template: official,
    });
    const applied = await JSZip.loadAsync(output);
    const body = await applied.file("word/document.xml")!.async("text");
    assert(body.includes('w:w="11520"'));
    assert(body.includes('w:h="15660"'));
    assert(body.includes('w:pStyle w:val="PaperTitle"'));
    assert(body.includes('w:pStyle w:val="PARA"'));
    assert(!body.includes("First A. Author"));
    assert(!body.includes("Doi Number"));
    assert(!body.includes("xxxx"));
    assert(applied.file("word/theme/theme1.xml"));
    assert(applied.file("word/numbering.xml"));
    if (process.argv[3]) await writeFile(process.argv[3], output);
  }
  console.log(
    "PASS: imported styles, actual paper dimensions, columns, title section, source boilerplate removal and bounded XML validation",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
