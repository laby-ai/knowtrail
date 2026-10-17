import { NextRequest } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  buildDataProcessingPlan,
  validateDataProcessingRequest,
  type DataProcessingRequest,
} from '@/lib/data-processing-plan';
import type { Paper } from '@/types';
import { getIngestionSource } from '@/lib/ingestion-store';
import { sourceBibliography } from '@/lib/source-bibliography';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument } from '@/lib/private-notebook-document';
import { isDataProcessingDocument, type DataProcessingDocument } from '@/lib/data-processing-document';

type PlanRequestBody = DataProcessingRequest & {
  runId?: string;
  paper?: Paper;
  notebookId?: string;
  persistArtifact?: boolean;
  expectedRevision?: string | null;
};

function response(code: number, msg: string, data: unknown, status = 200) {
  return Response.json({ code, msg, data }, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function POST(request: NextRequest) {
  let body: PlanRequestBody;
  try {
    body = await request.json() as PlanRequestBody;
  } catch {
    return response(40001, '数据处理请求格式无效。', null, 400);
  }

  if (!body.paper) return response(40002, '请先选择一个 CSV 或 XLSX 数据来源。', null, 400);
  if (body.runId !== undefined && (typeof body.runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.runId))) return response(40004, '本轮任务标识无效。', null, 400);
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号，再生成数据处理方案。',
  });
  if (!scope.ok) return scope.response;
  const verified = scope.ownerMemberId && scope.notebookId ? { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId } : null;
  let paper = body.paper;
  try {
    if (scope.ownerMemberId) {
      const source = await getIngestionSource(body.paper.id, { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId });
      if (!source) return response(40401, '当前文献本没有这个数据来源。', null, 404);
      if (source.fileType !== 'csv' && source.fileType !== 'xlsx') return response(42201, '请选择已解析的 CSV 或 XLSX 数据来源。', null, 422);
      paper = { ...body.paper, ...source, ...sourceBibliography(source), fileType: source.fileType, uploadTime: source.createdAt };
    }
    if (body.persistArtifact) {
      if (!verified) return response(40101, '请先登录并打开文献本。', null, 401);
      if (body.expectedRevision !== null && typeof body.expectedRevision !== 'string') return response(40003, '缺少保存版本，请重新读取。', null, 400);
      const previous = await readNotebookDocument(verified, 'data-processing');
      if (previous && !isDataProcessingDocument(previous.data)) throw new Error('Invalid saved plan');
      if ((previous?.revision || null) !== body.expectedRevision) throw new NotebookDocumentConflict();
    }
  } catch (error) { return response(error instanceof NotebookDocumentConflict ? 40901 : 50301, error instanceof NotebookDocumentConflict ? error.message : '数据方案暂时无法读取，请重试。', null, error instanceof NotebookDocumentConflict ? 409 : 503); }

  const input: DataProcessingRequest = {
    question: body.question,
    sampleUnit: body.sampleUnit,
    taskFamily: body.taskFamily,
    targetColumn: body.targetColumn,
    splitColumn: body.splitColumn,
  };
  if (!isDataProcessingDocument({ sourceId: paper.id, ...input, targetColumn: input.targetColumn || '', splitColumn: input.splitColumn || '', plan: null })) return response(42203, '问题、样本单位或任务类型无效。', null, 422);
  const errors = validateDataProcessingRequest(input, paper);
  if (errors.length > 0) return response(42201, errors.join(' '), null, 422);

  try {
    request.signal.throwIfAborted();
    const plan = buildDataProcessingPlan(input, paper);
    if (body.persistArtifact && verified) {
      const data: DataProcessingDocument = { sourceId: paper.id, ...input, targetColumn: input.targetColumn || '', splitColumn: input.splitColumn || '', plan, ...(body.runId ? { generation: { runId: body.runId } } : {}) };
      try {
        request.signal.throwIfAborted();
        const document = await saveNotebookDocument(verified, 'data-processing', data, body.expectedRevision!);
        return Response.json({ code: 0, msg: 'ok', data: plan, document }, { headers: { 'Cache-Control': 'private, no-store' } });
      } catch (error) {
        return Response.json({ code: error instanceof NotebookDocumentConflict ? 40901 : 50301, msg: error instanceof NotebookDocumentConflict ? error.message : '方案尚未保存，请重试保存。', unsavedDocument: data }, { status: error instanceof NotebookDocumentConflict ? 409 : 503, headers: { 'Cache-Control': 'private, no-store' } });
      }
    }
    return response(0, 'ok', plan);
  } catch (error) {
    return response(42202, error instanceof Error ? error.message : '无法生成数据处理方案。', null, 422);
  }
}
