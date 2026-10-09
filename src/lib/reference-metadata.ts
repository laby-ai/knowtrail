import type { CitationPaper } from "./literature/types";

export interface ReferenceMetadata {
  sourceId: string;
  paper: CitationPaper;
  kind: "journal-article" | "other";
  origin: "crossref" | "library";
  warnings: string[];
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 2000) : "";
const first = (value: unknown) => (Array.isArray(value) ? text(value[0]) : "");
export function referenceDoi(value: unknown): string | null {
  const doi = text(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  return /^10\.\d{4,9}\/[^\s<>"\\]+$/i.test(doi) && doi.length <= 255
    ? doi
    : null;
}
export function parseCrossrefReference(
  input: unknown,
  expectedDoi: string,
): CitationPaper & { kind: ReferenceMetadata["kind"] } {
  const item = record(record(input).message);
  if (
    referenceDoi(item.DOI)?.toLowerCase() !== expectedDoi.toLowerCase() ||
    !first(item.title)
  )
    throw new Error("DOI 题录不匹配");
  const dates =
    record(item.published)["date-parts"] || record(item.issued)["date-parts"];
  const year =
    Array.isArray(dates) &&
    Array.isArray(dates[0]) &&
    typeof dates[0][0] === "number"
      ? dates[0][0]
      : "";
  const authors = Array.isArray(item.author)
    ? item.author.slice(0, 200).flatMap((raw) => {
        const author = record(raw),
          family = text(author.family),
          given = text(author.given),
          name = family
            ? `${family}${given ? ", " + given : ""}`
            : text(author.name);
        return name ? [{ name }] : [];
      })
    : [];
  return {
    title: first(item.title),
    authors,
    year,
    venue: first(item["container-title"]),
    doi: expectedDoi,
    volume: text(item.volume),
    issue: text(item.issue),
    pages: text(item.page) || text(item["article-number"]),
    publisher: text(item.publisher),
    url: `https://doi.org/${expectedDoi}`,
    kind: item.type === "journal-article" ? "journal-article" : "other",
  };
}
export function missingReferenceFields(paper: CitationPaper): string[] {
  return [
    !paper.title && "标题缺失",
    !paper.authors.length && "作者缺失",
    !paper.year && "发表年份缺失",
    !paper.venue && "刊物或载体缺失",
    !paper.doi && !paper.url && "DOI 或来源地址缺失",
  ].filter((item): item is string => Boolean(item));
}
function bibValue(value: string) {
  const specials: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };
  return value
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[\\{}%$&#_~^]/g, (char) => specials[char] || "\\" + char);
}
export function referencesBibtex(items: ReferenceMetadata[]): string {
  return items
    .map((item, index) => {
      const paper = item.paper;
      const fields: Array<[string, string]> = [
        ["title", paper.title],
        [
          "author",
          paper.authors.map((author) => bibValue(author.name)).join(" and "),
        ],
        ["year", String(paper.year || "")],
        ["journal", paper.venue || ""],
        ["volume", paper.volume || ""],
        ["number", paper.issue || ""],
        ["pages", paper.pages || ""],
        ["doi", paper.doi || ""],
        ["url", paper.url || ""],
      ];
      return `% ${item.origin}; ${item.warnings.join("; ") || "Please verify against the original publication."}\n@${item.kind === "journal-article" ? "article" : "misc"}{lingbiRef${index + 1},\n${fields
        .filter(([, value]) => value)
        .map(
          ([key, value]) =>
            `  ${key} = {${key === "author" ? value : bibValue(value)}}`,
        )
        .join(",\n")}\n}`;
    })
    .join("\n\n");
}
