import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';
import type { CitationSectionCoverageResult } from '@/lib/citation-audit';
import type { StudioArtifactToolId } from '@/lib/studio-tools';

export const STUDIO_TOOL_NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

export interface StudioToolApiError {
  success: false;
  error: string;
  errorType: string;
  status?: 'failed';
}

export interface StudioToolArtifact {
  id: string;
  type: StudioArtifactToolId;
  notebookId?: string;
  title: string;
  markdown: string;
  createdAt: string;
  generationPattern: string;
  resultShape: string[];
}

export interface StudioToolGenerateSuccess {
  success: true;
  artifact: StudioToolArtifact;
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
  citationAudit?: CitationAuditResult;
  citationCoverage?: CitationSectionCoverageResult;
  billing?: {
    status: 'settled' | 'settle_failed';
    estimatedUnits?: number;
    code?: string;
  };
}

export type StudioToolGenerateResponse = StudioToolGenerateSuccess | StudioToolApiError;

export function studioToolError<T extends Record<string, unknown>>(
  errorType: string,
  error: string,
  httpStatus: number,
  extra?: T,
): Response {
  return Response.json({
    ...extra,
    success: false,
    error,
    errorType,
  }, {
    status: httpStatus,
    headers: STUDIO_TOOL_NO_STORE_HEADERS,
  });
}

export function studioToolSuccess<T extends Record<string, unknown>>(data: T): Response {
  return Response.json({ ...data, success: true }, {
    headers: STUDIO_TOOL_NO_STORE_HEADERS,
  });
}
