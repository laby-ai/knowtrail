import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the component's actual callbacks with a non-cooperative delayed network/body.
const source = readFileSync(process.env.SOURCE_PREVIEW_COMPONENT || 'src/components/library/LibraryPanel.tsx', 'utf8');
const ast = ts.createSourceFile('LibraryPanel.tsx', source, ts.ScriptTarget.Latest, true);
let open, close, cleanup;
const helpers = [];
const find = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openSourcePreview') open = node.initializer.arguments[0];
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'fetchIngestionSourceDetail') helpers.push(node);
  if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'aria-label' && attr.initializer?.text === '关闭来源片段')) {
    close = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'onClick').initializer.expression;
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('sourcePreviewRequestRef.current?.abort()')) cleanup = node.arguments[0];
  ts.forEachChild(node, find);
};
find(ast);
assert(open && close && helpers.length === 1, 'Locate actual reader open/close and detail fetch');
const printer = ts.createPrinter();
const print = node => printer.printNode(ts.EmitHint.Unspecified, node, ast);
const js = ts.transpileModule(`${helpers.map(print).join('\n')}\n({open: ${print(open)}, close: ${print(close)}, cleanup: ${cleanup ? print(cleanup) : '() => () => {}'}});`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const paperA = { id: 'source-a', title: 'Source A' };
const paperB = { id: 'source-b', title: 'Source B' };
const response = paper => ({ ok: true, json: async () => ({ source: { id: paper.id, chunks: [{ text: paper.title }] } }) });
function setup() {
  const pending = [];
  const state = { preview: null, focus: null };
  const context = {
    AbortController, URLSearchParams, accountSession: null, accountAuthRequired: false, notebookId: 'reader-test',
    sourcePreviewRequestRef: { current: null }, localSourcePreviewFromPaper: () => null,
    setSourcePreview: value => { state.preview = value; }, setSourcePreviewFocus: value => { state.focus = value; },
    clientApiPath: path => '/knowtrail' + path,
    fetch: (url, init) => { const wait = deferred(); pending.push({ url, init, wait }); return wait.promise; },
  };
  return { ...vm.runInNewContext(js, context), pending, state };
}

const closed = setup();
const first = closed.open(paperA);
assert.equal(closed.state.preview.status, 'loading');
closed.close();
closed.pending[0].wait.resolve(response(paperA));
await first;
assert.equal(closed.state.preview, null, 'A late response must not reopen a natively closed reader');
assert.equal(closed.pending[0].init.signal.aborted, true, 'Closing also cancels the actual fetch');

const body = setup();
const delayedBody = deferred();
const reading = body.open(paperA);
body.pending[0].wait.resolve({ ok: true, json: () => delayedBody.promise });
await Promise.resolve();
body.close();
delayedBody.resolve({ source: { id: paperA.id } });
await reading;
assert.equal(body.state.preview, null, 'A body finishing after close must not reopen the reader');

const switched = setup();
const older = switched.open(paperA);
const newer = switched.open(paperB);
switched.pending[1].wait.resolve(response(paperB));
await newer;
switched.pending[0].wait.resolve(response(paperA));
await older;
assert.equal(switched.state.preview.paper.id, paperB.id, 'A slower previous source cannot replace the current source');
assert.equal(switched.state.preview.source.id, paperB.id);

const failed = setup();
const failure = failed.open(paperA);
failed.pending[0].wait.resolve({ ok: false, status: 503 });
await failure;
assert.equal(failed.state.preview.status, 'error', 'A real non-cancelled failure remains visible');
const retry = failed.open(paperA);
failed.pending[1].wait.resolve(response(paperA));
await retry;
assert.equal(failed.state.preview.status, 'ready', 'Native retry can still finish');

const unmounted = setup();
const abandoned = unmounted.open(paperA);
unmounted.cleanup()();
unmounted.pending[0].wait.resolve(response(paperA));
await abandoned;
assert.equal(unmounted.state.preview.status, 'loading', 'Unmounted/scope-discarded callbacks must not commit a response');
assert.equal(unmounted.pending[0].init.signal.aborted, true);
console.log(JSON.stringify({ ok: true, actualComponentCallbacks: true, nativeCloseLateFetch: true, nativeCloseLateBody: true, latestSourceOwnsReader: true, visibleFailureAndRetry: true, scopeCleanup: true, externalRequests: 0, modelQualityAcceptance: false }));
