import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { resolveRequestRuntimeAIConfig } from '@/lib/bailian-provider-profile';
import { serverRuntimeAIConfigFromEnv } from '@/lib/runtime-ai-config';
import { bearerTokenFromRequest, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { commerceAccount, CommerceError } from './account-client';
import { commerceContext } from './context';
import { inputHash } from './task';
import { COMMERCE_OPERATIONS, type CommerceMembership, type CommerceQuote, type CommerceResource, type ModelSource } from './contracts';

export async function prepareCommerceQuote(request: NextRequest) {
  const body = await request.json() as { path?: string; body?: string; accountId?: string; source?: string; idempotencyKey?: string };
  const operation = COMMERCE_OPERATIONS[body.path || ''];
  if (!operation || typeof body.body !== 'string' || Buffer.byteLength(body.body) > 8_000_000) throw new CommerceError(400, 'invalid_quote_request');
  const session = await resolveAccountSessionFromRequest(request);
  if (!session) throw new CommerceError(401, 'account_login_required');
  const token = bearerTokenFromRequest(request);
  const membership = await commerceAccount<CommerceMembership>(`membership${body.accountId ? `?accountId=${encodeURIComponent(body.accountId)}` : ''}`, { token });
  const source = body.source === 'byok' ? 'byok' : body.source === 'platform' ? 'platform' : membership.modelSource;
  if (!membership.readiness.chargingReady) return { mode: 'observe', requiresConfirmation: false, maxPoints: null, source, accountId: membership.accountId, message: '当前仅采集用量，不扣科研点数。' };
  const context = { requestId: randomUUID(), operation, accountId: membership.accountId, tenantId: session.tenant_id, memberId: session.member.id, source, providers: new Map<string, ModelSource>(), resources: [], calls: new Set<string>(), enforcing: false, startedAt: Date.now() };
  const config = await commerceContext.run(context, () => resolveRequestRuntimeAIConfig(request));
  const platform = serverRuntimeAIConfigFromEnv();
  const host = (base?: string) => { try { return new URL(base || '').hostname; } catch { throw new CommerceError(503, 'provider_not_configured'); } };
  const resources: CommerceResource[] = [{ rateKey: `${host(config.apiBase)}:${config.model}`, source, inputTokens: Math.max(Buffer.byteLength(body.body) * 4, 128000), outputTokens: 32000 }];
  if (operation === 'ppt' || operation === 'scientific-illustration' || operation === 'ppt-slide-revise') {
    const payload = JSON.parse(body.body) as { slideCount?: number; pageCount?: number; pages?: number };
    const count = operation === 'ppt' ? Math.max(1, Math.min(16, Number(payload.slideCount || payload.pageCount || payload.pages || 9))) : 1;
    resources.push({ rateKey: `${source === 'byok' ? `${config.workspaceId}.cn-beijing.maas.aliyuncs.com` : host(process.env.IMAGE_API_BASE || platform.apiBase)}:${source === 'byok' ? config.imageModel : process.env.IMAGE_MODEL || config.imageModel || platform.model}`, source, images: count });
  }
  if (operation === 'discover-search' || operation === 'deep-research') {
    resources.push({ rateKey: 'metaso.cn:search', source: 'platform', queries: operation === 'deep-research' ? 20 : 1 });
  }
  const quote = await commerceAccount<CommerceQuote>('internal/quote', { token, internal: true, body: { tenantId: session.tenant_id, memberId: session.member.id, accountId: membership.accountId, operation, resources, inputHash: inputHash(body.body), idempotencyKey: body.idempotencyKey || randomUUID() } });
  return { ...quote, source, accountId: membership.accountId, mode: 'enforced', requiresConfirmation: true };
}
