import { providerCapabilityUnavailable } from '@/lib/model-provider-presets';
import { createHash, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { bearerTokenFromRequest, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { commerceAccount, CommerceError } from './account-client';
import { commerceContext, type BillingContext } from './context';
import { installMeteredFetch } from './metered-fetch';
import { enqueueCommerce, drainCommerceOutbox } from './outbox';
import { resolveRequestRuntimeAIConfig, bailianProfileErrorResponse } from '@/lib/bailian-provider-profile';
import { commerceMessage } from './errors';
import type { CommerceMembership, CommerceQuote } from './contracts';
import { DeliveryTracker } from './delivery';

export function inputHash(text: string) { return createHash('sha256').update(text).digest('hex'); }
export async function runCommerceTask(request: NextRequest, operation: string, execute: () => Promise<Response>): Promise<Response> {
  if (!process.env.LINGBI_COMMERCE_MODE) return execute();
  installMeteredFetch();
  void drainCommerceOutbox();
  const enforcing = process.env.LINGBI_COMMERCE_MODE === 'enforced';
  try {
    const session = await resolveAccountSessionFromRequest(request);
    if (!session && enforcing) throw new CommerceError(401, 'account_login_required');
    const token = bearerTokenFromRequest(request);
    const requestedAccount = request.headers.get('X-Lingbi-Payer');
    const membership = session ? await commerceAccount<CommerceMembership>(`membership${requestedAccount ? `?accountId=${encodeURIComponent(requestedAccount)}` : ''}`, { token }) : null;
    const selected = request.headers.get('X-Lingbi-Model-Source');
    const source = !session ? 'platform' : selected === 'byok' || selected === 'platform' ? selected : membership!.modelSource;
    const context: BillingContext = { requestId: randomUUID(), operation, accountId: membership?.accountId || 'anonymous-platform', tenantId: session?.tenant_id || 'anonymous', memberId: session?.member.id || 'anonymous', source, providers: new Map(), resources: [], calls: new Set(), enforcing, startedAt: Date.now() };
    if (enforcing) {
      const quoteId = request.headers.get('X-Lingbi-Quote');
      if (!quoteId || !membership?.readiness.chargingReady) throw new CommerceError(402, 'confirmed_quote_required');
      const digest = inputHash(await request.clone().text());
      context.quote = await commerceAccount<CommerceQuote>('internal/reserve', { internal: true, body: { tenantId: context.tenantId, memberId: context.memberId, accountId: context.accountId, quoteId, inputHash: digest, operation, source } });
    }
    return await commerceContext.run(context, async () => {
      let finalized = false;
      async function finish(delivered: number, outcome: string, deliveryReliable = true) {
        if (finalized) return;
        finalized = true;
        const resources = context.resources.filter(item => item.status && item.status >= 200 && item.status < 300 && !item.retry);
        const reliable = deliveryReliable && resources.length > 0 && resources.every(item => item.source === 'byok' || !item.usageMissing);
        const body = { tenantId: context.tenantId, memberId: context.memberId, accountId: context.accountId, requestId: context.requestId, operation, resources: context.resources, delivered, reliable, outcome, durationMs: Date.now() - context.startedAt };
        // Persist work before contacting account service; no wallet lives in this outbox.
        await enqueueCommerce({ route: 'usage', body });
        if (context.quote) await enqueueCommerce({ route: 'finalize', body: { ...body, resources, quoteId: request.headers.get('X-Lingbi-Quote') } });
      }
      try {
        context.config = await resolveRequestRuntimeAIConfig(request);
        if (providerCapabilityUnavailable(context.config, operation)) throw new CommerceError(422, 'provider_capability_unavailable');
        const response = await execute();
        if (!response.ok || !response.body) { await finish(0, 'failed'); return response; }
        const reader = response.body.getReader();
        const tracker = new DeliveryTracker(response.headers.get('Content-Type') || '', operation);
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                const delivered = tracker.finish();
                await finish(delivered, delivered ? 'completed' : 'failed', tracker.reliable);
                controller.close(); return;
              }
              tracker.push(chunk.value);
              controller.enqueue(chunk.value);
            } catch (error) { await finish(0, 'interrupted'); controller.error(error); }
          },
          async cancel(reason) { await reader.cancel(reason); await finish(0, 'cancelled'); },
        });
        return new Response(stream, { status: response.status, headers: response.headers });
      } catch (error) { await finish(0, 'failed'); throw error; }
    });
  } catch (error) {
    const providerError = bailianProfileErrorResponse(error);
    if (providerError) return providerError;
    const code = error instanceof CommerceError ? error.code : 'commerce_task_unavailable';
    return Response.json({ error: commerceMessage(code), code }, { status: error instanceof CommerceError ? error.status : 503 });
  }
}
