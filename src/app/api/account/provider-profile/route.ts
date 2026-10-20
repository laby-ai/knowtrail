import { MODEL_PROVIDER_PRESETS, type ModelProviderId } from '@/lib/model-provider-presets';
import { z } from 'zod';
import { assertApiResponse } from '@/lib/api-response';
import type { NextRequest } from 'next/server';
import { getAccountApiBase } from '@/lib/account-auth-client';
import { bearerTokenFromRequest } from '@/lib/account-session';

const NO_STORE = { 'Cache-Control': 'no-store' };
const PROFILE_PATH = '/v1/me/provider-key-profile';

async function forward(request: NextRequest, method: 'GET' | 'PUT' | 'DELETE') {
  const token = bearerTokenFromRequest(request);
  if (!token) return Response.json({ error: 'not_authenticated' }, { status: 401, headers: NO_STORE });
  const baseUrl = getAccountApiBase();
  if (!baseUrl) return Response.json({ error: 'account_api_not_configured' }, { status: 503, headers: NO_STORE });

  let body: string | undefined;
  if (method === 'PUT') {
    try { body = JSON.stringify(z.object({ provider_id: z.enum(MODEL_PROVIDER_PRESETS.map(item => item.id) as [ModelProviderId, ...ModelProviderId[]]).optional(), api_key: z.string().trim().min(8).max(4096), workspace_id: z.string().max(128).optional(), region: z.literal('cn-beijing').optional() }).strict().parse(await request.json())); }
    catch { return Response.json({ error: '请选择支持的模型服务并填写有效 API Key。' }, { status: 400, headers: NO_STORE }); }
  }
  const response = await fetch(`${baseUrl}${PROFILE_PATH}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  try { await assertApiResponse(response, '模型配置'); } catch { return Response.json({ error: '模型配置服务暂时不可用，请稍后重试。' }, { status: 502, headers: NO_STORE }); }
  const payload = await response.json();
  return Response.json(payload, { status: response.status, headers: NO_STORE });
}

export function GET(request: NextRequest) {
  return forward(request, 'GET');
}

export function PUT(request: NextRequest) {
  return forward(request, 'PUT');
}

export function DELETE(request: NextRequest) {
  return forward(request, 'DELETE');
}
