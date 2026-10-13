import assert from 'node:assert/strict';
import { commerceContext, registerProvider, type BillingContext } from '../src/lib/commerce/context';
import { installMeteredFetch } from '../src/lib/commerce/metered-fetch';
import { DeliveryTracker } from '../src/lib/commerce/delivery';
import { enqueueCommerce, drainCommerceOutbox } from '../src/lib/commerce/outbox';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
function context(source: 'platform' | 'byok'): BillingContext { return { requestId: source, operation: 'chat', accountId: 'fixture', tenantId: 'fixture', memberId: source, source, providers: new Map(), resources: [], calls: new Set(), enforcing: false, startedAt: Date.now() }; }
async function main() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"fixture"}}]}\n\ndata: {"usage":{"prompt_tokens":21,"completion_tokens":7},"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  installMeteredFetch();
  const platform = context('platform'), byok = context('byok');
  try {
    const encode = (value: string) => new TextEncoder().encode(value);
    const partial = new DeliveryTracker('text/event-stream');
    partial.push(encode('data: {"stage":"done","slides":[{"imageUrl":"fixture-a"},{"imageUrl":null},{"imageUrl":"fixture-b"}]}\n\n'));
    assert.equal(partial.finish(), 2);
    const failed = new DeliveryTracker('text/event-stream');
    failed.push(encode('data: {"stage":"image","status":"done"}\n\ndata: {"stage":"error","message":"download failed"}\n\n'));
    assert.equal(failed.finish(), 0);
    const text = new DeliveryTracker('text/event-stream');
    text.push(encode('data: {"delta":"deliverable"}\n\ndata: [DONE]\n\n'));
    assert.equal(text.finish(), 1);
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
    const parallel = context('platform');
    parallel.enforcing = true;
    parallel.operation = 'ppt';
    parallel.quote = { id: 'fixture-quote', operation: 'ppt', maxPoints: 100, expiresAt: '2099-01-01', inputHash: 'a'.repeat(64), version: 'fixture', priceBook: {}, resources: [{ rateKey: 'fixture.invalid:fixture-model', source: 'platform', inputTokens: 128000, outputTokens: 64000 }] };
    await commerceContext.run(parallel, async () => {
      await Promise.all(Array.from({ length: 8 }, async (_, index) => {
        const response = await fetch('https://fixture.invalid/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'fixture-model', stream: true, messages: [{ role: 'user', content: 'isolated-' + index }] }) });
        await response.text();
      }));
    });
    assert.equal(parallel.resources.length, 8);
    assert.ok(parallel.resources.every(item => item.completed && !item.usageMissing));
    const root = await mkdtemp(path.join(tmpdir(), 'lingbi-commerce-outbox-'));
    process.env.LINGBI_COMMERCE_OUTBOX_PATH = root;
    process.env.ACCOUNT_CENTER_API_BASE = 'https://fixture.invalid';
    process.env.LINGBI_COMMERCE_INTERNAL_SECRET = 'isolated-outbox-fixture-secret-never-deploy';
    try {
      globalThis.fetch = async () => Response.json({ error: 'fixture_unavailable' }, { status: 503 });
      await enqueueCommerce({ route: 'usage', body: { requestId: 'fixture-restart-001', tenantId: 'fixture', memberId: 'fixture', resources: [] } });
      assert.equal((await readdir(root)).length, 1);
      globalThis.fetch = async () => Response.json({ status: 'recorded' });
      await drainCommerceOutbox();
      assert.equal((await readdir(root)).length, 0);
    } finally {
      if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep + 'lingbi-commerce-outbox-')) throw new Error('unexpected_test_cleanup_path');
      await rm(root, { recursive: true, force: true });
    }
    console.log('PASS: source isolation, actual usage, artifact delivery, eight parallel PPT calls, quote bounds and durable outbox retry');
  } finally { globalThis.fetch = original; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
