import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-image-failure-'));
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const workspace = 'paper-user-' + 'a'.repeat(32);
  const cookie = 'userId=fixture; token=valid';
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const excerpt = 'We report the discovery of a system of seven Earth-sized planets around the nearby ultracool dwarf star TRAPPIST-1.';
  let mode = 'vision-failed';
  let textCalls = 0;
  let embeddingCalls = 0;
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
    const { POST: upload } = await import('../src/app/api/upload/route');
    const { GET: getSource } = await import('../src/app/api/ingestion/sources/route');
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://session-fixture.invalid/')) return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: workspace, capabilities: ['verified-sms-session'] } });
      if (url.endsWith('/api/ai/analyze')) {
        if (mode === 'network-failed') throw new Error('Internal analysis is unavailable');
        return analyze(new NextRequest(url, { ...init, headers: new Headers(init?.headers), signal: init?.signal ?? undefined }));
      }
      if (url.startsWith('https://provider-fixture.invalid/')) {
        if (url.endsWith('/embeddings')) { embeddingCalls++; return Response.json({ data: [{ embedding: Array(4).fill(0.25) }] }); }
        const body = JSON.parse(String(init?.body)) as { messages: { content: unknown }[] };
        const vision = Array.isArray(body.messages.at(-1)?.content);
        if (!vision) textCalls++;
        if (vision && mode === 'vision-failed') return Response.json({ error: { message: 'Vision unavailable' } }, { status: 400 });
        const content = mode === 'invalid-output' ? 'Vision service unavailable' : JSON.stringify({ title: 'TRAPPIST-1', content: mode === 'empty-output' ? ' ' : excerpt });
        return Response.json({ choices: [{ message: { content } }] });
      }
      throw new Error('Unexpected external request: ' + url);
    };
    const direct = await analyze(new NextRequest('https://workbench.invalid/knowtrail/api/ai/analyze', { method: 'POST', headers: { cookie }, body: JSON.stringify({ fileName: '1703.01424v1-page-2.png', fileType: 'png', imageBase64: 'data:image/png;base64,' + image.toString('base64') }) }));
    assert.equal(direct.status, 502, 'Vision failure must not fall back to a text model that has never seen the image');
    assert.equal(textCalls, 0);
    for (mode of ['vision-failed', 'network-failed', 'invalid-output', 'empty-output', 'success']) {
      const form = new FormData();
      form.set('notebookId', 'trappist-1-' + mode);
      form.append('files', new File([image], '1703.01424v1-page-2.png', { type: 'image/png' }));
      const before = embeddingCalls;
      const response = await upload(new NextRequest('https://workbench.invalid/knowtrail/api/upload', { method: 'POST', headers: { cookie }, body: form }));
      const payload = await response.json() as { results: { id: string; error?: string }[] };
      const result = payload.results[0];
      const restored = await getSource(new NextRequest(`https://workbench.invalid/knowtrail/api/ingestion/sources?id=${result.id}&notebookId=trappist-1-${mode}`, { headers: { cookie } }));
      assert.equal(restored.status, 200, 'The uploaded original and failure state must remain owned and recoverable');
      const { source } = await restored.json() as { source: { status: string; ownerMemberId: string; storageKey: string; content?: string; chunks: unknown[]; error?: string; stages: { name: string; status: string }[] } };
      assert.equal(source.ownerMemberId, 'paper-host:' + workspace);
      assert.deepEqual(await readFile(path.join(directory, 'uploads', path.basename(source.storageKey))), image);
      if (mode === 'success') {
        assert.equal(result.error, undefined);
        assert.equal(source.status, 'succeeded');
        assert.equal(source.content, excerpt);
        assert.ok(source.chunks.length > 0);
      } else {
        assert.ok(result.error && source.error);
        assert.equal(source.status, 'failed');
        assert.equal(source.stages.find(stage => stage.name === 'extract')?.status, 'failed');
        assert.equal(source.chunks.length, 0);
        assert.ok(!source.content, 'A failed image must have no invented searchable text');
        assert.equal(embeddingCalls, before);
      }
      assert.equal(textCalls, 0);
    }
    console.log(JSON.stringify({ ok: true, visionNetworkAndMalformedFailuresExplicit: true, originalBytesAndFailureRestored: true, filenameFallbackCalls: textCalls, paidCalls: 0, sessionAndProviderAreFixtures: true }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    assert.equal(path.dirname(directory), os.tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
