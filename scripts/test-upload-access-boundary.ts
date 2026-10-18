import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const workspace = 'paper-user-' + 'a'.repeat(32);
const excerpt = 'We report the discovery of a system of seven Earth-sized planets around the nearby ultracool dwarf star TRAPPIST-1.';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-upload-access-'));
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  let sessionUnavailable = false;
  let internalCalls = 0;
  try {
    Object.assign(process.env, {
      PAPER_HOST_SESSION_VERIFY_URL: 'https://session-fixture.invalid/verify',
      OPENAI_COMPAT_API_BASE: 'https://provider-fixture.invalid/v1', OPENAI_COMPAT_API_KEY: 'fixture-not-a-secret',
      OPENAI_COMPAT_MODEL: 'text-fixture', OPENAI_COMPAT_VISION_MODEL: 'vision-fixture', OPENAI_COMPAT_EMBEDDING_MODEL: 'embedding-fixture',
      SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'),
      FILE_STORAGE_ADAPTER: 'local', LOCAL_FILE_STORAGE_DIR: path.join(directory, 'uploads'), ZVEC_STORE_PATH: path.join(directory, 'vectors'),
      INTERNAL_APP_ORIGIN: 'http://127.0.0.1:5099', NEXT_PUBLIC_BASE_PATH: '/knowtrail',
    });
    const { POST: analyze } = await import('../src/app/api/ai/analyze/route');
    const { POST: testConfig } = await import('../src/app/api/ai/test-config/route');
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://session-fixture.invalid/')) {
        if (sessionUnavailable) return Response.json({}, { status: 503 });
        const headers = new Headers(init?.headers);
        if (!(headers.get('cookie') || '').includes('token=valid')) return Response.json({}, { status: 401 });
        return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: workspace, capabilities: ['verified-sms-session'] } });
      }
      if (url.endsWith('/api/ai/analyze')) {
        internalCalls++;
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('cookie'), 'userId=fixture; token=valid', 'Internal extraction must carry the verified caller, not bypass auth');
        assert.equal(JSON.parse(String(init?.body)).notebookId, 'trappist-1');
        return analyze(new NextRequest(url, { method: 'POST', ...init, headers, signal: init?.signal ?? undefined }));
      }
      if (url.startsWith('https://provider-fixture.invalid/')) {
        providerCalls++;
        if (url.endsWith('/embeddings')) return Response.json({ data: [{ embedding: Array(4).fill(0.25) }] });
        return Response.json({ choices: [{ message: { content: JSON.stringify({ title: 'TRAPPIST-1', authors: ['Michaël Gillon'], year: 2017, content: excerpt, abstract: excerpt }) } }] });
      }
      throw new Error('Unexpected external request: ' + url);
    };
    const body = { fileName: '1703.01424v1.txt', fileType: 'txt', fileContent: excerpt };
    const request = (route: string, headers: Record<string, string>) => new NextRequest('https://workbench.invalid/knowtrail/api/ai/' + route, { method: 'POST', headers, body: JSON.stringify(route === 'analyze' ? body : {}) });
    for (const [name, handler] of [['analyze', analyze], ['test-config', testConfig]] as const) {
      for (const [headers, status] of [
        [{}, 401],
        [{ cookie: 'userId=fixture; token=invalid' }, 401],
        [{ cookie: 'userId=fixture; token=valid', 'x-paper-host': 'paper-web', 'x-paper-host-workspace': 'paper-user-' + 'b'.repeat(32) }, 403],
      ] as const) {
        const before = providerCalls;
        const response = await handler(request(name, headers));
        assert.equal(response.status, status, `${name} must enforce the existing server SMS boundary`);
        assert.match(response.headers.get('cache-control') || '', /no-store/);
        assert.equal(providerCalls, before, 'Denied requests must never reach a provider');
      }
      sessionUnavailable = true;
      const before = providerCalls;
      assert.equal((await handler(request(name, { cookie: 'userId=fixture; token=valid' }))).status, 503);
      assert.equal(providerCalls, before);
      sessionUnavailable = false;
      const response = await handler(request(name, { cookie: 'userId=fixture; token=valid' }));
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control') || '', /no-store/);
      assert.ok(providerCalls > before, 'Authorized requests must still execute the real model service module');
    }
    const { POST: upload } = await import('../src/app/api/upload/route');
    const form = new FormData();
    form.set('notebookId', 'trappist-1');
    form.append('files', new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')], '1703.01424v1-page-2.png', { type: 'image/png' }));
    const response = await upload(new NextRequest('https://workbench.invalid/knowtrail/api/upload', { method: 'POST', headers: { cookie: 'userId=fixture; token=valid' }, body: form }));
    const payload = await response.json() as { results: { error?: string; content?: string }[] };
    assert.equal(response.status, 200);
    assert.equal(internalCalls, 1);
    assert.equal(payload.results[0].error, undefined);
    assert.equal(payload.results[0].content, excerpt);
    console.log(JSON.stringify({ ok: true, deniedBeforeProvider: true, authorizedAnalysisAndConnectivity: true, uploadIdentityForwarded: true, paidCalls: 0, sessionAndProviderAreFixtures: true }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    assert.ok(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('knowtrail-upload-access-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
