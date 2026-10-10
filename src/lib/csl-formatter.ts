import { readFile } from "node:fs/promises";
import path from "node:path";
import CSL from "citeproc";
import { cslRichText } from "./csl-rich-text";
import {
  CSL_STYLES,
  type CslStyleId,
  type FormattedReferences,
} from "./csl-contract";
import type { ReferenceMetadata } from "./reference-metadata";
const root = () => path.join(process.cwd(), "src/assets/csl");
export async function formatCslReferences(
  items: ReferenceMetadata[],
  styleId: CslStyleId,
  markers: number[][],
  citationSourceIds: string[],
): Promise<FormattedReferences> {
  const style = CSL_STYLES.find((item) => item.id === styleId);
  if (!style) throw new Error("不支持的 CSL 样式");
  const [xml, en, gb, zh] = await Promise.all([
    readFile(path.join(root(), style.file + ".csl"), "utf8"),
    readFile(path.join(root(), "locales-en-US.xml"), "utf8"),
    readFile(path.join(root(), "locales-en-GB.xml"), "utf8"),
    readFile(path.join(root(), "locales-zh-CN.xml"), "utf8"),
  ]);
  const data = new Map(
    items.map((item) => {
      const paper = item.paper,
        year = Number(paper.year);
      return [
        item.sourceId,
        {
          id: item.sourceId,
          type:
            item.kind === "journal-article" ? "article-journal" : "document",
          title: paper.title,
          author: paper.authors.map((author) => {
            const parts = author.name.split(",");
            return parts.length === 2
              ? { family: parts[0].trim(), given: parts[1].trim() }
              : { literal: author.name };
          }),
          ...(Number.isInteger(year) && year >= 1000 && year <= 9999
            ? { issued: { "date-parts": [[year]] } }
            : {}),
          "container-title": paper.venue,
          volume: paper.volume,
          issue: paper.issue,
          page: paper.pages,
          DOI: paper.doi,
          URL: paper.url,
          publisher: paper.publisher,
        },
      ];
    }),
  );
  const engine = new CSL.Engine(
    {
      retrieveLocale: (language) =>
        language.startsWith("zh") ? zh : language === "en-GB" ? gb : en,
      retrieveItem: (id) => {
        const item = data.get(id);
        if (!item) throw new Error("题录来源不存在");
        return item;
      },
    },
    xml,
    styleId.startsWith("gbt") ? "zh-CN" : "en-US",
  );
  const usedIds = [
    ...new Set(
      markers.flatMap((group) =>
        group.map((number) => citationSourceIds[number - 1]),
      ),
    ),
  ];
  if (!usedIds.length || usedIds.some((id) => !id || !data.has(id)))
    throw new Error("正文缺少有效引用");
  engine.setOutputFormat("text");
  engine.updateItems(usedIds);
  const groups = markers.map((group) => {
    const ids = [
      ...new Set(group.map((number) => citationSourceIds[number - 1])),
    ];
    if (!ids.length || ids.some((id) => !id || !data.has(id)))
      throw new Error("正文引用编号没有匹配题录");
    return {
      markers: group,
      text: engine.makeCitationCluster(ids.map((id) => ({ id }))),
      superscript: /vertical-align="sup"/.test(
        xml.match(/<citation\b[\s\S]*?<\/citation>/)?.[0] || "",
      ),
    };
  });
  const bibliography = engine.makeBibliography();
  if (!bibliography) throw new Error("CSL 样式没有参考文献输出");
  engine.setOutputFormat("html");
  const rich = engine.makeBibliography();
  return {
    styleId,
    groups,
    entries: bibliography[1].map((text, index) => ({
      sourceId: bibliography[0].entry_ids[index][0],
      text: text.trim(),
      runs: cslRichText(rich ? rich[1][index] : "", text.trim()),
    })),
  };
}
