import { XMLParser } from "fast-xml-parser";
import type { CslRun } from "./csl-contract";
export function cslRichText(html: string, fallback: string): CslRun[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(html) || html.length > 100000)
    return [{ text: fallback }];
  try {
    const parsed: unknown = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: false,
      parseTagValue: false,
      processEntities: true,
      unpairedTags: ["br"],
    }).parse("<root>" + html + "</root>");
    const runs: CslRun[] = [];
    function walk(nodes: unknown, flags: Omit<CslRun, "text">, depth: number) {
      if (!Array.isArray(nodes) || depth > 20) return;
      for (const raw of nodes) {
        if (!raw || typeof raw !== "object") continue;
        const node = raw as Record<string, unknown>;
        if (typeof node["#text"] === "string") {
          runs.push({ ...flags, text: node["#text"].replace(/\r?\n/g, " ") });
          continue;
        }
        for (const [tag, children] of Object.entries(node)) {
          if (tag === ":@") continue;
          const attrs =
            node[":@"] && typeof node[":@"] === "object"
              ? (node[":@"] as Record<string, unknown>)
              : {};
          const next = {
            ...flags,
            italic: flags.italic || tag === "i" || tag === "em",
            bold: flags.bold || tag === "b" || tag === "strong",
            superscript: flags.superscript || tag === "sup",
            smallCaps:
              flags.smallCaps ||
              (typeof attrs.style === "string" &&
                /font-variant:\s*small-caps/i.test(attrs.style)),
          };
          if (tag === "br") runs.push({ ...flags, text: " " });
          else walk(children, next, depth + 1);
        }
      }
    }
    walk(parsed, {}, 0);
    return runs.length && runs.length <= 2000 ? runs : [{ text: fallback }];
  } catch {
    return [{ text: fallback }];
  }
}
