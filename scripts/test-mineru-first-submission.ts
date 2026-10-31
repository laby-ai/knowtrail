import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server';
import * as store from '../src/lib/ingestion-store';
import * as jobs from '../src/lib/mineru-job';

let finished = false, activeCase = 'seed';
process.on('beforeExit', () => {
  if (!finished) { console.error(JSON.stringify({ ok: false, unsettledCase: activeCase })); process.exitCode = 1; }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-mineru-first-'));
  const sourcePath = path.join(directory, 'sources.json');
  process.env.SOURCE_STORE_ADAPTER = 'local-json'; process.env.SOURCE_STORE_PATH = sourcePath;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('External network forbidden in fixture'); };
  const route = new URL('../src/app/api/mineru/extract/route.ts', import.meta.url);
  const ast = ts.createSourceFile('route.ts', readFileSync(route, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'POST');
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, '') + '\nPOST;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let uploads = 0, downloads = 0, objectStorage = false;
  let upload = async () => ({ batchId: 'batch-' + ++uploads });
  let poll = async (batch: string) => 'https://result-fixture.invalid/' + batch;
  let download = async () => { downloads++; return path.join(directory, 'fixture.pdf'); };
  const post = vm.runInNewContext(code, { ...store, NextResponse, Buffer, path, require: createRequire(route),
    process: { cwd: () => directory }, console: { log() {}, error() {} }, MINERU_API_TOKEN: 'fixture-only',
    isUsingObjectStorage: () => objectStorage, downloadToTemp: () => download(), uploadToMinerU: () => upload(),
    pollExtractionResult: (batch: string) => poll(batch),
    downloadAndParseZip: async (url: string, id: string) => {
      const result = { paperId: id, batch: new URL(url).pathname.slice(1) };
      await writeFile(path.join(directory, 'result.json'), JSON.stringify(result));
      return { figures: [{ label: result.batch }], markdownContent: 'Existing fixture source' };
    },
  }) as (request: NextRequest) => Promise<NextResponse>;
  const request = () => new NextRequest('http://mineru-fixture.invalid/api/mineru/extract', { method: 'POST',
    body: JSON.stringify({ paperId: 'fixture-paper', fileKeyOrPath: 'fixture.pdf', fileName: 'fixture.pdf' }) });
  const seed = async () => {
    uploads = 0; downloads = 0; objectStorage = false;
    upload = async () => ({ batchId: 'batch-' + ++uploads });
    poll = async batch => 'https://result-fixture.invalid/' + batch;
    download = async () => { downloads++; return path.join(directory, 'fixture.pdf'); };
    await writeFile(sourcePath, JSON.stringify({ version: 1, sources: [], updatedAt: 'fixture' }));
    for (const id of ['fixture-paper', 'fixture-other']) await store.ingestExtractedSource({ id,
      ownerMemberId: id + '-owner', notebookId: id + '-book', fileName: id === 'fixture-paper' ? 'fixture.pdf' : 'other.txt',
      fileType: id === 'fixture-paper' ? 'pdf' : 'txt', fileKey: 'fixture.pdf', content: 'Original readable fixture source content must remain unchanged.' });
  };
  const passed: string[] = [], failures: string[] = [];
  const observations: Record<string, unknown> = {};
  const run = async (name: string, action: () => Promise<void>) => {
    activeCase = name; await seed();
    const protectedSource = JSON.stringify(await store.getIngestionSource('fixture-other'));
    try { await action(); assert.equal(JSON.stringify(await store.getIngestionSource('fixture-other')), protectedSource); passed.push(name); }
    catch (error) { failures.push(name + ': ' + (error instanceof Error ? error.message : String(error))); }
  };
  try {
    await run('concurrent first requests submit once before any batch checkpoint', async () => {
      const started = deferred<void>(), release = deferred<void>();
      upload = async () => { const batchId = 'batch-' + ++uploads; if (uploads === 1) { started.resolve(); await release.promise; } return { batchId }; };
      const first = post(request()); await started.promise;
      let second!: NextResponse;
      try { second = await post(request()); } finally { release.resolve(); await first; }
      const source = await store.getIngestionSource('fixture-paper');
      observations.concurrent = { uploads, secondStatus: second.status, finalStatus: source?.mineru?.status };
      assert.equal(uploads, 1); assert.equal(second.status, 409); assert.equal(source?.mineru?.status, 'succeeded');
      assert.equal(JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')).batch, 'batch-1');
    });
    await run('provider response lost before checkpoint is not submitted again', async () => {
      upload = async () => { uploads++; throw new Error('fixture ECONNRESET after provider acceptance'); };
      const first = await post(request()), second = await post(request());
      observations.responseLost = { uploads, firstStatus: first.status, secondStatus: second.status };
      assert.equal(first.status, 500); assert.equal(second.status, 409); assert.equal(uploads, 1);
      const saved = JSON.parse(await readFile(sourcePath, 'utf8')).sources.find((item: { id: string }) => item.id === 'fixture-paper');
      assert.equal(typeof saved.mineru.submissionStartedAt, 'string');
      assert.equal(saved.mineru.status, 'failed'); assert.equal(saved.status, 'succeeded');
    });
    await run('late request timeout cannot fail an owned running job and worker completion persists success', async () => {
      const started = deferred<void>(), release = deferred<void>();
      upload = async () => { uploads++; started.resolve(); await release.promise; return { batchId: 'batch-1' }; };
      const pending = post(request()); await started.promise;
      let during: string | undefined;
      try {
        const failure = { error: 'fixture caller timeout', requestOnly: true };
        await store.updateSourceMinerUStatus('fixture-paper', 'failed', failure);
        during = (await store.getIngestionSource('fixture-paper'))?.mineru?.status;
      } finally { release.resolve(); await pending; }
      const after = (await store.getIngestionSource('fixture-paper'))?.mineru?.status;
      observations.timeout = { during, after };
      assert.equal(during, 'running'); assert.equal(after, 'succeeded');
    });
    await run('actual upload coordinator timeout keeps worker ownership and eventual saved success', async () => {
      Object.assign(process.env, { MINERU_API_TOKEN: 'fixture-only', MINERU_JOB_TIMEOUT_MS: '300', MINERU_JOB_MAX_RETRIES: '1', MINERU_JOB_RETRY_DELAY_MS: '1' });
      const release = deferred<void>(), pendingResponses: Array<Promise<NextResponse>> = [];
      let requests = 0;
      upload = async () => { uploads++; await release.promise; return { batchId: 'batch-1' }; };
      const uploadRoute = new URL('../src/app/api/upload/route.ts', import.meta.url);
      const uploadAst = ts.createSourceFile('upload.ts', readFileSync(uploadRoute, 'utf8'), ts.ScriptTarget.Latest, true);
      const declarations = uploadAst.statements.filter(node => ts.isFunctionDeclaration(node) && ['sleep', 'triggerMinerUExtraction'].includes(node.name?.text || ''));
      assert.equal(declarations.length, 2);
      const triggerCode = ts.transpileModule(declarations.map(node => node.getText(uploadAst)).join('\n') + '\ntriggerMinerUExtraction;', {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText;
      const trigger = vm.runInNewContext(triggerCode, { ...store, ...jobs, process, AbortController, setTimeout, clearTimeout,
        console: { log() {}, error() {} }, fetch: (_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
          requests++;
          const pending = post(new NextRequest('http://mineru-fixture.invalid/api/mineru/extract', {
            ...init, signal: init.signal || undefined,
          }));
          pendingResponses.push(pending); pending.then(resolve, reject);
          init.signal?.addEventListener('abort', () => reject(new Error('fixture caller aborted')), { once: true });
        }),
      }) as (id: string, key: string, file: string, origin: string) => Promise<void>;
      let during: string | undefined;
      try {
        await trigger('fixture-paper', 'fixture.pdf', 'fixture.pdf', 'http://mineru-fixture.invalid');
        during = (await store.getIngestionSource('fixture-paper'))?.mineru?.status;
      } finally { release.resolve(); await Promise.all(pendingResponses); }
      const after = (await store.getIngestionSource('fixture-paper'))?.mineru?.status;
      observations.actualCoordinator = { requests, uploads, during, after };
      assert.equal(requests, 2); assert.equal(uploads, 1); assert.equal(during, 'running'); assert.equal(after, 'succeeded');
    });
    await run('completed job survives a delayed caller error', async () => {
      await post(request()); await store.updateSourceMinerUStatus('fixture-paper', 'succeeded', { figureCount: 1 });
      const error = { error: 'fixture stale caller error', requestOnly: true };
      await store.updateSourceMinerUStatus('fixture-paper', 'error', error);
      assert.equal((await store.getIngestionSource('fixture-paper'))?.mineru?.status, 'succeeded');
    });
    await run('a request that never started a job still records its original failure', async () => {
      const error = { error: 'fixture app unreachable', requestOnly: true };
      await store.updateSourceMinerUStatus('fixture-paper', 'failed', error);
      assert.equal((await store.getIngestionSource('fixture-paper'))?.mineru?.status, 'failed');
      assert.equal(uploads, 0);
    });
    await run('confirmed worker failure persists without destroying the readable source', async () => {
      poll = async () => { throw new Error('fixture confirmed upstream failure'); };
      assert.equal((await post(request())).status, 500);
      const source = await store.getIngestionSource('fixture-paper');
      assert.equal(source?.mineru?.status, 'failed'); assert.equal(source?.status, 'succeeded');
      assert.match(source?.mineru?.error || '', /confirmed upstream failure/);
    });
    await run('transient raw-file failure before submission can retry normally', async () => {
      objectStorage = true;
      download = async () => { if (++downloads === 1) throw new Error('fixture temporary download failure'); return path.join(directory, 'fixture.pdf'); };
      assert.equal((await post(request())).status, 500); assert.equal(uploads, 0);
      assert.equal((await post(request())).status, 200); assert.equal(uploads, 1); assert.equal(downloads, 2);
    });
    console.log(JSON.stringify({ ok: !failures.length, passed, failures, observations,
      actualPostAndAtomicLocalSourceStore: true, providerAndResultAdapterAreFixtures: true,
      realUploads: 0, externalRequests: 0, paidCalls: 0 }));
    assert.equal(failures.length, 0, failures.join('\n'));
  } finally {
    globalThis.fetch = originalFetch;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('knowtrail-mineru-first-'));
    await rm(directory, { recursive: true, force: true }); finished = true;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
