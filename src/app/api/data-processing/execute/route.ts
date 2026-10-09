import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { getIngestionSource } from '@/lib/ingestion-store';
import { normalizeNotebookId } from '@/lib/notebook-scope';
import { retrieveFileBuffer } from '@/lib/storage';
import { dataAnalysisRequestSchema } from '@/lib/data-analysis-contract';
import { AnalysisRuntimeError, executeDataAnalysis } from '@/lib/data-analysis-runner';
import { saveDataAnalysis } from '@/lib/data-analysis-store';

export async function POST(request: NextRequest) {
  const parsed = dataAnalysisRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !normalizeNotebookId(parsed.data.notebookId)) return Response.json({ error: '请提供文献本、数据来源、研究问题、样本单位及目标列。' }, { status: 400 });
  const input = parsed.data;
  const scope = await resolveAccountNotebookScope(request, { notebookId: input.notebookId, loginMessage: '请登录后执行统计分析。' });
  if (!scope.ok) return scope.response;
  if (!scope.ownerMemberId) return Response.json({ error: '请登录后执行统计分析。' }, { status: 401 });
  try {
    const source = await getIngestionSource(input.sourceId, { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId });
    if (!source || source.ownerMemberId !== scope.ownerMemberId) return Response.json({ error: '当前文献本中没有该数据来源。' }, { status: 404 });
    if (!['csv', 'xlsx'].includes(source.fileType)) return Response.json({ error: '统计执行仅支持已上传的 CSV 或 XLSX 原文件。' }, { status: 400 });
    const key = source.storageKey || source.fileUrl || '';
    if (!/^\/?uploads\//.test(key) || key.includes('\\') || key.includes('\0') || key.split('/').includes('..')) return Response.json({ error: '数据来源缺少有效原文件，请重新上传。' }, { status: 409 });
    const file = await retrieveFileBuffer(key);
    const fileType = source.fileType as 'csv' | 'xlsx';
    const result = await executeDataAnalysis(input, file, fileType, request.signal);
    const reproduceScript = await readFile(path.join(process.cwd(), 'services/statistics/analyze.py'), 'utf8');
    if (result.versions.scriptSha256 !== createHash('sha256').update(reproduceScript).digest('hex')) throw new AnalysisRuntimeError('统计环境与发布源码版本不一致，请联系服务方更新。');
    const reproduce = { question: input.question, sampleUnit: input.sampleUnit, method: input.method, targetColumn: input.targetColumn,
      groupColumn: input.groupColumn, sheetName: input.sheetName, independentObservations: input.independentObservations };
    const saved = await saveDataAnalysis({ ...result, ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId || input.notebookId,
      sourceId: source.id, sourceFileName: source.fileName, sourceFileSha256: createHash('sha256').update(file).digest('hex'), request: { ...reproduce, fileType },
      engineImage: process.env.STATISTICS_RUNTIME_IMAGE || '',
      reproduceScript,
      reproduceRequirements: await readFile(path.join(process.cwd(), 'services/statistics/requirements.txt'), 'utf8') });
    return Response.json({ code: 0, data: saved }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const known = error instanceof AnalysisRuntimeError;
    return Response.json({ error: known ? error.message : '统计分析暂时无法完成，请检查原文件或稍后重试。' }, { status: known ? error.status : 503 });
  }
}
