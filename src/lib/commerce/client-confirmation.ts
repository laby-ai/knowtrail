'use client';
import { COMMERCE_OPERATIONS } from './contracts';
export type QuoteConfirmation = { id: string; maxPoints: number; accountId: string; payerLabel: string; source: string; expiresAt: string; operation: string };
export type ConfirmationEvent = { quote: QuoteConfirmation; resolve: (approved: boolean) => void };
export function selectedCommerceHeaders(): Record<string, string> {
  try {
    const session = JSON.parse(window.localStorage.getItem('knowtrail-account-session') || '{}') as { member?: { id: string } };
    const selected = JSON.parse(window.localStorage.getItem(`lingbi-commerce-selection:${session.member?.id}`) || '{}') as { accountId?: string; source?: string };
    return { ...(selected.accountId ? { 'X-Lingbi-Payer': selected.accountId } : {}), ...(selected.source ? { 'X-Lingbi-Model-Source': selected.source } : {}) };
  } catch { return {}; }
}
export async function commerceRequestHeaders(path: string, options: RequestInit, token: string): Promise<Record<string, string>> {
  if (options.method !== 'POST' || !COMMERCE_OPERATIONS[path] || typeof options.body !== 'string' || !token) return {};
  let selection: { accountId?: string; source?: string } = {};
  try {
    const session = JSON.parse(window.localStorage.getItem('knowtrail-account-session') || '{}') as { member?: { id: string } };
    selection = JSON.parse(window.localStorage.getItem(`lingbi-commerce-selection:${session.member?.id}`) || '{}') as typeof selection;
  } catch { /* Account service chooses canonical personal account. */ }
  const basePath = window.location.pathname.startsWith('/lingbi') ? '/lingbi' : '';
  const response = await fetch(`${basePath}/api/account/commerce/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: options.signal, body: JSON.stringify({ path, body: options.body, accountId: selection.accountId, source: selection.source, idempotencyKey: new Headers(options.headers).get('Idempotency-Key') || crypto.randomUUID() }) });
  const quote = await response.json() as QuoteConfirmation & { requiresConfirmation?: boolean; error?: string };
  if (!response.ok) throw new Error(quote.error || '无法读取本次费用，请重试。');
  if (quote.requiresConfirmation) {
    const approved = await new Promise<boolean>(resolve => {
      if (options.signal?.aborted) return resolve(false);
      const onAbort = () => resolve(false);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      window.dispatchEvent(new CustomEvent<ConfirmationEvent>('lingbi-commerce-confirm', { detail: { quote, resolve: value => { options.signal?.removeEventListener('abort', onAbort); resolve(value); } } }));
    });
    if (!approved) throw new Error('已取消任务，没有扣费。');
  }
  return { 'X-Lingbi-Payer': quote.accountId, 'X-Lingbi-Model-Source': quote.source, ...(quote.requiresConfirmation ? { 'X-Lingbi-Quote': quote.id } : {}) };
}
