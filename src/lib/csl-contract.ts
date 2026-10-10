import type { AcademicWritingDraft } from "./academic-writing-contract";
export const CSL_STYLES = [
  { id: "ieee", label: "IEEE", file: "ieee" },
  { id: "apa", label: "APA 7", file: "apa" },
  { id: "vancouver", label: "Vancouver / NLM", file: "nlm-citation-sequence" },
  {
    id: "gbt2015",
    label: "GB/T 7714—2015（顺序编码）",
    file: "china-national-standard-gb-t-7714-2015-numeric",
  },
  {
    id: "gbt2025",
    label: "GB/T 7714—2025（顺序编码）",
    file: "china-national-standard-gb-t-7714-2025-numeric",
  },
  { id: "nature", label: "Nature", file: "nature" },
  { id: "science", label: "Science", file: "science" },
  { id: "plos", label: "PLOS", file: "plos" },
  { id: "cell", label: "Cell", file: "cell" },
] as const;
export type CslStyleId = (typeof CSL_STYLES)[number]["id"];
export interface CslRun {
  text: string;
  italic?: boolean;
  bold?: boolean;
  superscript?: boolean;
  smallCaps?: boolean;
}
export interface FormattedReferences {
  styleId: CslStyleId;
  hangingIndent?: boolean;
  entries: Array<{ sourceId: string; text: string; runs?: CslRun[] }>;
  groups: Array<{ markers: number[]; text: string; superscript?: boolean }>;
}
export function markedParagraph(text: string, markers: number[]) {
  return (
    text +
    markers
      .filter((number) => !text.includes(`[${number}]`))
      .map((number) => `[${number}]`)
      .join("")
  );
}
const groupsPattern = /(?:\[\d+\]\s*)+/g;
function formattedGroupText(
  content: string,
  offset: number,
  group: FormattedReferences["groups"][number],
) {
  const space = !group.superscript && /^[([]/.test(group.text) &&
    /[A-Za-z0-9%)]/.test(content[offset - 1] || "") ? " " : "";
  return space + group.text;
}
export function citationGroups(draft: AcademicWritingDraft): number[][] {
  const groups = draft.paragraphs.flatMap((item) =>
    Array.from(
      markedParagraph(item.text, item.evidenceMarkers).matchAll(groupsPattern),
      (match) =>
        Array.from(match[0].matchAll(/\[(\d+)\]/g), (number) =>
          Number(number[1]),
        ),
    ),
  );
  return [
    ...new Map(groups.map((group) => [JSON.stringify(group), group])).values(),
  ];
}
export function applyCitationStyle(
  text: string,
  markers: number[],
  formatted?: FormattedReferences | null,
) {
  const content = markedParagraph(text, markers);
  if (!formatted) return content;
  const groups = new Map(
    formatted.groups.map((group) => [
      JSON.stringify(group.markers),
      group,
    ]),
  );
  return content.replace(
    groupsPattern,
    (match, offset: number) => {
      const group = groups.get(
        JSON.stringify(
          Array.from(match.matchAll(/\[(\d+)\]/g), (item) => Number(item[1])),
        ),
      );
      return (group ? formattedGroupText(content, offset, group) : match.trim()) +
        (match.match(/\s*$/)?.[0] || "");
    },
  );
}
export function citationRuns(
  text: string,
  markers: number[],
  formatted: FormattedReferences,
): CslRun[] {
  const content = markedParagraph(text, markers),
    result: CslRun[] = [];
  let offset = 0;
  const groups = new Map(
    formatted.groups.map((group) => [JSON.stringify(group.markers), group]),
  );
  for (const match of content.matchAll(groupsPattern)) {
    if (match.index > offset)
      result.push({ text: content.slice(offset, match.index) });
    const group = groups.get(
      JSON.stringify(
        Array.from(match[0].matchAll(/\[(\d+)\]/g), (item) => Number(item[1])),
      ),
    );
    result.push({
      text: group ? formattedGroupText(content, match.index, group) : match[0].trim(),
      superscript: group?.superscript,
    });
    const whitespace = match[0].match(/\s*$/)?.[0];
    if (whitespace) result.push({ text: whitespace });
    offset = match.index + match[0].length;
  }
  if (offset < content.length) result.push({ text: content.slice(offset) });
  return result;
}
