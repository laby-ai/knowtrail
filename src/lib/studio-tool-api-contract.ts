import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';
import type { CitationSectionCoverageResult } from '@/lib/citation-audit';
import type { StudioArtifactToolId } from '@/lib/studio-tools';

export const STUDIO_TOOL_NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

export type StudioToolErrorType =
  | 'studio_tool_invalid_request'
  | 'studio_tool_unknown'
  | 'studio_tool_sources_required'
  | 'studio_tool_citations_unavailable'
  | 'results_citations_unavailable'
  | 'studio_tool_debug_answer_required'
  | 'studio_tool_citation_audit_failed'
  | 'results_citation_audit_failed'
  | 'studio_tool_citation_coverage_failed'
  | 'account_login_required'
  | 'invalid_account_session'
  | 'account_billing_failed'
  | 'studio_tool_timeout'
  | 'studio_tool_generation_failed'
  | (string & {});

export interface StudioToolApiError {
  success: false;
  error: string;
  errorType: StudioToolErrorType;
  status?: 'failed';
  artifact?: StudioToolArtifact;
  citations?: Citation[];
  retrieval?: RetrievalMetadata | null;
  citationAudit?: CitationAuditResult;
  citationCoverage?: CitationSectionCoverageResult;
  billing?: StudioToolBilling;
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

export interface StudioToolEvidencePayload {
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
  citationAudit?: CitationAuditResult;
  citationCoverage?: CitationSectionCoverageResult;
}

export interface StudioToolBilling {
  status: 'settled' | 'settle_failed';
  estimatedUnits?: number;
  code?: string;
}

export interface StudioToolGenerateSuccess extends StudioToolEvidencePayload {
  success: true;
  artifact: StudioToolArtifact;
  billing?: StudioToolBilling;
}

export interface StudioToolDebugSuccess extends StudioToolEvidencePayload {
  success: true;
  promptContextLength: number;
}

export type StudioToolGenerateResponse = StudioToolGenerateSuccess | StudioToolApiError;
export type StudioToolDebugResponse = StudioToolDebugSuccess | StudioToolApiError;

export function studioToolError<T extends Record<string, unknown>>(
  errorType: StudioToolErrorType,
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
