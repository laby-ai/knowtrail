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
export interface FormattedReferences {
  styleId: CslStyleId;
  entries: Array<{ sourceId: string; text: string }>;
  groups: Array<{ markers: number[]; text: string }>;
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
      group.text,
    ]),
  );
  return content.replace(
    groupsPattern,
    (match) =>
      (groups.get(
        JSON.stringify(
          Array.from(match.matchAll(/\[(\d+)\]/g), (item) => Number(item[1])),
        ),
      ) || match.trim()) + (match.endsWith(" ") ? " " : ""),
  );
}
