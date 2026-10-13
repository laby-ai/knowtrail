import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { CommerceResource, CommerceQuote, ModelSource } from './contracts';
import type { RuntimeAIConfig } from '@/types';

export type BillingContext = { requestId: string; operation: string; accountId: string; tenantId: string; memberId: string; source: ModelSource; providers: Map<string, ModelSource>; resources: CommerceResource[]; calls: Set<string>; quote?: CommerceQuote; config?: Partial<RuntimeAIConfig>; enforcing: boolean; startedAt: number };
const runtime = globalThis as typeof globalThis & { lingbiCommerceContext?: AsyncLocalStorage<BillingContext> };
export const commerceContext = runtime.lingbiCommerceContext ||= new AsyncLocalStorage<BillingContext>();
export function keyHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function registerProvider(key: string, source: ModelSource) {
  if (key) commerceContext.getStore()?.providers.set(keyHash(key), source);
}
export function trustedRequestKey(key?: string): boolean { return Boolean(key && commerceContext.getStore()?.providers.has(keyHash(key))); }
export function requestedModelSource(): ModelSource | undefined { return commerceContext.getStore()?.source; }
export function requestProviderConfig() { return commerceContext.getStore()?.config; }
export function recordResource(resource: CommerceResource) { commerceContext.getStore()?.resources.push(resource); }
