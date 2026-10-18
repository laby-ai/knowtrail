import type { AccountNotebookScope } from '@/lib/account-request-scope';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument, type NotebookDocument } from '@/lib/private-notebook-document';
import { isResearchReportDocument, researchReportDocument, type ResearchReport, type ResearchReportDocument } from '@/lib/research-report-document';
import type { Citation, RetrievalMetadata } from '@/types';

export interface ReportPersistenceRequest { persistArtifact?: boolean; runId?: string; expectedRevision?: string | null }
type ReportContent = Omit<ResearchReport, 'question' | 'runId'>;
type SaveResult = { document?: NotebookDocument<ResearchReportDocument>; unsavedDocument?: ResearchReportDocument; saveError?: string };
interface Persistence {
  save?: (content: ReportContent) => Promise<NotebookDocument<ResearchReportDocument>>;
  interrupted?: (answer: string, citations: Citation[], retrieval: RetrievalMetadata, error: unknown) => Promise<SaveResult>;
}

export async function prepareResearchReportPersistence(scope: AccountNotebookScope, input: ReportPersistenceRequest, question: string): Promise<Persistence | { response: Response }> {
  if (input.persistArtifact !== true) return {};
  const jsonError = (error: string, status: number) => ({ response: Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } }) });
  if (!scope.ownerMemberId || !scope.notebookId) return jsonError('请先登录并打开文献本。', scope.ownerMemberId ? 400 : 401);
  if (question.length > 1200 || typeof input.runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.runId) || (input.expectedRevision !== null && typeof input.expectedRevision !== 'string')) return jsonError('请求或保存版本不完整，请重新读取。', 400);
  const runId = input.runId;
  const expectedRevision = input.expectedRevision;
  const verified = { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId };
  try {
    const previous = await readNotebookDocument(verified, 'research-report');
    if (previous && !isResearchReportDocument(previous.data)) throw new Error('Invalid saved report');
    if ((previous?.revision || null) !== input.expectedRevision) return jsonError('另一个页面已保存新内容，请先读取已保存内容。', 409);
  } catch { return jsonError('报告暂时无法读取，请重试。', 503); }
  let candidate: ResearchReportDocument | undefined;
  let saved: NotebookDocument<ResearchReportDocument> | undefined;
  const save = async (content: ReportContent) => {
    candidate = researchReportDocument({ ...content, question, runId });
    if (!isResearchReportDocument(candidate)) throw new Error('报告保存信息不完整，请重试。');
    saved = await saveNotebookDocument(verified, 'research-report', candidate, expectedRevision);
    return saved;
  };
  return { save, interrupted: async (answer, citations, retrieval, error) => {
    if (saved) return { document: saved };
    const reason = error instanceof NotebookDocumentConflict ? error.message : '报告尚未保存，请重试保存。';
    if (candidate) return { unsavedDocument: candidate, saveError: reason };
    if (!answer) return {};
    try {
      return { document: await save({ answer, citations, retrieval, citationAudit: null, researchStatus: { answerStatus: 'incomplete' }, status: 'incomplete' }) };
    } catch (caught) {
      return { unsavedDocument: candidate, saveError: caught instanceof NotebookDocumentConflict ? caught.message : reason };
    }
  } };
}
