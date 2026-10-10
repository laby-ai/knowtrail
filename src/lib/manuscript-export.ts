import JSZip from "jszip";
import type { AcademicWritingDraft } from "./academic-writing-contract";
import type { Citation } from "@/types";
import type { JournalWordTemplate } from "./journal-word-template";
import type { ResearchArtifact } from "./research-workspace-contract";
import {
  applyCitationStyle,
  citationRuns,
  type CslRun,
  type FormattedReferences,
} from "./csl-contract";
import {
  referencePlainText,
  type ReferenceMetadata,
} from "./reference-metadata";

export type ManuscriptLayout = "single" | "double";
export interface ManuscriptExportOptions {
  layout: ManuscriptLayout;
  template?: JournalWordTemplate | null;
  references?: ReferenceMetadata[];
  formatted?: FormattedReferences | null;
  mode?: "audit" | "manuscript";
  researchRecords?: ResearchArtifact[];
}
function recordReference(record: ResearchArtifact, index: number) {
  return `[研究记录${index + 1}] ${record.title}；记录 ID：${record.id}；${record.analysis ? `真实统计执行结果；分析 ID：${record.analysis.id}；原文件 SHA-256：${record.analysis.sourceFileSha256}` : "用户研究记录，未作科学真实性认证"}`;
}
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
export function evidenceEntries(citations: Citation[], english = false) {
  return citations.map((item, index) => ({
    number: index + 1,
    title:
      item.sourceTitle ||
      item.paperShortName ||
      item.paperId ||
      item.sourceId ||
      "来源名称未提供",
    locator: [
      item.page ? (english ? `p. ${item.page}` : `第 ${item.page} 页`) : "",
      typeof item.chunkIndex === "number"
        ? english
          ? `chunk ${item.chunkIndex + 1}`
          : `片段 ${item.chunkIndex + 1}`
        : "",
    ]
      .filter(Boolean)
      .join("，"),
    excerpt: item.excerpt || item.snippet || "",
  }));
}

export function exportLatex(
  draft: AcademicWritingDraft,
  citations: Citation[],
  options: ManuscriptLayout | ManuscriptExportOptions,
): string {
  const {
    layout,
    references = [],
    formatted,
    mode = "audit",
    researchRecords = [],
  } = typeof options === "string" ? { layout: options } : options;
  if (mode === "manuscript" && !formatted)
    throw new Error("论文正文模式需先应用引用格式。");
  const appendix =
    mode === "audit"
      ? `\\section*{引用证据索引}\n% 下列编号是检索片段索引，不是经过核验的完整书目。\n${evidenceEntries(
          citations,
        )
          .map(
            (item) =>
              `\\noindent [${item.number}] ${texEscape(item.title)} ${texEscape(item.locator)}\\par\n${texEscape(item.excerpt)}\\par`,
          )
          .join(
            "\n",
          )}\n\\section*{作者核验事项}\n${[...draft.limitations, ...draft.revisionChecklist].map(texEscape).join("\n\n")}\n${references.length ? "\\section*{参考文献题录}\n" + references.map((item, index) => `\\noindent [R${index + 1}] ${texEscape(referencePlainText(item))}\\par\n${texEscape(item.warnings.join("; "))}\\par`).join("\n") : ""}`
      : "";
  return `\\documentclass[UTF8,a4paper${layout === "double" ? ",twocolumn" : ""}]{ctexart}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{hyperref}
\\title{${texEscape(draft.title)}}
\\author{}
\\date{}
\\begin{document}
\\maketitle
${draft.paragraphs.map((item) => (formatted ? citationRuns(item.text, item.evidenceMarkers, formatted).map(styledTex).join("") : texEscape(applyCitationStyle(item.text, item.evidenceMarkers)))).join("\n\n")}
${appendix}
${formatted ? "\\section*{参考文献}\n" + formatted.entries.map((item) => `${formatted.hangingIndent ? "\\hangindent=1.27cm\\hangafter=1 " : ""}\\noindent ${(item.runs || [{ text: item.text }]).map(styledTex).join("")}\\par`).join("\n") : ""}
${researchRecords.length ? "\\section*{研究记录与数据结果来源}\n" + researchRecords.map((record, index) => "\\noindent " + texEscape(recordReference(record, index)) + "\\par").join("\n") : ""}
\\end{document}\n`;
}
function styledTex(run: CslRun): string {
  let text = texEscape(run.text);
  if (run.italic) text = `\\textit{${text}}`;
  if (run.bold) text = `\\textbf{${text}}`;
  if (run.smallCaps) text = `\\textsc{${text}}`;
  if (run.superscript) text = `\\textsuperscript{${text}}`;
  return text;
}

function wordParagraph(
  text: string,
  style?: string,
  templateSpacing = false,
  superscript = true,
  richRuns?: CslRun[],
  hangingIndent = false,
) {
  const parts: CslRun[] =
    richRuns ||
    text.split(/(\[\d+\])/g).map((part) => ({
      text: part,
      superscript: superscript && /^\[\d+\]$/.test(part),
    }));
  const runs = parts
    .map(
      (part) =>
        `<w:r><w:rPr>${part.superscript ? '<w:vertAlign w:val="superscript"/>' : ""}${part.italic ? "<w:i/>" : ""}${part.bold ? "<w:b/>" : ""}${part.smallCaps ? "<w:smallCaps/>" : ""}</w:rPr><w:t xml:space="preserve">${xml(part.text)}</w:t></w:r>`,
    )
    .join("");
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${xml(style)}"/>` : ""}${hangingIndent ? '<w:ind w:left="720" w:hanging="720"/>' : ""}${templateSpacing ? "" : '<w:spacing w:after="160" w:line="300" w:lineRule="auto"/>'}</w:pPr>${runs}</w:p>`;
}
export async function exportDocx(
  draft: AcademicWritingDraft,
  citations: Citation[],
  options: ManuscriptLayout | ManuscriptExportOptions,
): Promise<Uint8Array> {
  const {
    layout,
    template,
    references = [],
    formatted,
    mode = "audit",
    researchRecords = [],
  } = typeof options === "string" ? { layout: options } : options;
  if (mode === "manuscript" && !formatted)
    throw new Error("论文正文模式需先应用引用格式。");
  const english = !/[\u3400-\u9fff]/.test(
    draft.title + draft.paragraphs.map((item) => item.text).join(""),
  );
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
      wordParagraph(
        applyCitationStyle(item.text, item.evidenceMarkers, formatted),
        template?.bodyStyle,
        Boolean(template),
        !formatted,
        formatted
          ? citationRuns(item.text, item.evidenceMarkers, formatted)
          : undefined,
      ),
    ),
    ...(mode === "audit"
      ? [
          p(english ? "Evidence index" : "引用证据索引", true),
          p(
            english
              ? "Numbers identify retrieved excerpts. The author must verify the complete references and original sources."
              : "编号对应检索片段；完整参考文献与引用真实性需由作者核验。",
          ),
          ...evidenceEntries(citations, english).flatMap((item) => [
            p(`[${item.number}] ${item.title} ${item.locator}`),
            p(item.excerpt),
          ]),
          p(english ? "Author verification checklist" : "作者核验事项", true),
          ...[...draft.limitations, ...draft.revisionChecklist].map((item) =>
            p(item),
          ),
          ...(references.length
            ? [
                p(english ? "Bibliographic metadata" : "参考文献题录", true),
                ...references.flatMap((item, index) => [
                  p(`[R${index + 1}] ${referencePlainText(item)}`),
                  p(
                    (english ? "Evidence markers: " : "对应证据编号：") +
                      citations
                        .flatMap((citation, number) =>
                          (citation.sourceId || citation.paperId) ===
                          item.sourceId
                            ? [`[${number + 1}]`]
                            : [],
                        )
                        .join(", "),
                  ),
                  ...item.warnings.map((warning) => p(warning)),
                ]),
              ]
            : []),
        ]
      : []),
    ...(formatted
      ? [
          p(english ? "References" : "参考文献", true),
          ...formatted.entries.map((item) =>
            wordParagraph(
              item.text,
              template?.bodyStyle,
              Boolean(template),
              false,
              item.runs,
              formatted.hangingIndent,
            ),
          ),
        ]
      : []),
    ...(researchRecords.length ? [p("研究记录与数据结果来源", true), ...researchRecords.map((record, index) => p(recordReference(record, index)))] : []),
  ].join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${template ? template.sectionXml.replace("<w:sectPr>", '<w:sectPr><w:type w:val="continuous"/>') : `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/><w:cols w:num="${layout === "double" ? 2 : 1}" w:space="420"/></w:sectPr>`}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
