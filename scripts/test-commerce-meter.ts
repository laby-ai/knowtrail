import assert from 'node:assert/strict';
import { commerceContext, registerProvider, type BillingContext } from '../src/lib/commerce/context';
import { installMeteredFetch } from '../src/lib/commerce/metered-fetch';
function context(source: 'platform' | 'byok'): BillingContext { return { requestId: source, operation: 'chat', accountId: 'fixture', tenantId: 'fixture', memberId: source, source, providers: new Map(), resources: [], calls: new Set(), enforcing: false, startedAt: Date.now() }; }
async function main() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"fixture"}}]}\n\ndata: {"usage":{"prompt_tokens":21,"completion_tokens":7},"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  installMeteredFetch();
  const platform = context('platform'), byok = context('byok');
  try {
    await Promise.all([platform, byok].map(item => commerceContext.run(item, async () => {
      registerProvider(`fixture-${item.source}`, item.source);
      const response = await fetch('https://fixture.invalid/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer fixture-${item.source}` }, body: JSON.stringify({ model: 'fixture-model', stream: true, messages: [{ role: 'user', content: 'isolated' }] }) });
      assert.match(await response.text(), /fixture/);
    })));
    for (const item of [platform, byok]) {
      assert.equal(item.resources.length, 1); assert.equal(item.resources[0].source, item.source);
      assert.equal(item.resources[0].inputTokens, 21); assert.equal(item.resources[0].outputTokens, 7); assert.equal(item.resources[0].usageMissing, false);
      assert.equal(JSON.stringify(item.resources).includes('fixture-platform'), false);
    }
    await commerceContext.run(platform, async () => {
      platform.enforcing = true;
      await assert.rejects(fetch('https://fixture.invalid/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'unquoted' }) }), /resource_not_in_confirmed_quote/);
    });
    console.log('PASS: concurrent payer/source isolation, actual stream usage, secret-free records, unquoted provider denial');
  } finally { globalThis.fetch = original; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
