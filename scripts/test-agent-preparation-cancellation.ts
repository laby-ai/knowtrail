import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/agent/chat/route';
import { ingestExtractedSource } from '../src/lib/ingestion-store';
import { buildGroundedRetrievalContext } from '../src/lib/grounded-retrieval';
import { embedTexts } from '../src/lib/runtime-embeddings';
import { fetchWithTransientRetry } from '../src/lib/runtime-ai-http';

async function main() {
  const previousEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-query-cancel-'));
  const workspace = `paper-user-${'a'.repeat(32)}`;
  const scope = { ownerMemberId: `paper-host:${workspace}`, notebookId: 'cancel-contract' };
  const config = { apiBase: 'https://isolated-provider.example.invalid/v1', apiKey: 'synthetic-provider-key', model: 'synthetic-model' };
  let providerCalls = 0;
  let providerAborted = false;
  let phase: 'pending' | 'normal' | 'retry' | 'late-body' = 'pending';
  let started: (() => void) | undefined;
  let releaseBody: (() => void) | undefined;
  try {
    for (const key of Object.keys(process.env)) if (/^(OPENAI|ARK|DATABASE_URL|ACCOUNT_CENTER|PAPER_HOST|KNOWTRAIL_LOCAL_QUOTA)/.test(key)) delete process.env[key];
    Object.assign(process.env, {
      SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(temporary, 'sources.json'),
      ZVEC_STORE_PATH: path.join(temporary, 'zvec'), STUDIO_DOCUMENT_STORE_DIR: path.join(temporary, 'documents'),
      PAPER_HOST_SESSION_VERIFY_URL: 'https://isolated-verify.example.invalid',
      OPENAI_COMPAT_API_BASE: config.apiBase, OPENAI_COMPAT_API_KEY: config.apiKey,
      OPENAI_COMPAT_MODEL: config.model, OPENAI_COMPAT_EMBEDDING_MODEL: 'synthetic-embedding',
      KNOWTRAIL_AGENT_PYTHON: process.execPath,
    });
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === 'https://isolated-verify.example.invalid') return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: workspace, capabilities: ['verified-sms-session'] } });
      assert.equal(url, `${config.apiBase}/embeddings`, 'No real provider or unrelated request is allowed');
      providerCalls++;
      const signal = init?.signal;
      if (phase === 'normal') return Response.json({ data: [{ index: 0, embedding: [1, 0, 0, 0] }] });
      if (phase === 'retry') return new Response('temporary fixture error', { status: 503 });
      if (phase === 'late-body') return new Response(new ReadableStream({ start(controller) {
        releaseBody = () => { controller.enqueue(new TextEncoder().encode('{"data":[{"index":0,"embedding":[1,0,0,0]}]}')); controller.close(); };
        started?.();
      } }));
      assert(signal, 'Question cancellation must reach the embedding transport');
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ data: [{ index: 0, embedding: [1, 0, 0, 0] }] })), 1_000);
        signal.addEventListener('abort', () => { clearTimeout(timer); providerAborted = true; reject(signal.reason); }, { once: true });
        started?.();
      });
    };
    await ingestExtractedSource({ id: 'cancel-source', ...scope, title: 'Cancellation fixture', fileName: 'cancel.txt', fileType: 'txt', rawContent: 'A controlled source about mirror diameters.' }, { embedder: async texts => texts.map(() => [1, 0, 0, 0]) });

    for (let attempt = 0; attempt < 2; attempt++) {
      providerAborted = false;
      const request = new AbortController();
      const ready = new Promise<void>(resolve => { started = resolve; });
      const pending = POST(new NextRequest('http://127.0.0.1/api/agent/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', userId: 'synthetic-user', token: 'synthetic-token' }, signal: request.signal,
        body: JSON.stringify({ message: 'What is the mirror diameter?', notebookId: scope.notebookId, papers: [{ id: 'cancel-source' }] }),
      }));
      await ready;
      request.abort(new DOMException('User stopped the fixture question', 'AbortError'));
      const response = await pending;
      assert.equal(providerAborted, true, 'Stop must abort preparation, before the Agent worker starts');
      assert.equal(response.status, 503, 'An interrupted preparation must not become a successful SSE or a busy retry');
      assert.doesNotMatch(await response.text(), /data: |citations/, 'Cancelled retrieval must not fall back to evidence and begin generation');
    }
    assert.equal(providerCalls, 2, 'Retry after Stop must reuse the released turn slot exactly once');

    const alreadyStopped = new AbortController(); alreadyStopped.abort();
    await assert.rejects(embedTexts(['query'], config, alreadyStopped.signal), { name: 'AbortError' });
    assert.equal(providerCalls, 2, 'An already-stopped call must not enter the transport');

    phase = 'late-body';
    const bodyRequest = new AbortController();
    const bodyReady = new Promise<void>(resolve => { started = resolve; });
    const bodyPending = embedTexts(['query'], config, bodyRequest.signal);
    await bodyReady; bodyRequest.abort(); releaseBody?.();
    await assert.rejects(bodyPending, { name: 'AbortError' });

    phase = 'retry';
    const retryRequest = new AbortController();
    const beforeRetryCalls = providerCalls;
    const retrying = fetchWithTransientRetry(`${config.apiBase}/embeddings`, { method: 'POST', signal: retryRequest.signal }, { attempts: 2 });
    await new Promise(resolve => setTimeout(resolve, 10)); retryRequest.abort();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      await assert.rejects(Promise.race([retrying, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('Cancellation did not interrupt retry wait')), 150); })]), { name: 'AbortError' });
    } finally { clearTimeout(watchdog); }
    assert.equal(providerCalls, beforeRetryCalls + 1, 'Cancelled backoff must not send another provider request');

    phase = 'normal';
    const grounded = await buildGroundedRetrievalContext('mirror diameter', [{ id: 'cancel-source' }], config, scope);
    assert.equal(grounded.retrievalMode, 'persisted-vector');
    assert.equal(grounded.citations[0]?.sourceId, 'cancel-source');
    const keyword = await buildGroundedRetrievalContext('mirror diameter', [{ id: 'cancel-source' }], undefined, scope);
    assert.equal(keyword.retrievalMode, 'persisted-keyword');
    assert.equal(keyword.citations[0]?.sourceId, 'cancel-source');
    console.log(JSON.stringify({ ok: true, cancelledPreparationAndRetry: true, lateBodyCancelled: true, cancelledBackoffNoRepeat: true, normalVectorAndKeywordRetained: true, actualProviderCalls: 0, syntheticTransportCalls: providerCalls }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    assert(temporary.startsWith(path.join(os.tmpdir(), 'knowtrail-query-cancel-')));
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
