import assert from 'node:assert/strict';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const mutableEnv = process.env as Record<string, string | undefined>;
const names = ['ACCOUNT_CENTER_API_BASE', 'ACCOUNT_CENTER_APP_KEY', 'ACCOUNT_CENTER_CREDENTIAL_KEY', 'ACCOUNT_CENTER_CLIENT_SECRET', 'ACCOUNT_CENTER_REQUIRE_AUTH', 'FILE_STORAGE_ADAPTER'] as const;
const originals = Object.fromEntries(names.map(name => [name, mutableEnv[name]]));
const originalFetch = globalThis.fetch;
const seen: Array<{ url: string; body?: string; authorization?: string }> = [];

async function main() {
try {
  mutableEnv.ACCOUNT_CENTER_API_BASE = 'https://account.fixture';
  mutableEnv.ACCOUNT_CENTER_APP_KEY = 'knowtrail';
  mutableEnv.ACCOUNT_CENTER_CREDENTIAL_KEY = 'fixture-credential';
  mutableEnv.ACCOUNT_CENTER_CLIENT_SECRET = 'fixture-client-secret';
  mutableEnv.ACCOUNT_CENTER_REQUIRE_AUTH = 'true';
  mutableEnv.FILE_STORAGE_ADAPTER = 'local';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, body: typeof init?.body === 'string' ? init.body : undefined, authorization: headers.get('authorization') || undefined });
    if (url === 'https://account.fixture/v1/auth/me') {
      return Response.json({ tenant_id: 'tenant-test', tenant_name: 'Test', member: { id: 'member-test', display_name: 'Test', email: 'test@example.com', role_key: 'member', status: 'active' } });
    }
    if (url === 'https://account.fixture/v1/internal/provider-key-profile/resolve') {
      return Response.json({ tenant_id: 'tenant-test', member_id: 'member-test', provider_id: 'aliyun-bailian', workspace_id: 'ws-test-contract', region: 'cn-beijing', text_model: 'qwen3.7-plus', image_model: 'wan2.7-image-pro', tts_model: 'qwen-audio-3.0-tts-plus', api_key: 'sk-test-route-fixture' });
    }
    if (url.includes('/services/audio/tts/SpeechSynthesizer')) {
      return Response.json({ output: { audio: { url: 'https://audio.fixture/test.wav' } } });
    }
    if (url === 'https://audio.fixture/test.wav') {
      return new Response(Buffer.from('fixture-wav-audio'), { headers: { 'Content-Type': 'audio/wav' } });
    }
    throw new Error(`unexpected fixture URL: ${url}`);
  }) as typeof fetch;

  const { POST } = await import('../src/app/api/ai/tts/route');
  const headers = new Headers({ Authorization: 'Bearer fixture-session-token', 'X-Request-ID': 'tts-contract-request' });
  const signal = new AbortController().signal;
  const missing = await POST({ json: async () => ({}), headers, signal } as never);
  assert.equal(missing.status, 400);

  const response = await POST({ json: async () => ({ text: '灵笔百炼语音路由测试。' }), headers, signal } as never);
  assert.equal(response.status, 200);
  const json = await response.json() as { audioUri: string; audioSize: number; provider: string; model: string };
  assert.equal(json.provider, 'aliyun-bailian-qwen-audio-tts');
  assert.equal(json.model, 'qwen-audio-3.0-tts-plus');
  assert.ok(json.audioUri.startsWith('/uploads/'));
  assert.ok(json.audioSize > 0);

  const localPath = path.join(process.cwd(), 'public', json.audioUri.replace(/^\//, ''));
  assert.ok(existsSync(localPath));
  assert.ok(statSync(localPath).size > 0);
  const providerRequest = seen.find(item => item.url.includes('/services/audio/tts/SpeechSynthesizer'));
  assert.equal(providerRequest?.authorization, 'Bearer sk-test-route-fixture');
  const body = JSON.parse(providerRequest?.body || '{}');
  assert.equal(body.model, 'qwen-audio-3.0-tts-plus');
  assert.equal(body.input.voice, 'longanhuan_v3.6');
  assert.equal(body.input.sample_rate, 24000);
  unlinkSync(localPath);

  console.log(JSON.stringify({ ok: true, checks: 12, provider: json.provider, model: json.model }));
} finally {
  globalThis.fetch = originalFetch;
  for (const name of names) {
    const value = originals[name];
    if (value === undefined) delete mutableEnv[name];
    else mutableEnv[name] = value;
  }
}
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
