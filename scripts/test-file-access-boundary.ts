import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { parse } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-file-access-'));
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const workspace = 'paper-user-' + 'a'.repeat(32);
  let verificationUnavailable = false;
  try {
    Object.assign(process.env, {
      APP_RUNTIME_ENV: 'production', FILE_STORAGE_ADAPTER: 'local', NEXT_PUBLIC_BASE_PATH: '/knowtrail',
      PAPER_HOST_SESSION_VERIFY_URL: 'https://session-fixture.invalid/verify', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'),
      LOCAL_FILE_STORAGE_DIR: path.join(directory, 'uploads'),
    });
    await writeFile(process.env.SOURCE_STORE_PATH!, JSON.stringify({ version: 1, sources: [{ id: 'gillon-2017', ownerMemberId: 'paper-host:' + workspace, notebookId: 'trappist-1', storageKey: '/uploads/1703.01424v1.pdf', fileUrl: '/uploads/1703.01424v1.pdf' }] }));
    globalThis.fetch = async (input, init) => {
      assert.ok(String(input).startsWith('https://session-fixture.invalid/'), 'File authorization must not fetch arbitrary URLs');
      if (verificationUnavailable) return Response.json({}, { status: 503 });
      const cookie = new Headers(init?.headers).get('cookie') || '';
      if (!cookie.includes('token=valid')) return Response.json({}, { status: 401 });
      const owner = cookie.includes('userId=other') ? 'paper-user-' + 'b'.repeat(32) : workspace;
      return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: owner, capabilities: ['verified-sms-session'] } });
    };
    const { GET: getFile } = await import('../src/app/api/file/route');
    const cases: { key: string; cookie?: string; notebookId?: string; status: number }[] = [
      { key: 'https://redirect-fixture.invalid/paper.pdf', status: 401 },
      { key: '/uploads/1703.01424v1.pdf', status: 401 },
      { key: '/uploads/1703.01424v1.pdf', cookie: 'userId=fixture; token=invalid', status: 401 },
      { key: '/uploads/1703.01424v1.pdf', cookie: 'userId=other; token=valid', status: 404 },
      { key: '/uploads/1703.01424v1.pdf', cookie: 'userId=fixture; token=valid', notebookId: 'other-notebook', status: 404 },
      { key: '/uploads/unknown.pdf', cookie: 'userId=fixture; token=valid', status: 404 },
      { key: 'https://redirect-fixture.invalid/paper.pdf', cookie: 'userId=fixture; token=valid', status: 404 },
      { key: '/uploads/../private.json', cookie: 'userId=fixture; token=valid', status: 404 },
      { key: '/uploads/1703.01424v1.pdf', cookie: 'userId=fixture; token=valid', notebookId: 'trappist-1', status: 307 },
    ];
    for (const row of cases) {
      const url = new URL('https://workbench.invalid/knowtrail/api/file');
      url.searchParams.set('key', row.key);
      if (row.notebookId) url.searchParams.set('notebookId', row.notebookId);
      const response = await getFile(new NextRequest(url, { headers: row.cookie ? { cookie: row.cookie } : {} }));
      assert.equal(response.status, row.status, 'Files must be resolved only after verified owner and notebook checks');
      assert.match(response.headers.get('cache-control') || '', /no-store/);
      if (row.status === 307) assert.equal(response.headers.get('location'), 'https://workbench.invalid/knowtrail/uploads/1703.01424v1.pdf');
      else assert.equal(response.headers.get('location'), null);
    }
    const { storeFile } = await import('../src/lib/storage');
    const stored = await storeFile(Buffer.from('TRAPPIST-1 reading notes'), '1703.01424v1 #notes%20 中文.pdf');
    await writeFile(process.env.SOURCE_STORE_PATH!, JSON.stringify({ version: 1, sources: [{ id: 'gillon-notes', ownerMemberId: 'paper-host:' + workspace, storageKey: stored.key }] }));
    const ownUrl = new URL('https://workbench.invalid/knowtrail/api/file');
    ownUrl.searchParams.set('key', stored.key);
    const own = await getFile(new NextRequest(ownUrl, { headers: { cookie: 'userId=fixture; token=valid' } }));
    assert.equal(own.status, 307, 'Every legitimate stored filename, including #, %, spaces and Chinese, must remain accessible');
    assert.equal(own.headers.get('location'), 'https://workbench.invalid/knowtrail/uploads/' + encodeURIComponent(path.basename(stored.key)));
    const { GET: getMinerU } = await import('../src/app/api/mineru/extract/route');
    const sourceFile = process.env.SOURCE_STORE_PATH!;
    const indexed = JSON.parse(await readFile(sourceFile, 'utf8'));
    indexed.sources.push({ id: 'gillon-2017', ownerMemberId: 'paper-host:' + workspace, notebookId: 'trappist-1', fileName: 'paper.pdf' });
    await writeFile(sourceFile, JSON.stringify(indexed));
    const figuresDirectory = path.join(directory, 'public/mineru-figures/gillon-2017');
    await mkdir(figuresDirectory, { recursive: true });
    const figureBytes = Buffer.from('isolated-existing-figure-bytes');
    const metadataBytes = JSON.stringify([{ label: 'Fig.1', caption: 'Original fixture caption', pageIdx: 0, bbox: [],
      imageUrl: '/mineru-figures/gillon-2017/fig-1.png', localPath: 'mineru-figures/gillon-2017/fig-1.png' }]);
    await writeFile(path.join(figuresDirectory, 'fig-1.png'), figureBytes);
    await writeFile(path.join(figuresDirectory, '_metadata.json'), metadataBytes);
    const readPassed: string[] = [], readFailures: string[] = [];
    const readObservations: Record<string, unknown> = {};
    const readFigure = async (cookie?: string, notebookId?: string) => {
      const url = new URL('https://workbench.invalid/knowtrail/api/mineru/extract?paperId=gillon-2017');
      if (notebookId) url.searchParams.set('notebookId', notebookId);
      return getMinerU(new NextRequest(url, { headers: cookie ? { cookie } : {} }));
    };
    const checkRead = async (name: string, action: () => Promise<void>) => {
      try { await action(); readPassed.push(name); }
      catch (error) { readFailures.push(name + ': ' + (error instanceof Error ? error.message : String(error))); }
    };
    const originalCwd = process.cwd();
    try {
      process.chdir(directory);
      for (const row of [
        { name: 'anonymous cannot read saved figures', cookie: undefined, notebookId: undefined, status: 401 },
        { name: 'another verified owner cannot read saved figures', cookie: 'userId=other; token=valid', notebookId: undefined, status: 404 },
        { name: 'explicit wrong notebook cannot read saved figures', cookie: 'userId=fixture; token=valid', notebookId: 'other-book', status: 404 },
        { name: 'verified owner reads the original notebook figures', cookie: 'userId=fixture; token=valid', notebookId: 'trappist-1', status: 200 },
        { name: 'legacy caller without notebook keeps owner-scoped reading', cookie: 'userId=fixture; token=valid', notebookId: undefined, status: 200 },
      ]) await checkRead(row.name, async () => {
        const response = await readFigure(row.cookie, row.notebookId);
        const payload = await response.json();
        readObservations[row.name] = { status: response.status, figures: payload.figures?.length ?? 0 };
        assert.equal(response.status, row.status);
        if (row.status === 200) { assert.equal(payload.paperId, 'gillon-2017'); assert.equal(payload.figures[0].caption, 'Original fixture caption'); }
        else assert.equal(payload.figures, undefined);
      });
      await checkRead('local figure URLs stay inside the configured KnowTrail route', async () => {
        const response = await readFigure('userId=fixture; token=valid');
        const payload = await response.json();
        assert.equal(payload.figures[0].imageUrl, '/knowtrail/mineru-figures/gillon-2017/fig-1.png');
        assert.equal(payload.figures[0].localPath, 'mineru-figures/gillon-2017/fig-1.png');
      });
      await checkRead('figure responses cannot be shared or retained by HTTP caches', async () => {
        const response = await readFigure('userId=fixture; token=valid');
        readObservations.cacheControl = response.headers.get('cache-control');
        assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
      });
      await checkRead('deleted source cannot read retained old figure files', async () => {
        const current = JSON.parse(await readFile(sourceFile, 'utf8'));
        await writeFile(sourceFile, JSON.stringify({ ...current, sources: current.sources.filter((source: { id: string }) => source.id !== 'gillon-2017') }));
        const response = await readFigure('userId=fixture; token=valid');
        readObservations.deletedSource = response.status;
        assert.equal(response.status, 404);
      });
      verificationUnavailable = true;
      await checkRead('unavailable session verification cannot turn into an empty successful result', async () => {
        const response = await readFigure('userId=fixture; token=valid');
        readObservations.verificationUnavailable = response.status;
        assert.equal(response.status, 503);
      });
      assert.deepEqual(await readFile(path.join(figuresDirectory, 'fig-1.png')), figureBytes);
      assert.equal(await readFile(path.join(figuresDirectory, '_metadata.json'), 'utf8'), metadataBytes);
      const retained = JSON.parse(await readFile(sourceFile, 'utf8'));
      assert.deepEqual(retained.sources, indexed.sources.filter((source: { id: string }) => source.id !== 'gillon-2017'));
    } finally { process.chdir(originalCwd); }
    verificationUnavailable = false;
    const { PaperHostSessionError, paperHostSessionVerificationConfigured, verifiedPaperHostWorkspace } = await import('../src/lib/verified-paper-host-session');
    const serverUrl = new URL('../src/server.ts', import.meta.url);
    const serverAst = ts.createSourceFile('server.ts', readFileSync(serverUrl, 'utf8'), ts.ScriptTarget.Latest, true);
    let callback: ts.Expression | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createServer') callback = node.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(serverAst); assert.ok(callback);
    const resolver = serverAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'resolveRuntimePublicPath');
    assert.ok(resolver);
    const runtimeDeclarations = serverAst.statements.filter(ts.isVariableStatement).filter(statement =>
      statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && ['mimeTypes', 'runtimePublicPrefixes'].includes(declaration.name.text)));
    assert.equal(runtimeDeclarations.length, 2);
    const code = ts.transpileModule(runtimeDeclarations.map(node => node.getText(serverAst)).join('\n') + '\n' + resolver.getText(serverAst) + '\n(' + callback.getText(serverAst) + ');', {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const handler = vm.runInNewContext(code, { path, parse, stat, createReadStream, Headers, process,
      publicDir: path.join(directory, 'public'),
      localUploadsDir: path.join(directory, 'uploads'), require: createRequire(serverUrl),
      PaperHostSessionError, paperHostSessionVerificationConfigured, verifiedPaperHostWorkspace,
      observeRequest: () => ({ logError() {} }), proxyClassroomRuntime: () => false,
      handle: (_req: IncomingMessage, res: ServerResponse) => { res.statusCode = 404; res.end('fixture Next fallback'); },
    }) as (req: IncomingMessage, res: ServerResponse) => Promise<void>;
    const server = createServer(handler);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const readRuntime = (resource: string, cookie?: string, method = 'GET') => new Promise<{ status: number; body: Buffer; cache: string; length: string }>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path: resource, method,
        headers: cookie ? { cookie } : {} }, response => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks),
          cache: String(response.headers['cache-control'] || ''), length: String(response.headers['content-length'] || '') }));
        response.on('error', reject);
      });
      request.on('error', reject); request.end();
    });
    const runtimeStore = JSON.parse(await readFile(sourceFile, 'utf8'));
    runtimeStore.sources.push(indexed.sources.find((source: { id: string }) => source.id === 'gillon-2017'));
    runtimeStore.sources.push({ id: 'other-paper', ownerMemberId: 'paper-host:paper-user-' + 'b'.repeat(32), notebookId: 'other-book' });
    await writeFile(sourceFile, JSON.stringify(runtimeStore));
    const otherDirectory = path.join(directory, 'public/mineru-figures/other-paper');
    await mkdir(otherDirectory, { recursive: true });
    await writeFile(path.join(otherDirectory, 'fig-1.png'), 'Other owner fixture bytes');
    try {
      for (const row of [
        { name: 'runtime anonymous figure bytes denied', resource: '/mineru-figures/gillon-2017/fig-1.png', cookie: undefined, status: 401 },
        { name: 'runtime other owner figure bytes denied', resource: '/mineru-figures/gillon-2017/fig-1.png', cookie: 'userId=other; token=valid', status: 404 },
        { name: 'runtime own existing figure bytes remain readable', resource: '/mineru-figures/gillon-2017/fig-1.png', cookie: 'userId=fixture; token=valid', status: 200 },
        { name: 'runtime prefixed figure route has the same ownership contract', resource: '/knowtrail/mineru-figures/gillon-2017/fig-1.png', cookie: 'userId=fixture; token=valid', status: 200 },
        { name: 'runtime encoded figure prefix cannot fall through to static serving', resource: '/knowtrail/%6dineru-figures/gillon-2017/fig-1.png', cookie: undefined, status: 401 },
        { name: 'runtime encoded figure separator cannot fall through to static serving', resource: '/knowtrail/mineru-figures%2Fgillon-2017/fig-1.png', cookie: undefined, status: 401 },
        { name: 'runtime encoded root figure separator requires ownership', resource: '/mineru-figures%2Fgillon-2017/fig-1.png', cookie: undefined, status: 401 },
        { name: 'runtime encoded figure prefix rejects another owner', resource: '/knowtrail/%6dineru-figures/gillon-2017/fig-1.png', cookie: 'userId=other; token=valid', status: 404 },
        { name: 'runtime original owner reads the encoded figure prefix', resource: '/knowtrail/%6dineru-figures/gillon-2017/fig-1.png', cookie: 'userId=fixture; token=valid', status: 200 },
        { name: 'runtime original owner reads the encoded figure separator', resource: '/knowtrail/mineru-figures%2Fgillon-2017/fig-1.png', cookie: 'userId=fixture; token=valid', status: 200 },
      ]) await checkRead(row.name, async () => {
        const result = await readRuntime(row.resource, row.cookie);
        readObservations[row.name] = { status: result.status, bytes: result.body.length, cache: result.cache };
        assert.equal(result.status, row.status);
        assert.match(result.cache, /private.*no-store/);
        if (row.status === 200) { assert.deepEqual(result.body, figureBytes); }
        else assert.notDeepEqual(result.body, figureBytes);
      });
      await checkRead('runtime figure HEAD retains length without a body', async () => {
        const result = await readRuntime('/mineru-figures/gillon-2017/fig-1.png', 'userId=fixture; token=valid', 'HEAD');
        assert.equal(result.status, 200); assert.equal(result.body.length, 0); assert.equal(result.length, String(figureBytes.length)); assert.match(result.cache, /private.*no-store/);
      });
      await checkRead('runtime original private upload stays readable', async () => {
        const result = await readRuntime('/knowtrail/uploads/' + encodeURIComponent(path.basename(stored.key)), 'userId=fixture; token=valid');
        assert.equal(result.status, 200); assert.equal(result.body.toString(), 'TRAPPIST-1 reading notes'); assert.match(result.cache, /private.*no-store/);
      });
      await checkRead('runtime encoded upload prefix decodes special filenames only once', async () => {
        const result = await readRuntime('/knowtrail/%75ploads/' + encodeURIComponent(path.basename(stored.key)), 'userId=fixture; token=valid');
        assert.equal(result.status, 200); assert.equal(result.body.toString(), 'TRAPPIST-1 reading notes'); assert.match(result.cache, /private.*no-store/);
      });
      await checkRead('runtime canonical figure path cannot traverse into another source', async () => {
        const result = await readRuntime('/mineru-figures/gillon-2017/../other-paper/fig-1.png', 'userId=fixture; token=valid');
        readObservations.canonicalOtherSource = result.status; assert.equal(result.status, 404);
      });
      await checkRead('runtime retained figure bytes are denied after source deletion', async () => {
        const current = JSON.parse(await readFile(sourceFile, 'utf8'));
        await writeFile(sourceFile, JSON.stringify({ ...current, sources: current.sources.filter((source: { id: string }) => source.id !== 'gillon-2017') }));
        const result = await readRuntime('/mineru-figures/gillon-2017/fig-1.png', 'userId=fixture; token=valid');
        readObservations.runtimeDeletedSource = result.status; assert.equal(result.status, 404);
      });
      verificationUnavailable = true;
      await checkRead('runtime session outage cannot expose a saved figure', async () => {
        const result = await readRuntime('/mineru-figures/gillon-2017/fig-1.png', 'userId=fixture; token=valid');
        readObservations.runtimeSessionUnavailable = result.status; assert.equal(result.status, 503);
      });
      assert.deepEqual(await readFile(path.join(figuresDirectory, 'fig-1.png')), figureBytes);
      assert.equal(await readFile(path.join(figuresDirectory, '_metadata.json'), 'utf8'), metadataBytes);
      assert.equal(await readFile(path.join(otherDirectory, 'fig-1.png'), 'utf8'), 'Other owner fixture bytes');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    verificationUnavailable = true;
    assert.equal((await getFile(new NextRequest('https://workbench.invalid/knowtrail/api/file?key=%2Fuploads%2F1703.01424v1.pdf', { headers: { cookie: 'userId=fixture; token=valid' } }))).status, 503);
    console.log(JSON.stringify({ ok: !readFailures.length, ownFileRedirect: true, anonymousOtherOwnerWrongNotebookAndExternalDenied: true, mineruReadOwnership: { passed: readPassed, failures: readFailures, observations: readObservations }, actualWholeGetModuleAuthScopeAndLocalFiles: true, exactRuntimeCallbackAndLoopbackHttp: true, nextHandlerAndClassroomProxyAreFixtures: true, temporaryServerClosed: true, figureBytesUnchanged: true, paidCalls: 0, sessionIsFixture: true }));
    assert.equal(readFailures.length, 0, readFailures.join('\n'));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    assert.equal(path.dirname(directory), os.tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
