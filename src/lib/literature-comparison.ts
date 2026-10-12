import { createHash } from "node:crypto";
import { SOURCE_MATRIX_FACETS } from "./source-matrix";
import type { StoredSourceRecord } from "./ingestion-store";
import type { LiteratureComparison, LiteratureComparisonRow, MatrixEvidence } from "./literature-comparison-contract";

export function compareLiterature(sources: StoredSourceRecord[]): LiteratureComparison {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "sentence" });
  const rows: LiteratureComparisonRow[] = sources.map(source => {
    const facets: MatrixEvidence[] = [];
    // Titles, keywords and upload dates are metadata, never evidence paragraphs.
    if (source.literature?.evidenceScope !== "metadata") {
      for (const facet of SOURCE_MATRIX_FACETS) {
        for (const chunk of source.chunks) {
          const sentence = [...segmenter.segment(chunk.text)].find(item => item.segment.trim().length >= 8 && item.segment.length <= 3000 && facet.patterns.some(pattern => pattern.test(item.segment)));
          if (!sentence) continue;
          facets.push({ key: facet.key, label: facet.label, quote: sentence.segment.trim(), sourceId: source.id, chunkId: chunk.id, chunkIndex: chunk.chunkIndex, ...(chunk.page ? { page: chunk.page } : {}) });
          break;
        }
      }
    }
    const year = Number(source.literature?.year);
    return {
      sourceId: source.id, title: source.title,
      year: Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null,
      doi: source.literature?.doi, venue: source.literature?.venue,
      evidenceScope: source.literature?.evidenceScope || "uploaded-text",
      sourceHash: createHash("sha256").update(JSON.stringify(source.chunks.map(chunk => [chunk.id, chunk.text, chunk.page, chunk.chunkIndex]))).digest("hex"),
      facets,
    };
  });
  const years = [...new Set(rows.flatMap(row => row.year ? [row.year] : []))].sort((a, b) => a - b);
  return { rows, timeline: years.map(year => ({ year, sourceIds: rows.filter(row => row.year === year).map(row => row.sourceId) })), undatedSourceIds: rows.filter(row => !row.year).map(row => row.sourceId), method: "stored-paragraph-keyword-candidates" };
}
