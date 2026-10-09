import JSZip from "jszip";
import type { AcademicWritingDraft } from "./academic-writing-contract";
import type { Citation } from "@/types";
import type { JournalWordTemplate } from "./journal-word-template";

export type ManuscriptLayout = "single" | "double";
const xml = (value: string) =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
export const texEscape = (value: string) =>
  value.replace(
    /[\\{}$&#%_~^]/g,
    (char) =>
      ({
        "\\": "\\textbackslash{}",
        "{": "\\{",
        "}": "\\}",
        $: "\\$",
        "&": "\\&",
        "#": "\\#",
        "%": "\\%",
        _: "\\_",
        "~": "\\textasciitilde{}",
        "^": "\\textasciicircum{}",
      })[char]!,
  );
function paragraphText(text: string, markers: number[]) {
  return (
    text +
    markers
      .filter((number) => !text.includes(`[${number}]`))
      .map((number) => `[${number}]`)
      .join("")
  );
}
export function evidenceEntries(citations: Citation[]) {
  return citations.map((item, index) => ({
    number: index + 1,
    title:
      item.sourceTitle ||
      item.paperShortName ||
      item.paperId ||
      item.sourceId ||
      "来源名称未提供",
    locator: [
      item.page ? `第 ${item.page} 页` : "",
      typeof item.chunkIndex === "number" ? `片段 ${item.chunkIndex + 1}` : "",
    ]
      .filter(Boolean)
      .join("，"),
    excerpt: item.excerpt || item.snippet || "",
  }));
}

export function exportLatex(
  draft: AcademicWritingDraft,
  citations: Citation[],
  layout: ManuscriptLayout,
): string {
  return `\\documentclass[UTF8,a4paper${layout === "double" ? ",twocolumn" : ""}]{ctexart}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{hyperref}
\\title{${texEscape(draft.title)}}
\\author{}
\\date{}
\\begin{document}
\\maketitle
${draft.paragraphs.map((item) => texEscape(paragraphText(item.text, item.evidenceMarkers))).join("\n\n")}
\\section*{引用证据索引}
% 下列编号是检索片段索引，不是经过核验的完整书目。
${evidenceEntries(citations)
  .map(
    (item) =>
      `\\noindent [${item.number}] ${texEscape(item.title)} ${texEscape(item.locator)}\\par\n${texEscape(item.excerpt)}\\par`,
  )
  .join("\n")}
\\section*{作者核验事项}
${[...draft.limitations, ...draft.revisionChecklist].map(texEscape).join("\n\n")}
\\end{document}\n`;
}

function wordParagraph(text: string, style?: string, templateSpacing = false) {
  const runs = text
    .split(/(\[\d+\])/g)
    .map(
      (part) =>
        `<w:r>${/^\[\d+\]$/.test(part) ? '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' : ""}<w:t xml:space="preserve">${xml(part)}</w:t></w:r>`,
    )
    .join("");
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${xml(style)}"/>` : ""}${templateSpacing ? "" : '<w:spacing w:after="160" w:line="300" w:lineRule="auto"/>'}</w:pPr>${runs}</w:p>`;
}
export async function exportDocx(
  draft: AcademicWritingDraft,
  citations: Citation[],
  layout: ManuscriptLayout,
  template?: JournalWordTemplate | null,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file(
    "word/styles.xml",
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:sz w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:style></w:styles>',
  );
  if (template) {
    zip.file("word/styles.xml", template.stylesXml);
    let contentTypes = await zip.file("[Content_Types].xml")!.async("text");
    let relationships = await zip
      .file("word/_rels/document.xml.rels")!
      .async("text");
    if (template.themeXml) {
      zip.file("word/theme/theme1.xml", template.themeXml);
      contentTypes = contentTypes.replace(
        "</Types>",
        '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>',
      );
      relationships = relationships.replace(
        "</Relationships>",
        '<Relationship Id="templateTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>',
      );
    }
    if (template.numberingXml) {
      zip.file("word/numbering.xml", template.numberingXml);
      contentTypes = contentTypes.replace(
        "</Types>",
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
      );
      relationships = relationships.replace(
        "</Relationships>",
        '<Relationship Id="templateNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
      );
    }
    zip.file("[Content_Types].xml", contentTypes);
    zip.file("word/_rels/document.xml.rels", relationships);
  }
  const p = (text: string, heading = false) =>
    wordParagraph(
      text,
      template
        ? heading
          ? template.headingStyle
          : template.bodyStyle
        : heading
          ? "Heading1"
          : undefined,
      Boolean(template),
    );
  let title = wordParagraph(
    draft.title,
    template?.titleStyle || "Title",
    Boolean(template),
  );
  if (template?.columns === 2) {
    const titleSection = template.sectionXml
      .replace('<w:cols w:num="2"', '<w:cols w:num="1"')
      .replace("<w:sectPr>", '<w:sectPr><w:type w:val="continuous"/>');
    title = title.replace("</w:pPr>", `${titleSection}</w:pPr>`);
  }
  const body = [
    title,
    ...draft.paragraphs.map((item) =>
      p(paragraphText(item.text, item.evidenceMarkers)),
    ),
    p("引用证据索引", true),
    p("编号对应检索片段；完整参考文献与引用真实性需由作者核验。"),
    ...evidenceEntries(citations).flatMap((item) => [
      p(`[${item.number}] ${item.title} ${item.locator}`),
      p(item.excerpt),
    ]),
    p("作者核验事项", true),
    ...[...draft.limitations, ...draft.revisionChecklist].map((item) =>
      p(item),
    ),
  ].join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${template ? template.sectionXml.replace("<w:sectPr>", '<w:sectPr><w:type w:val="continuous"/>') : `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/><w:cols w:num="${layout === "double" ? 2 : 1}" w:space="420"/></w:sectPr>`}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
