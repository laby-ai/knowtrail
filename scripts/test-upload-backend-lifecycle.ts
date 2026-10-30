import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server';
import {
  ingestExtractedSource, recordSourceExtractionFailure, updateSourceMinerUStatus,
  listIngestionSources, deleteIngestionSource,
} from '../src/lib/ingestion-store';
import { classifyMinerUJobFailure, mineruJobErrorMessage, mineruJobOptionsFromEnv } from '../src/lib/mineru-job';
import { sourceBibliography } from '../src/lib/source-bibliography';

const routePath = new URL('../src/app/api/upload/route.ts', import.meta.url);
const text = readFileSync(routePath, 'utf8');
const ast = ts.createSourceFile('route.ts', text, ts.ScriptTarget.Latest, true);
function declaration(name: string): string {
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node.getText(ast).replace(/^export\s+/, '');
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === name)) return node.getText(ast);
  }
  throw new Error(`Missing actual declaration: ${name}`);
}
function load<T>(name: string, names: string[], globals: Record<string, unknown>): T {
  const code = ts.transpileModule(names.map(declaration).join('\n') + `\n${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(code, {
    console: { log() {}, error() {} }, process, Buffer, Headers, AbortController,
    setTimeout, clearTimeout, path, require: createRequire(routePath), ...globals,
  }) as T;
}

type Scope = { ownerMemberId: string; notebookId: string };
type UploadBody = { results: Array<{ id?: string; fileName: string; error?: string }> };
const scopeA: Scope = { ownerMemberId: 'fixture-owner-a', notebookId: 'fixture-book-a' };
const scopeB: Scope = { ownerMemberId: 'fixture-owner-b', notebookId: 'fixture-book-b' };
const sourceText = 'A fixture document about measuring stellar spectra. Its original data must remain readable.';
let currentCase = 'seed';
let finished = false;
process.on('beforeExit', () => {
  if (!finished) {
    console.error(JSON.stringify({ ok: false, unsettledCase: currentCase }));
    process.exitCode = 1;
  }
});

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-backend-lifecycle-'));
  const originalFetch = globalThis.fetch;
  const failures: string[] = [];
  const passed: string[] = [];
  let fixtureInternalRequests = 0;
  Object.assign(process.env, {
    SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'),
    MINERU_API_TOKEN: '', MINERU_JOB_TIMEOUT_MS: '100', MINERU_JOB_MAX_RETRIES: '1', MINERU_JOB_RETRY_DELAY_MS: '1',
  });
  globalThis.fetch = async () => { throw new Error('External network forbidden in fixture'); };
  const sourceStore = path.join(directory, 'sources.json');
  await mkdir(path.join(directory, 'uploads'));
  const seed = await ingestExtractedSource({
    id: 'fixture-existing', ...scopeB, title: 'Existing fixture', fileName: 'existing.pdf',
    fileType: 'pdf', fileSize: sourceText.length, content: sourceText, rawContent: sourceText,
  });
  const initial = await readFile(sourceStore);
  const reset = () => writeFile(sourceStore, initial);
  const runCase = async (name: string, action: () => Promise<void>) => {
    currentCase = name;
    await reset();
    try { await action(); passed.push(name); }
    catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  };

  try {
    const actualRead = load<(file: string, ext: string) => Promise<string>>('readFileContent', ['isImageType', 'readFileContent'], {});
    let parseHook = async (file: string, ext: string) => actualRead(file, ext);
    let analyze = async () => Response.json({ success: true, analysis: { title: 'Image fixture', content: sourceText } });
    let writes = 0;
    const upload = load<(request: NextRequest) => Promise<NextResponse>>('POST', [
      'SUPPORTED_TYPES', 'DEFAULT_MAX_UPLOAD_BYTES', 'DEFAULT_MAX_UPLOAD_FILES',
      'readPositiveIntEnv', 'maxUploadBytes', 'maxUploadFiles', 'formatBytes',
      'getFileExt', 'isImageType', 'shouldAnalyzeUploadWithAI', 'POST',
    ], {
      NextResponse, sourceBibliography, ingestExtractedSource, recordSourceExtractionFailure,
      updateSourceMinerUStatus, isProduction: () => false,
      resolveAccountNotebookScope: async (request: NextRequest, input: { notebookId: unknown }) => ({
        ok: true, ownerMemberId: request.headers.get('x-fixture-owner') || scopeA.ownerMemberId,
        notebookId: input.notebookId,
      }),
      parseRuntimeAIConfigJson: () => undefined, resolveServerRuntimeAIConfig: () => ({}),
      resolveInternalAppOrigin: () => 'http://upload-fixture.invalid',
      storeFile: async (buffer: Buffer, name: string) => {
        const localPath = path.join(directory, 'uploads', `${++writes}-${name}`);
        await writeFile(localPath, buffer);
        return { key: localPath, localPath };
      },
      readFileContent: (file: string, ext: string) => parseHook(file, ext),
      fetch: async (_input: unknown, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { notebookId: string };
        assert.equal(body.notebookId, scopeA.notebookId);
        fixtureInternalRequests++;
        return analyze();
      },
    });
    const request = (names: string[], signal?: AbortSignal, scope = scopeA) => {
      const form = new FormData(); form.set('notebookId', scope.notebookId);
      for (const name of names) form.append('files', new File([sourceText], name));
      return new NextRequest('http://upload-fixture.invalid/api/upload', {
        method: 'POST', headers: { 'x-fixture-owner': scope.ownerMemberId }, body: form, signal,
      });
    };
    const body = async (response: NextResponse) => response.json() as Promise<UploadBody>;

    await runCase('normal upload persists its original owner/notebook and original text', async () => {
      const data = await body(await upload(request(['normal.txt'])));
      const rows = await listIngestionSources(scopeA);
      assert.equal(rows.length, 1); assert.equal(rows[0].id, data.results[0].id);
      assert.equal(rows[0].rawContent, sourceText); assert.equal(rows[0].status, 'succeeded');
      assert.deepEqual((await listIngestionSources(scopeB)).map(row => row.id), [seed.id]);
    });
    await runCase('already aborted request starts no file write and adds no source', async () => {
      const controller = new AbortController(); controller.abort(); const before = writes;
      await upload(request(['aborted.txt'], controller.signal));
      assert.equal(writes, before); assert.ok((await readFile(sourceStore)).equals(initial), 'Original source store bytes must stay unchanged');
    });
    await runCase('abort after extraction prevents a new source commit', async () => {
      const controller = new AbortController();
      parseHook = async (file, ext) => { const content = await actualRead(file, ext); controller.abort(); return content; };
      try { await upload(request(['cancel-read.txt'], controller.signal)); }
      finally { parseHook = actualRead; }
      assert.ok((await readFile(sourceStore)).equals(initial), 'Original source store bytes must stay unchanged');
    });
    for (const success of [true, false]) {
      await runCase(`abort during image response cannot persist ${success ? 'success' : 'failure'} row`, async () => {
        const controller = new AbortController();
        analyze = async () => { controller.abort(); return Response.json(success
          ? { success: true, analysis: { title: 'Image fixture', content: sourceText } }
          : { success: false, error: 'fixture extraction error' }); };
        try { await upload(request(['cancel-image.png'], controller.signal)); }
        finally { analyze = async () => Response.json({ success: true, analysis: { title: 'Image fixture', content: sourceText } }); }
        assert.ok((await readFile(sourceStore)).equals(initial), 'Original source store bytes must stay unchanged');
      });
    }
    await runCase('partial batch preserves the committed first file and does not start the third', async () => {
      const controller = new AbortController(); const before = writes;
      parseHook = async (file, ext) => { const content = await actualRead(file, ext); if (file.endsWith('second.txt')) controller.abort(); return content; };
      let data: UploadBody;
      try { data = await body(await upload(request(['first.txt', 'second.txt', 'third.txt'], controller.signal))); }
      finally { parseHook = actualRead; }
      assert.deepEqual((await listIngestionSources(scopeA)).map(row => row.fileName), ['first.txt']);
      assert.equal(data.results[0].error, undefined); assert.equal(writes - before, 2);
      assert.deepEqual((await listIngestionSources(scopeB)).map(row => row.id), [seed.id]);
    });
    await runCase('uncancelled image extraction failure retains its own failed source', async () => {
      analyze = async () => Response.json({ success: false, error: 'fixture extraction error' });
      let data: UploadBody;
      try { data = await body(await upload(request(['failed-image.png']))); }
      finally { analyze = async () => Response.json({ success: true, analysis: { title: 'Image fixture', content: sourceText } }); }
      const rows = await listIngestionSources(scopeA); assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'failed'); assert.match(data.results[0].error || '', /fixture extraction error/);
      assert.deepEqual((await listIngestionSources(scopeB)).map(row => row.id), [seed.id]);
    });

    process.env.MINERU_API_TOKEN = 'fixture-only';
    const makeJob = (request: typeof fetch) => load<(id: string, key: string, file: string, origin: string) => Promise<void>>(
      'triggerMinerUExtraction', ['sleep', 'triggerMinerUExtraction'], {
        fetch: request, updateSourceMinerUStatus, classifyMinerUJobFailure,
        mineruJobErrorMessage, mineruJobOptionsFromEnv,
      },
    );
    for (const status of [200, 503]) {
      await runCase(`MinerU timeout covers stalled ${status} response body`, async () => {
        const release: Array<() => void> = []; let calls = 0; let releasing = false;
        const trigger = makeJob(async (_url, init) => {
          calls++; fixtureInternalRequests++;
          if (releasing) return new Response('{"figureCount":1}', { status });
          return new Response(new ReadableStream<Uint8Array>({ start(stream) {
            let closed = false;
            init?.signal?.addEventListener('abort', () => { if (!closed) { closed = true; stream.error(new Error('fixture body aborted')); } }, { once: true });
            release.push(() => { if (!closed) { closed = true; stream.enqueue(new TextEncoder().encode('{"figureCount":1}')); stream.close(); } });
          } }), { status });
        });
        const pending = trigger(seed.id, 'fixture.pdf', 'fixture.pdf', 'http://mineru-fixture.invalid');
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const completed = await Promise.race([pending.then(() => true), new Promise<boolean>(resolve => { watchdog = setTimeout(() => resolve(false), 1000); })]);
        clearTimeout(watchdog); releasing = true; release.forEach(done => done()); await pending;
        assert.equal(completed, true, 'Response headers must not disable the body timeout');
        assert.equal(calls, 2, 'Retain the existing configured one-retry policy');
        const row = (await listIngestionSources(scopeB))[0]; assert.equal(row.mineru?.status, 'failed');
        assert.equal((await listIngestionSources(scopeA)).length, 0);
      });
    }
    await runCase('MinerU normal success stays with the original source and releases its timeout', async () => {
      let aborted = false;
      const trigger = makeJob(async (_url, init) => {
        fixtureInternalRequests++; init?.signal?.addEventListener('abort', () => { aborted = true; });
        return Response.json({ figureCount: 2 });
      });
      await trigger(seed.id, 'fixture.pdf', 'fixture.pdf', 'http://mineru-fixture.invalid');
      await new Promise(resolve => setTimeout(resolve, 150));
      const row = (await listIngestionSources(scopeB))[0]; assert.equal(row.mineru?.status, 'succeeded');
      assert.equal(row.mineru?.figureCount, 2); assert.equal(aborted, false);
      assert.equal((await listIngestionSources(scopeA)).length, 0);
    });
    await runCase('MinerU late completion cannot recreate a deleted source', async () => {
      let finish!: (response: Response) => void;
      const trigger = makeJob(async () => { fixtureInternalRequests++; return new Promise(resolve => { finish = resolve; }); });
      const pending = trigger(seed.id, 'fixture.pdf', 'fixture.pdf', 'http://mineru-fixture.invalid');
      try {
        while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
        await deleteIngestionSource(seed.id, scopeB);
      } finally { finish(Response.json({ figureCount: 1 })); await pending; }
      assert.equal((await listIngestionSources()).length, 0);
    });

    console.log(JSON.stringify({ ok: failures.length === 0, passed, failures, actualPostAndJobCallbacks: true,
      actualLocalJsonStore: true, fixtureInternalRequests, externalRequests: 0, paidCalls: 0,
      realUploads: 0, authScopeIsFixture: true, originalParserUsedForTextAndImage: true }));
    assert.equal(failures.length, 0, failures.join('\n'));
  } finally {
    globalThis.fetch = originalFetch;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('knowtrail-backend-lifecycle-'));
    await rm(directory, { recursive: true, force: true });
    finished = true;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
