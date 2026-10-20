import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { MODEL_PROVIDER_PRESETS, modelProviderPreset, providerCapabilityUnavailable } from '../src/lib/model-provider-presets';
import { commerceContext, type BillingContext } from '../src/lib/commerce/context';
import { resolveRequestRuntimeAIConfig } from '../src/lib/bailian-provider-profile';
import { llmInvoke } from '../src/lib/ai-service';

async function main() {
  process.env.ACCOUNT_CENTER_API_BASE = 'http://127.0.0.1:5188';
  process.env.LINGBI_COMMERCE_MODE = 'observe';
  process.env.LINGBI_COMMERCE_INTERNAL_SECRET = 'isolated-provider-test-secret-123456789';
  process.env.APP_PREFERENCES_STORE_DIR = path.join(os.tmpdir(), 'lingbi-provider-unit-nonexistent');
  process.env.OPENAI_COMPAT_API_BASE = 'https://platform.invalid/v1';
  process.env.OPENAI_COMPAT_API_KEY = 'platform-fixture-key';
  const original = globalThis.fetch;
  try {
    for (const preset of MODEL_PROVIDER_PRESETS) {
      let invoked = false;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/v1/auth/me')) return Response.json({ tenant_id: 'fixture-tenant', member: { id: 'fixture-provider-member', email: 'fixture@example.invalid', display_name: 'Fixture' } });
        if (url.endsWith('/v1/lingbi/internal/provider')) return Response.json({ provider_id: preset.id, workspace_id: '', region: 'global', text_model: preset.model, image_model: preset.image, tts_model: preset.tts, api_key: 'fixture-' + preset.id });
        assert.equal(url, preset.apiBase + '/chat/completions');
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-' + preset.id);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, preset.model);
        if (preset.id === 'moonshot') { assert.equal(body.reasoning_effort, 'low'); assert.ok(!('temperature' in body)); }
        invoked = true;
        return new Response('data: {"choices":[{"delta":{"content":"isolated provider result"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      };
      const context: BillingContext = { requestId: 'fixture', operation: 'chat', accountId: 'fixture', tenantId: 'fixture-tenant', memberId: 'fixture-provider-member', source: 'byok', providers: new Map(), resources: [], calls: new Set(), enforcing: false, startedAt: 0 };
      await commerceContext.run(context, async () => {
        const config = await resolveRequestRuntimeAIConfig(new Request('http://localhost/api/ai/chat', { headers: { Authorization: 'Bearer fixture-token' } }));
        assert.equal(config.apiBase, preset.apiBase);
        assert.equal(config.apiKey, 'fixture-' + preset.id);
        assert.equal(await llmInvoke([{ role: 'user', content: 'fixture' }], {}, undefined, config), 'isolated provider result');
        assert.equal(providerCapabilityUnavailable(config, 'scientific-illustration'), preset.id !== 'aliyun-bailian');
        assert.equal(providerCapabilityUnavailable(config, 'ppt-html'), false);
      });
      assert.ok(invoked);
    }
    assert.throws(() => modelProviderPreset('https://untrusted.invalid'));
    console.log('PASS: account-bound provider endpoint/key/model routing, no platform substitution, Kimi parameter constraints and capability checks');
  } finally { globalThis.fetch = original; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
