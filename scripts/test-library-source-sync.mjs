import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual component callback; no copied hydration implementation.
const source = readFileSync('src/components/library/LibraryPanel.tsx', 'utf8');
const ast = ts.createSourceFile('LibraryPanel.tsx', source, ts.ScriptTarget.Latest, true);
let callback;
const helpers = [];
const find = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'syncIngestionSources') {
    assert.ok(ts.isCallExpression(node.initializer));
    callback = node.initializer.arguments[0];
  }
  if (ts.isFunctionDeclaration(node) && ['legacyMinerUStatus', 'fetchIngestionSourceDetail'].includes(node.name?.text)) helpers.push(node);
  ts.forEachChild(node, find);
};
find(ast);
assert.ok(callback && helpers.length === 2, 'Locate the real source sync implementation and helpers');
const printer = ts.createPrinter();
const js = ts.transpileModule(
  `${helpers.map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join('\n')}\nconst sync = ${printer.printNode(ts.EmitHint.Expression, callback, ast)}; sync;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText;

const title = 'Seven temperate terrestrial planets around the nearby ultracool dwarf star TRAPPIST-1';
const paper = {
  id: 'trappist-1-paper', title, fileName: '1703.01424v1.txt', fileType: 'txt',
  authors: ['M. Gillon'], year: 2017, keywords: ['TRAPPIST-1'],
  journal: 'Nature', doi: '10.1038/nature21360', abstract: title, content: title,
  rawContent: title, shortName: 'Gillon et al. 2017', fileSize: 83,
  storageKey: 'fixture/1703.01424v1.txt', fileUrl: '/fixture/1703.01424v1.txt',
  status: 'succeeded', chunkCount: 1, chunks: [{ text: title }],
  vectorIndex: { status: 'succeeded', count: 1, dimension: 1024 },
  createdAt: '2017-03-04T00:00:00.000Z', updatedAt: '2017-03-04T00:00:00.000Z',
};

async function execute({ known = [], authenticated = true, detailStatus = 200 } = {}) {
  const added = [], updates = [], states = [], requests = [];
  const context = {
    URLSearchParams, Date, Map,
    accountSession: authenticated ? { token: 'fixture-session' } : null,
    accountAuthRequired: true,
    AbortController, ingestionSyncRequestRef: { current: null }, lastIngestionSyncAtRef: { current: 0 },
    folders: [{ id: 'trappist-1', papers: known }], activeFolderId: 'trappist-1',
    notebookId: 'trappist-1', clientApiPath: p => '/knowtrail' + p,
    setIngestionSyncState: state => states.push(state),
    addFolder: () => { throw new Error('Existing notebook must be reused'); },
    setExpandedFolders: () => {}, setActiveFolder: () => {},
    addPaper: (folder, value) => added.push({ folder, paper: JSON.parse(JSON.stringify(value)) }),
    updatePaper: (id, value) => updates.push({ id, value: JSON.parse(JSON.stringify(value)) }),
    fetch: async (url, init) => {
      const parsed = new URL(url, 'https://fixture.invalid');
      assert.equal(parsed.pathname, '/knowtrail/api/ingestion/sources');
      assert.equal(parsed.searchParams.get('notebookId'), 'trappist-1');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-session');
      assert.equal(init.cache, 'no-store');
      requests.push(parsed.searchParams.has('id') ? 'detail' : 'list');
      if (parsed.searchParams.has('id')) return { ok: detailStatus === 200, json: async () => ({ source: paper }) };
      return { ok: true, json: async () => ({ sources: [paper] }) };
    },
  };
  await vm.runInNewContext(js, context)(true);
  assert.equal(context.ingestionSyncRequestRef.current, null);
  return { added, updates, states, requests };
}

const fresh = await execute();
assert.equal(fresh.added.length, 1);
assert.equal(fresh.updates.length, 0, 'A fully hydrated new paper must not be written a second time');
assert.deepEqual(fresh.requests, ['list', 'detail']);
assert.equal(fresh.added[0].paper.doi, paper.doi);
assert.equal(fresh.added[0].paper.fileKey, paper.storageKey);
assert.equal(fresh.added[0].paper.content, title);
assert.deepEqual(fresh.added[0].paper.authors, paper.authors);
assert.equal(fresh.added[0].paper.year, 2017);
assert.deepEqual(fresh.states, ['syncing', 'idle']);

const restored = await execute({ known: [fresh.added[0].paper] });
assert.equal(restored.updates.length, 0);
assert.equal(restored.added.length, 0);
assert.deepEqual(restored.requests, ['list']);
const old = { ...fresh.added[0].paper, year: undefined };
const changed = await execute({ known: [old] });
assert.equal(changed.updates.length, 1);
assert.equal(changed.updates[0].value.year, 2017);
const missing = await execute({ detailStatus: 404 });
assert.equal(missing.added.length, 0);
assert.deepEqual(missing.states, ['syncing', 'error']);
const anonymous = await execute({ authenticated: false });
assert.equal(anonymous.requests.length, 0);
assert.equal(anonymous.added.length, 0);
console.log(JSON.stringify({ ok: true, actualComponentCallback: true, source: 'arXiv:1703.01424v1 title/metadata only',
  singleHydrationWrite: true, existingMetadataUpdates: true, missingDetailVisible: true,
  anonymousDoesNotFetch: true, noExternalCalls: true, scientificGenerationAcceptance: false }));
