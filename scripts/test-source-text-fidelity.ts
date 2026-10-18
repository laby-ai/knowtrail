import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { mock } from 'node:test';
import dns from 'node:dns/promises';
import http, { type ClientRequest, IncomingMessage } from 'node:http';
import https from 'node:https';
import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { NextRequest } from 'next/server';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-source-fidelity-'));
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, { FILE_STORAGE_ADAPTER: 'local', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'), LOCAL_FILE_STORAGE_DIR: path.join(directory, 'uploads'), PAPER_HOST_SESSION_VERIFY_URL: 'https://sms-fixture.invalid/session', OPENAI_COMPAT_API_KEY: '', OPENAI_API_KEY: '', ARK_API_KEY: '', DASHSCOPE_API_KEY: '' });
    globalThis.fetch = async input => {
      assert.ok(String(input).startsWith('https://sms-fixture.invalid/'), 'No model or external network call is allowed');
      return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: 'paper-user-' + 'a'.repeat(32), capabilities: ['verified-sms-session'] } });
    };
    const source = Array.from({ length: 800 }, (_, i) => `Neutral software fixture paragraph ${i}: long document preservation without scientific measurements.`).join('\n\n') + '\n\nLONGTAIL_729: retained=61; sample_unit=mock_samples. Software fixture only.';
    assert.ok(source.indexOf('LONGTAIL_729') > 60_000);
    const native = (url: URL, _options: http.RequestOptions, callback: (message: IncomingMessage) => void): ClientRequest => {
      const request = Object.assign(new EventEmitter(), { end() {
        const response = new IncomingMessage(new Socket());
        response.statusCode = 200;
        response.headers = { 'content-type': url.pathname.endsWith('.txt') ? 'text/plain' : 'text/html' };
        queueMicrotask(() => { callback(response); response.push(url.pathname.endsWith('.txt') ? source : `<html><title>Long source fidelity</title><article><pre>${source}</pre></article></html>`); response.push(null); });
      } });
      return request as unknown as ClientRequest;
    };
    mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
    mock.method(https, 'request', native);
    const { POST: fetchSource } = await import('../src/app/api/discover/fetch/route');
    for (const suffix of ['/long', '/long.txt']) {
      const response = await fetchSource(new NextRequest('https://knowtrail-fixture.invalid/api/discover/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'userId=fixture; token=fixture-valid-a' }, body: JSON.stringify({ notebookId: 'fidelity-contract', url: 'https://public-source-fixture.example' + suffix }) }));
      assert.equal(response.status, 200);
      const result = await response.json() as { text: string };
      assert.equal(result.text, suffix.endsWith('.txt') ? source : source.replace(/\n+/g, '\n'));
    }
    const { POST: upload } = await import('../src/app/api/upload/route');
    const form = new FormData();
    form.set('notebookId', 'fidelity-contract'); form.append('files', new File([source], 'long-source.txt', { type: 'text/plain' }));
    const response = await upload(new NextRequest('https://knowtrail-fixture.invalid/api/upload', { method: 'POST', headers: { Cookie: 'userId=fixture; token=fixture-valid-a' }, body: form }));
    assert.equal(response.status, 200);
    const result = await response.json() as { results: { id: string; rawContent: string; error?: string }[] };
    assert.equal(result.results[0].error, undefined); assert.equal(result.results[0].rawContent, source);
    const persisted = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8')) as { sources: { id: string; rawContent: string; chunks: { text: string }[] }[] };
    assert.equal(persisted.sources[0].rawContent, source);
    assert.ok(persisted.sources[0].chunks.some(chunk => chunk.text.includes('retained=61')));
    const { buildGroundedRetrievalContext } = await import('../src/lib/grounded-retrieval');
    const grounded = await buildGroundedRetrievalContext('LONGTAIL_729', [{ id: result.results[0].id }], undefined, { ownerMemberId: 'paper-host:paper-user-' + 'a'.repeat(32), notebookId: 'fidelity-contract' });
    assert.equal(grounded.persistedSourceCount, 1);
    assert.ok(grounded.promptContext.includes('retained=61') && grounded.promptContext.includes('sample_unit=mock_samples'));
    assert.ok(grounded.promptContext.length < 9000);
    console.log(JSON.stringify({ ok: true, originalChars: source.length, checks: ['actual HTML and plain-text route preserves tail', 'actual upload and stored raw content preserve every character', 'all stored chunks and ID-only retrieval reach tail within prompt budget'], paidCalls: 0 }));
  } finally {
    globalThis.fetch = originalFetch; mock.restoreAll();
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(directory).startsWith('knowtrail-source-fidelity-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
