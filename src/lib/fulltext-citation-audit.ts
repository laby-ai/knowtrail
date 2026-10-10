import { createHash } from "node:crypto";
import type { StoredSourceRecord } from "./ingestion-store";
export interface AuditCitation {
  sourceId: string;
  excerpt: string;
  chunkIndex?: number;
  page?: number;
}
export interface AuditClaim {
  text: string;
  markers: number[];
}
export interface AuditedClaim {
  index: number;
  text: string;
  markers: number[];
  findings: string[];
  sources: Array<{
    sourceId: string;
    title: string;
    scope: string;
    sha256: string;
    quoteFound: boolean;
    quotes: Array<{ text: string; page?: number; chunkIndex: number }>;
  }>;
  semantic?: {
    status: "supported" | "partial" | "contradicted" | "insufficient";
    reason: string;
    evidence: Array<{ sourceId: string; quote: string }>;
  };
}
export interface FulltextAuditReport {
  at: string;
  claims: AuditedClaim[];
  coverage: string;
  semanticStatus: "not-requested" | "complete" | "incomplete";
}
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export function auditFulltextCitations(
  claims: AuditClaim[],
  citations: AuditCitation[],
  sources: StoredSourceRecord[],
): FulltextAuditReport {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const prepared = new Map(
    sources.map((source) => [
      source.id,
      {
        hash: createHash("sha256")
          .update(source.chunks.map((chunk) => chunk.text).join("\n"))
          .digest("hex"),
        chunks: source.chunks.map((chunk) => ({
          chunk,
          normalized: normalize(chunk.text),
        })),
      },
    ]),
  );
  return {
    at: new Date().toISOString(),
    semanticStatus: "not-requested",
    coverage:
      "原文存在性检查覆盖已持久化的全部解析片段；不等于 PDF 图片、未解析页面或未获取全文已核验。语义评审只读取下列实际原文片段，不能替代作者复核。",
    claims: claims.map((claim, index) => {
      const textMarkers = Array.from(
        claim.text.matchAll(/\[(\d+)(?:[-–](\d+))?\]/g),
      ).flatMap((match) => {
        const first = Number(match[1]),
          last = Number(match[2] || match[1]);
        return first <= last && first >= 1 && last <= 100
          ? Array.from(
              { length: last - first + 1 },
              (_, index) => first + index,
            )
          : [first, last, 101];
      });
      const markers = [...new Set([...claim.markers, ...textMarkers])];
      const findings: string[] = [],
        matches: AuditedClaim["sources"] = [];
      if (!markers.length) findings.push("主张没有引用编号");
      for (const marker of markers) {
        const citation = citations[marker - 1];
        if (!citation) {
          findings.push(`引用编号 [${marker}] 没有匹配来源`);
          continue;
        }
        const source = byId.get(citation.sourceId),
          data = prepared.get(citation.sourceId);
        if (!source || !data) {
          findings.push(`[${marker}] 来源已移除或无权读取`);
          continue;
        }
        const scope = source.literature?.evidenceScope || "parsed-document";
        if (scope === "metadata" || scope === "abstract")
          findings.push(
            `[${marker}] 只有${scope === "metadata" ? "题录" : "摘要"}，未取得正文`,
          );
        if (!data.chunks.length) findings.push(`[${marker}] 没有解析原文`);
        const quote = normalize(citation.excerpt);
        const exact =
          quote.length >= 8
            ? data.chunks.filter((item) => item.normalized.includes(quote))
            : [];
        if (!quote || quote.length < 8)
          findings.push(`[${marker}] 引用片段过短，无法可靠匹配`);
        else if (!exact.length)
          findings.push(`[${marker}] 引用片段未在实际解析原文中找到`);
        if (
          exact.length &&
          typeof citation.page === "number" &&
          !exact.some((item) => item.chunk.page === citation.page)
        )
          findings.push(`[${marker}] 页码与匹配原文不一致`);
        if (
          exact.length &&
          typeof citation.chunkIndex === "number" &&
          !exact.some((item) => item.chunk.chunkIndex === citation.chunkIndex)
        )
          findings.push(`[${marker}] 片段位置与匹配原文不一致`);
        const terms = Array.from(
          claim.text.matchAll(
            /[A-Za-z]{3,}|[\u3400-\u9fff]{2,4}|\d+(?:\.\d+)?%?/g,
          ),
          (match) => match[0].toLowerCase(),
        ).slice(0, 60);
        const ranked = [...data.chunks].sort((a, b) =>
          terms.reduce(
            (sum, term) =>
              sum +
              Number(b.normalized.toLowerCase().includes(term)) -
              Number(a.normalized.toLowerCase().includes(term)),
            0,
          ),
        );
        const selected = [
          ...new Map(
            [...exact, ...ranked.slice(0, 2)].map((item) => [
              item.chunk.id,
              item.chunk,
            ]),
          ).values(),
        ].slice(0, 2);
        if (!matches.some((item) => item.sourceId === source.id))
          matches.push({
            sourceId: source.id,
            title: source.title,
            scope,
            sha256: data.hash,
            quoteFound: !!exact.length,
            quotes: selected.map((chunk) => ({
              text: chunk.text.slice(0, 1600),
              page: chunk.page,
              chunkIndex: chunk.chunkIndex,
            })),
          });
      }
      return { index, text: claim.text, markers, findings, sources: matches };
    }),
  };
}
export function auditPrompt(report: FulltextAuditReport): string {
  return JSON.stringify(
    report.claims.map((claim) => ({
      index: claim.index,
      claim: claim.text,
      findings: claim.findings,
      sources: claim.sources.map((source) => ({
        sourceId: source.sourceId,
        scope: source.scope,
        quotes: source.quotes,
      })),
    })),
  );
}
export function applySemanticAudit(
  report: FulltextAuditReport,
  rows: Array<{
    index: number;
    status: "supported" | "partial" | "contradicted" | "insufficient";
    reason: string;
    evidence: Array<{ sourceId: string; quote: string }>;
  }>,
): FulltextAuditReport {
  const mapped = new Map(rows.map((row) => [row.index, row]));
  const claims = report.claims.map((claim) => {
    const row = mapped.get(claim.index);
    if (!row) return claim;
    const valid = row.evidence.filter(
      (evidence) =>
        normalize(evidence.quote).length >= 8 &&
        claim.sources.some(
          (source) =>
            source.sourceId === evidence.sourceId &&
            source.quotes.some((quote) =>
              normalize(quote.text).includes(normalize(evidence.quote)),
            ),
        ),
    );
    const reliable =
      valid.length === row.evidence.length &&
      (row.status === "insufficient" || valid.length > 0);
    const incompleteSource = claim.sources.some(
      (source) => source.scope === "metadata" || source.scope === "abstract",
    );
    return {
      ...claim,
      semantic: {
        status:
          reliable && !(row.status === "supported" && incompleteSource)
            ? row.status
            : ("insufficient" as const),
        reason: !reliable
          ? "模型返回的证据没有逐字匹配实际原文，需人工复核。"
          : row.status === "supported" && incompleteSource
            ? "只有摘要或题录，不能视为正文引证通过。"
            : row.reason,
        evidence: valid,
      },
    };
  });
  return {
    ...report,
    claims,
    semanticStatus: claims.every((claim) => !!claim.semantic)
      ? "complete"
      : "incomplete",
  };
}
