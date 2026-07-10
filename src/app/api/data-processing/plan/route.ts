import { NextRequest } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  buildDataProcessingPlan,
  validateDataProcessingRequest,
  type DataProcessingRequest,
} from '@/lib/data-processing-plan';
import type { Paper } from '@/types';

type PlanRequestBody = DataProcessingRequest & {
  paper?: Paper;
  notebookId?: string;
};

function response(code: number, msg: string, data: unknown, status = 200) {
  return Response.json({ code, msg, data }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
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
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号，再生成数据处理方案。',
  });
  if (!scope.ok) return scope.response;

  const input: DataProcessingRequest = {
    question: body.question,
    sampleUnit: body.sampleUnit,
    taskFamily: body.taskFamily,
    targetColumn: body.targetColumn,
    splitColumn: body.splitColumn,
  };
  const errors = validateDataProcessingRequest(input, body.paper);
  if (errors.length > 0) return response(42201, errors.join(' '), null, 422);

  try {
    const plan = buildDataProcessingPlan(input, body.paper);
    return response(0, 'ok', plan);
  } catch (error) {
    return response(42202, error instanceof Error ? error.message : '无法生成数据处理方案。', null, 422);
  }
}
