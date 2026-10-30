import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { claimSourceMinerUSubmission, ingestExtractedSource, getIngestionSource, updateSourceMinerUStatus, deleteIngestionSource, buildSourceStoreFromPostgresRows } from '../src/lib/ingestion-store';
import { classifyMinerUJobFailure } from '../src/lib/mineru-job';

const root = new URL('../', import.meta.url);
function load<T>(file: string, name: string, globals: Record<string, unknown>): T {
  const url = new URL(file, root);
  const source = ts.createSourceFile(file, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  const code = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, '') + `\n${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(code, { console: { log() {}, warn() {}, error() {} }, Buffer, path,
    require: createRequire(url), setTimeout, clearTimeout, ...globals }) as T;
}

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-mineru-retry-'));
  const originalFetch = globalThis.fetch;
  process.env.SOURCE_STORE_ADAPTER = 'local-json';
  process.env.SOURCE_STORE_PATH = path.join(directory, 'sources.json');
  globalThis.fetch = async () => { throw new Error('External network forbidden'); };
  const scope = { ownerMemberId: 'fixture-owner', notebookId: 'fixture-book' };
  const failures: string[] = [], passed: string[] = [];
  const observations: Record<string, unknown> = {};
  let providerUploads = 0, zipDownloads = 0, pollCalls = 0;
  let objectStorage = false, rawDownloads = 0;
  const zipFor = async (batch: string) => {
    const zip = new JSZip();
    zip.file('paper_content_list.json', JSON.stringify([{ type: 'image', img_path: 'images/figure.png', page_idx: 0, bbox: [0, 0, 400, 300], caption: [`Figure 1 ${batch}`] }]));
    zip.file('images/figure.png', Buffer.from('fixture-image-bytes:' + batch));
    zip.file('full.md', 'Original fixture text ' + batch);
    return zip.generateAsync({ type: 'nodebuffer' });
  };
  const localProcess = { cwd: () => directory };
  const metadata = load<(data: string, id: string) => Promise<unknown>>('src/lib/storage.ts', 'storeMinerUMetadata', { process: localProcess, useObjectStorage: false });
  const parse = load<(url: string, id: string) => Promise<{ figures: unknown[]; markdownContent: string }>>('src/app/api/mineru/extract/route.ts', 'downloadAndParseZip', {
    process: localProcess, mkdir, writeFile, isUsingObjectStorage: () => false, storeMinerUMetadata: metadata,
    fetch: async (url: string) => { zipDownloads++; return new Response(new Uint8Array(await zipFor(new URL(url).pathname.slice(1)))); },
  });
  let poll = async (batch: string) => { pollCalls++; return 'https://mineru-fixture.invalid/' + batch; };
  let checkpoint = updateSourceMinerUStatus;
  const post = load<(request: NextRequest) => Promise<NextResponse>>('src/app/api/mineru/extract/route.ts', 'POST', {
    process: localProcess, NextResponse, MINERU_API_TOKEN: 'fixture-only', isUsingObjectStorage: () => objectStorage,
    downloadToTemp: async () => { rawDownloads++; return path.join(directory, 'fixture.pdf'); },
    getIngestionSource, claimSourceMinerUSubmission, updateSourceMinerUStatus: (...args: Parameters<typeof updateSourceMinerUStatus>) => checkpoint(...args),
    uploadToMinerU: async () => ({ batchId: 'batch-' + ++providerUploads, uploadUrl: 'https://upload-fixture.invalid' }),
    pollExtractionResult: (batch: string) => poll(batch), downloadAndParseZip: parse,
  });
  const seed = async () => {
    providerUploads = 0; zipDownloads = 0; pollCalls = 0; rawDownloads = 0;
    await writeFile(process.env.SOURCE_STORE_PATH!, JSON.stringify({ version: 1, sources: [], updatedAt: 'fixture' }));
    await ingestExtractedSource({ id: 'fixture-paper', ...scope, fileName: 'fixture.pdf', fileKey: 'fixture.pdf', fileType: 'pdf', content: 'Existing fixture document with sufficient readable content.' });
    await ingestExtractedSource({ id: 'fixture-other', ownerMemberId: 'other-owner', notebookId: 'other-book', fileName: 'other.txt', fileType: 'txt', content: 'Original separate fixture record must remain unchanged.' });
  };
  const request = (patch: Record<string, unknown> = {}, signal?: AbortSignal) => new NextRequest('http://mineru-fixture.invalid/api/mineru/extract', {
    method: 'POST', body: JSON.stringify({ paperId: 'fixture-paper', fileKeyOrPath: 'fixture.pdf', fileName: 'fixture.pdf', ...patch }), signal,
  });
  const run = async (name: string, action: () => Promise<void>) => {
    await seed();
    const other = JSON.stringify(await getIngestionSource('fixture-other'));
    try { await action(); assert.equal(JSON.stringify(await getIngestionSource('fixture-other')), other); passed.push(name); }
    catch (error) { failures.push(name + ': ' + (error instanceof Error ? error.message : String(error))); }
  };
  try {
    await run('normal existing PDF retains its source and actual ZIP content', async () => {
      assert.equal((await post(request())).status, 200);
      const saved = await getIngestionSource('fixture-paper', scope);
      assert.equal(saved?.ownerMemberId, scope.ownerMemberId); assert.equal(saved?.notebookId, scope.notebookId);
      const file = JSON.parse(await readFile(path.join(directory, 'public/mineru-figures/fixture-paper/_metadata.json'), 'utf8'));
      assert.equal(file[0].caption, 'Figure 1 batch-1');
      assert.equal(await readFile(path.join(directory, 'public/mineru-figures/fixture-paper/fig-1.png'), 'utf8'), 'fixture-image-bytes:batch-1');
      assert.equal(providerUploads, 1);
    });
    await run('repeat extraction resumes the persisted batch instead of submitting again', async () => {
      await post(request()); await post(request()); assert.equal(providerUploads, 1);
    });
    await run('resuming a submitted batch does not download the original file again', async () => {
      objectStorage = true;
      try { await post(request()); await post(request()); }
      finally { objectStorage = false; }
      assert.equal(rawDownloads, 1); assert.equal(providerUploads, 1);
    });
    await run('timed-out first request and retry keep one submitted job and identical saved content', async () => {
      let release!: () => void, submitted!: () => void;
      const started = new Promise<void>(resolve => { submitted = resolve; });
      const originalPoll = poll;
      poll = async batch => {
        pollCalls++;
        if (pollCalls === 1) { submitted(); await new Promise<void>(resolve => { release = resolve; }); }
        return 'https://mineru-fixture.invalid/' + batch;
      };
      const controller = new AbortController();
      const first = post(request({}, controller.signal));
      await started; controller.abort();
      let beforeLateResult = '';
      try {
        assert.equal((await post(request())).status, 200);
        beforeLateResult = await readFile(path.join(directory, 'public/mineru-figures/fixture-paper/_metadata.json'), 'utf8');
      }
      finally { release(); await first; poll = originalPoll; }
      observations.lateResult = { providerUploads, beforeLateResult: JSON.parse(beforeLateResult)[0].caption,
        afterLateResult: JSON.parse(await readFile(path.join(directory, 'public/mineru-figures/fixture-paper/_metadata.json'), 'utf8'))[0].caption };
      assert.equal(providerUploads, 1, 'Retry must resume the original submitted batch');
      assert.equal(zipDownloads, 2, 'Committed background work continues; no browser clock or provider call');
      const file = JSON.parse(await readFile(path.join(directory, 'public/mineru-figures/fixture-paper/_metadata.json'), 'utf8'));
      assert.equal(file[0].caption, 'Figure 1 batch-1');
    });
    await run('wrong original file identity is rejected before provider submission', async () => {
      assert.equal((await post(request({ fileKeyOrPath: 'different.pdf' }))).status, 409);
      assert.equal(providerUploads, 0);
    });
    await run('deleted source is not submitted or recreated', async () => {
      await deleteIngestionSource('fixture-paper', scope);
      assert.equal((await post(request())).status, 404); assert.equal(providerUploads, 0);
      assert.equal(await getIngestionSource('fixture-paper'), undefined);
    });
    await run('job identity survives caller running/failure/success status updates', async () => {
      await post(request());
      await updateSourceMinerUStatus('fixture-paper', 'failed', { error: 'fixture timeout' });
      await updateSourceMinerUStatus('fixture-paper', 'running');
      await post(request());
      await updateSourceMinerUStatus('fixture-paper', 'succeeded', { figureCount: 1 });
      assert.equal(providerUploads, 1);
      assert.equal(Reflect.get((await getIngestionSource('fixture-paper'))?.mineru || {}, 'batchId'), 'batch-1');
    });
    await run('checkpoint failure stops ambiguous submission without auto-retry response', async () => {
      checkpoint = async () => { throw new Error('fixture storage unavailable'); };
      try {
        const response = await post(request());
        assert.equal(response.status, 409);
        assert.equal(classifyMinerUJobFailure({ status: response.status }).retryable, false);
      }
      finally { checkpoint = updateSourceMinerUStatus; }
      assert.equal(providerUploads, 1); assert.equal(zipDownloads, 0);
    });
    await run('existing Postgres payload mapping retains optional job identity without schema migration', async () => {
      const source = await getIngestionSource('fixture-paper'); assert.ok(source);
      const store = buildSourceStoreFromPostgresRows({ sources: [{ id: source.id, file_name: source.fileName,
        file_type: source.fileType, title: source.title, short_name: source.shortName, vector_status: 'not_configured',
        status: source.status, created_at: source.createdAt, updated_at: source.updatedAt,
        payload: { ...source, mineru: { status: 'running', batchId: 'fixture-persisted', submissionStartedAt: source.createdAt, updatedAt: source.updatedAt } } }], chunks: [], stages: [] });
      assert.equal(Reflect.get(store.sources[0].mineru || {}, 'batchId'), 'fixture-persisted');
      assert.equal(Reflect.get(store.sources[0].mineru || {}, 'submissionStartedAt'), source.createdAt);
    });
    console.log(JSON.stringify({ ok: !failures.length, passed, failures, observations, actualPostZipParserAndLocalMetadataWriter: true,
      actualLocalJsonSourceStore: true, providerAndScopeAreFixtures: true, externalRequests: 0, paidCalls: 0, realUploads: 0 }));
    assert.equal(failures.length, 0, failures.join('\n'));
  } finally {
    globalThis.fetch = originalFetch;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('knowtrail-mineru-retry-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
