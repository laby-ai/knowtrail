import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { uploadDiscoveredSourceFiles } from '../src/lib/discovered-source-upload';
import type { Paper } from '../src/types';

// Run the real file-picker callback against the upload endpoint's five-file contract.
const source = readFileSync('src/components/library/LibraryPanel.tsx', 'utf8');
const ast = ts.createSourceFile('LibraryPanel.tsx', source, ts.ScriptTarget.Latest, true);
let callback: ts.Expression | undefined;
const find = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'uploadFiles') {
    assert(node.initializer && ts.isCallExpression(node.initializer));
    callback = node.initializer.arguments[0];
  }
  ts.forEachChild(node, find);
};
find(ast);
assert(callback);
const js = ts.transpileModule(`(${ts.createPrinter().printNode(ts.EmitHint.Expression, callback, ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;

type Item = { id: string; status: string; progress: number; error?: string };
type ItemsUpdate = Item[] | ((items: Item[]) => Item[]);

async function run(count: number, mode: 'success' | 'file-failure' | 'network-failure' = 'success') {
  const files = Array.from({ length: count }, (_, index) => new File([`original ${index}`], `${index}.txt`, { type: 'text/plain' }));
  const requests: { count: number; notebook: FormDataEntryValue | null; aiConfig: FormDataEntryValue | null }[] = [];
  const added: Paper[] = [];
  const selected: string[] = [];
  const timers: (() => void)[] = [];
  let items: Item[] = [];
  let syncs = 0;
  class UploadXHR {
    status = 0;
    responseText = '';
    upload = { onprogress: (_event: { lengthComputable: boolean; loaded: number; total: number }) => {} };
    onload = () => {};
    onerror = () => {};
    ontimeout = () => {};
    open(method: string, url: string) { assert.equal(method, 'POST'); assert.equal(url, '/api/upload'); }
    setRequestHeader() {}
    send(body: FormData) {
      const batch = body.getAll('files') as File[];
      requests.push({ count: batch.length, notebook: body.get('notebookId'), aiConfig: body.get('aiConfig') });
      this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 });
      assert(items.some(item => item.progress === 50), 'Keep actual XHR byte-progress feedback.');
      this.status = batch.length > 5 ? 413 : mode === 'network-failure' && requests.length === 2 ? 503 : 200;
      this.responseText = JSON.stringify(this.status !== 200 ? { error: 'request rejected' } : {
        results: batch.map(file => mode === 'file-failure' && file.name === '1.txt' ? { error: 'source extraction failed' } : {
          id: `source-${file.name}`, title: file.name, authors: [], keywords: [],
          content: `content ${file.name}`, rawContent: `original ${file.name.slice(0, -4)}`,
          shortName: file.name, fileName: file.name, fileType: 'txt', fileSize: file.size,
          uploadTime: '2026-10-30T00:00:00.000Z', ingestionStatus: 'succeeded',
        }),
      });
      queueMicrotask(() => this.onload());
    }
  }
  const context = {
    File, FormData, Response, Headers, XMLHttpRequest: UploadXHR, Date, Set, Map, JSON,
    SUPPORTED_TYPES: { 'text/plain': 'txt' }, aiConfig: { model: 'fixture-only' }, notebookId: 'original-notebook',
    clientApiPath: (value: string) => value, accountAuthHeaders: () => ({}), uploadDiscoveredSourceFiles,
    setUploadItems: (update: ItemsUpdate) => { items = typeof update === 'function' ? update(items) : update; },
    setShowUploadProgress: () => {},
    addPaper: (folder: string, paper: Paper) => { assert.equal(folder, 'original-folder'); added.push(paper); },
    togglePaperSelection: (id: string) => { selected.push(id); },
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    syncIngestionSources: () => { syncs++; },
  };
  const upload = vm.runInNewContext(js, context) as (files: File[], folder: string) => Promise<void>;
  await upload(files, 'original-folder');
  timers.forEach(fn => fn());
  return { requests, added, selected, items, syncs };
}

async function main() {
  const single = await run(1);
  assert.equal(single.added.length, 1, 'A normal adjacent one-file upload stays successful.');
  const six = await run(6);
  assert.deepEqual(six.requests.map(request => request.count), [5, 1], 'Six selected files must use two valid requests, not one rejected request.');
  assert.equal(six.added.length, 6);
  assert.equal(six.items.filter(item => item.status === 'success').length, 6);
  assert.deepEqual(six.selected, six.added.map(paper => paper.id));
  assert.equal(six.syncs, 1);
  for (const request of six.requests) {
    assert.equal(request.notebook, 'original-notebook');
    assert.deepEqual(JSON.parse(String(request.aiConfig)), { model: 'fixture-only' });
  }
  assert.deepEqual(six.added.map(paper => paper.rawContent), Array.from({ length: 6 }, (_, index) => `original ${index}`));
  const partial = await run(7, 'file-failure');
  assert.equal(partial.added.length, 6);
  assert.equal(partial.items[1].status, 'error');
  assert.match(partial.items[1].error || '', /source extraction failed/);
  assert.equal(partial.items[6].status, 'success', 'A failed file does not prevent later batches.');
  const interrupted = await run(11, 'network-failure');
  assert.deepEqual(interrupted.requests.map(request => request.count), [5, 5]);
  assert.equal(interrupted.added.length, 5, 'Keep sources already acknowledged before the later request failed.');
  assert.equal(interrupted.selected.length, 5);
  assert.equal(interrupted.items.filter(item => item.status === 'error').length, 6);
  assert.match(interrupted.items[5].error || '', /503/);
  assert.match(interrupted.items[10].error || '', /尚未上传/);
  console.log(JSON.stringify({ ok: true, actualComponentCallback: true, scenarios: 4, maxFilesPerRequest: 5, realNetworkRequests: 0, paidCalls: 0 }));
}

void main();
