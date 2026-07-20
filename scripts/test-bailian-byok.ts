import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateBailianWanImage } from '../src/lib/bailian-wan-image';
import { bailianProfileFromRuntimeConfig } from '../src/lib/bailian-provider-profile';
import type { MemberProviderProfile } from '../src/lib/account-entitlement-client';

const fixtureKey = 'sk-test-bailian-contract-only';
const profile: MemberProviderProfile = {
  tenant_id: 'tenant-test', member_id: 'member-test', provider_id: 'aliyun-bailian',
  workspace_id: 'ws-test-contract', region: 'cn-beijing', text_model: 'qwen3.7-plus',
  image_model: 'wan2.7-image-pro', tts_model: 'qwen-audio-3.0-tts-plus', api_key: fixtureKey,
};

const originalFetch = globalThis.fetch;
const seen: Array<{ url: string; authorization?: string; body?: string }> = [];
async function main() {
try {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, authorization: new Headers(init?.headers).get('authorization') || undefined, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('/multimodal-generation/generation')) {
      return Response.json({ output: { choices: [{ message: { content: [{ type: 'image', image: 'https://fixture.example/image.png' }] } }] } });
    }
    if (url === 'https://fixture.example/image.png') {
      return new Response(Buffer.from('fixture-png-bytes'), { headers: { 'Content-Type': 'image/png' } });
    }
    throw new Error(`unexpected fixture URL ${url}`);
  }) as typeof fetch;

  const generated = await generateBailianWanImage('科研流程示意图', profile, { aspectRatio: '16:9' });
  assert.equal(generated.toString(), 'fixture-png-bytes');
  assert.equal(seen[0]?.authorization, `Bearer ${fixtureKey}`);
  assert.match(seen[0]?.url || '', /^https:\/\/ws-test-contract\.cn-beijing\.maas\.aliyuncs\.com\//);
  const body = JSON.parse(seen[0]?.body || '{}');
  assert.equal(body.model, 'wan2.7-image-pro');
  assert.equal(body.parameters.size, '2048*1152');
  assert.equal(body.parameters.n, 1);

  const runtimeProfile = bailianProfileFromRuntimeConfig({ apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: fixtureKey, providerId: 'aliyun-bailian', workspaceId: 'ws-test-contract' });
  assert.equal(runtimeProfile?.text_model, 'qwen3.7-plus');
  assert.equal(runtimeProfile?.image_model, 'wan2.7-image-pro');
  assert.equal(runtimeProfile?.tts_model, 'qwen-audio-3.0-tts-plus');

  const uiSource = await readFile(path.join(process.cwd(), 'src/components/account/BailianProviderButton.tsx'), 'utf8');
  const proxySource = await readFile(path.join(process.cwd(), 'src/app/api/account/provider-profile/route.ts'), 'utf8');
  const resolverSource = await readFile(path.join(process.cwd(), 'src/lib/bailian-provider-profile.ts'), 'utf8');
  assert.match(uiSource, /type="password"/);
  assert.match(uiSource, /业务空间 ID/);
  assert.match(uiSource, /qwen3\.7-plus/);
  assert.match(uiSource, /wan2\.7-image-pro/);
  assert.match(uiSource, /qwen-audio-3\.0-tts-plus/);
  assert.match(uiSource, /createPortal/);
  assert.match(uiSource, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.doesNotMatch(uiSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(proxySource, /console\.(log|error).*body/);
  assert.match(resolverSource, /ACCOUNT_CENTER_CLIENT_SECRET/);
  assert.ok(![uiSource, proxySource, resolverSource].some(source => source.includes(fixtureKey)));
  console.log(JSON.stringify({ ok: true, checks: 17, models: ['qwen3.7-plus', 'wan2.7-image-pro', 'qwen-audio-3.0-tts-plus'] }));
} finally {
  globalThis.fetch = originalFetch;
}
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
