import type { SourceMatrixFacetKey } from "./source-matrix";
export interface MatrixEvidence {
  key: SourceMatrixFacetKey; label: string; quote: string;
  sourceId: string; chunkId: string; chunkIndex: number; page?: number;
}
export interface LiteratureComparisonRow {
  sourceId: string; title: string; year: number | null; doi?: string; venue?: string;
  evidenceScope: string; sourceHash: string; facets: MatrixEvidence[];
}
export interface LiteratureComparison {
  rows: LiteratureComparisonRow[];
  timeline: Array<{ year: number; sourceIds: string[] }>;
  undatedSourceIds: string[];
  method: "stored-paragraph-keyword-candidates";
}
