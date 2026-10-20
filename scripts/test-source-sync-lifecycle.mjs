import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(process.env.SOURCE_SYNC_COMPONENT || 'src/components/library/LibraryPanel.tsx', 'utf8');
const ast = ts.createSourceFile('LibraryPanel.tsx', source, ts.ScriptTarget.Latest, true);
const helpers = [];
let sync, cleanup;
const find = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'syncIngestionSources') sync = node.initializer.arguments[0];
  if (ts.isFunctionDeclaration(node) && ['legacyMinerUStatus', 'fetchIngestionSourceDetail'].includes(node.name?.text)) helpers.push(node);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('ingestionSyncRequestRef.current?.abort()')) cleanup = node.arguments[0];
  ts.forEachChild(node, find);
};
find(ast);
assert(sync && helpers.length === 2);
const printer = ts.createPrinter();
const print = node => printer.printNode(ts.EmitHint.Unspecified, node, ast);
const js = ts.transpileModule(`${helpers.map(print).join('\n')}\n({sync:${print(sync)}, cleanup:${cleanup ? print(cleanup) : '() => () => {}'}});`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const paper = { id: 'saved-source', fileName: 'public.txt', title: 'Public source', status: 'succeeded', chunks: [{ text: 'Original text' }] };
const response = value => ({ ok: true, json: async () => value });

for (const stage of ['list-fetch', 'list-body', 'detail-fetch', 'detail-body']) {
  const folders = [], writes = [], pending = [];
  const setup = () => {
    const context = {
      AbortController, URLSearchParams, Date, Map,
      accountSession: null, accountAuthRequired: false, notebookId: 'same-workbook',
      ingestionSyncRequestRef: { current: null }, ingestionSyncInFlightRef: { current: false }, lastIngestionSyncAtRef: { current: 0 },
      folders: [], activeFolderId: null, clientApiPath: path => path,
      setIngestionSyncState: value => writes.push(value), setExpandedFolders: () => {}, setActiveFolder: () => {},
      addFolder: () => { const id = 'folder-' + (folders.length + 1); folders.push({ id, papers: [] }); return id; },
      addPaper: (id, value) => folders.find(folder => folder.id === id).papers.push(value), updatePaper: () => {},
      fetch: (url, init) => { const wait = deferred(); pending.push({ url, init, wait }); return wait.promise; },
    };
    return vm.runInNewContext(js, context);
  };
  const older = setup();
  const oldRun = older.sync(true);
  let oldBody;
  if (stage === 'list-body') {
    oldBody = deferred(); pending[0].wait.resolve({ ok: true, json: () => oldBody.promise });
    await Promise.resolve();
  } else if (stage.startsWith('detail-')) {
    pending[0].wait.resolve(response({ sources: [paper] }));
    while (pending.length < 2) await new Promise(done => setImmediate(done));
    if (stage === 'detail-body') {
      oldBody = deferred(); pending[1].wait.resolve({ ok: true, json: () => oldBody.promise });
      await Promise.resolve(); await Promise.resolve();
    }
  }
  older.cleanup()();
  const newer = setup();
  const nextList = pending.length;
  const newRun = newer.sync(true);
  pending[nextList].wait.resolve(response({ sources: [paper] }));
  while (pending.length <= nextList + 1) await new Promise(done => setImmediate(done));
  pending[nextList + 1].wait.resolve(response({ source: paper }));
  await newRun;
  const writesBeforeLate = writes.length;
  if (oldBody) oldBody.resolve(stage === 'list-body' ? { sources: [paper] } : { source: paper });
  else pending[stage === 'list-fetch' ? 0 : 1].wait.resolve(response(stage === 'list-fetch' ? { sources: [paper] } : { source: paper }));
  // Resolve an uncancelled old implementation's extra detail rather than hanging the red test.
  const allDone = oldRun.then(() => true);
  await new Promise(done => setImmediate(done));
  for (const row of pending.slice(nextList + 2)) row.wait.resolve(response({ source: paper }));
  await allDone;
  assert.equal(folders.length, 1, `${stage}: an abandoned reader mount must not create another directory`);
  assert.equal(folders[0].papers.length, 1, `${stage}: exactly one saved source is restored`);
  assert.equal(writes.length, writesBeforeLate, `${stage}: late callbacks cannot change the current sync state`);
  assert.equal(pending[0].init.signal.aborted, true);
}
console.log(JSON.stringify({ ok: true, actualSyncAndCleanup: true, remountHasOneSourceAndDirectory: true, lateListAndDetailFetchOrBodyDiscarded: true, externalRequests: 0 }));
