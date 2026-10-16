import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';

export interface ResearchStatusPayload {
  answerStatus?: 'complete' | 'incomplete' | 'no-evidence';
  sectionCoverage?: { status?: string; missingSections?: string[]; emptySections?: string[]; uncitedClaims?: Array<{ section?: string; text?: string }> };
  retrievalLimits?: string[];
  removedUncitedClaims?: number;
  repairAttempted?: boolean;
  outputConstraint?: { status: string; characters: number; maxCharacters: number | null; warning?: string };
}

export interface ResearchReport {
  runId: string;
  question: string;
  answer: string;
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
  citationAudit: CitationAuditResult | null;
  researchStatus: ResearchStatusPayload | null;
  status: 'complete' | 'incomplete';
}

export interface ResearchReportDocument { questionDraft: string; report: ResearchReport | null }
export const emptyResearchReport = (): ResearchReportDocument => ({ questionDraft: '', report: null });

export function researchReportDocument(report: ResearchReport): ResearchReportDocument {
  return { questionDraft: report.question, report: {
    runId: report.runId, question: report.question, answer: report.answer, citations: report.citations,
    retrieval: report.retrieval, citationAudit: report.citationAudit, researchStatus: report.researchStatus, status: report.status,
  } };
}

export function isResearchReportDocument(value: unknown): value is ResearchReportDocument {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ResearchReportDocument>;
  if (typeof item.questionDraft !== 'string' || item.questionDraft.length > 1200) return false;
  if (item.report === null) return true;
  const report = item.report;
  return Boolean(report && typeof report === 'object' && typeof report.runId === 'string' && /^[a-f0-9-]{36}$/i.test(report.runId)
    && typeof report.question === 'string' && typeof report.answer === 'string' && report.answer.length <= 500_000
    && ['complete', 'incomplete'].includes(report.status)
    && Array.isArray(report.citations) && report.citations.length <= 100
    && report.citations.every(citation => citation && typeof citation.paperId === 'string' && typeof citation.paperShortName === 'string' && typeof citation.excerpt === 'string')
    && (report.retrieval === null || Boolean(report.retrieval && typeof report.retrieval.mode === 'string'))
    && (report.citationAudit === null || Boolean(report.citationAudit && typeof report.citationAudit.status === 'string'))
    && (report.researchStatus === null || typeof report.researchStatus === 'object'));
}

export function preferSavedResearchReport(saved: ResearchReportDocument, pending: ResearchReportDocument): boolean {
  return Boolean(saved.questionDraft === pending.questionDraft && saved.report && pending.report && saved.report.runId === pending.report.runId
    && (saved.report.status === 'complete' || saved.report.answer.length >= pending.report.answer.length));
}
