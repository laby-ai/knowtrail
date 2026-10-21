import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/components/editor/EditorPanel.tsx', 'utf8');
const file = ts.createSourceFile('EditorPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleExportChat' && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(file);
assert(callback, 'Exercise the actual native export callback');
const code = ts.transpileModule(callback.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.trim().replace(/;$/, '');
const scientificText = '6.5 m (21.3 ft) approximately [1]; 37 µmol/L, 95% interval [-0.2, 0.4] mK. Not measured [37].';
const messages = [
  { role: 'assistant', content: scientificText, citations: [{ paperId: 'webb', sourceId: 'webb-source', chunkId: 'webb-chunk-3', sourceTitle: 'Webb original', paperShortName: 'W', chunkIndex: 2, page: 4 }] },
  { role: 'assistant', content: 'Hubble 2.4-meter [1].', citations: [{ paperId: 'hubble', sourceId: 'hubble-source', chunkId: 'hubble-chunk-2', sourceTitle: 'Hubble original', paperShortName: 'H', chunkIndex: 1 }] },
  { role: 'assistant', content: 'Legacy record [1].', citations: [{ paperId: 'legacy-source', paperShortName: 'Legacy title' }] },
  { role: 'user', content: 'Question without citations.' },
];
const snapshot = JSON.stringify(messages);
let blob;
let clicked = false;
let revoked = false;
const nativeExport = vm.runInNewContext(`(${code})`, { chatMessages: messages, Blob, Date,
  URL: { createObjectURL(value) { blob = value; return 'blob:local-export'; }, revokeObjectURL(url) { assert.equal(url, 'blob:local-export'); revoked = true; } },
  document: { createElement(tag) { assert.equal(tag, 'a'); return { click() { clicked = true; } }; } },
});
nativeExport();
const markdown = await blob.text();
assert(clicked && revoked, 'Native download and URL release remain intact');
assert(markdown.includes(scientificText), 'Do not rewrite scientific values, markers, or qualifiers');
assert.match(markdown, /^> \[1\] Webb original.*webb-source.*webb-chunk-3/m);
assert.match(markdown, /^> \[1\] Hubble original.*hubble-source.*hubble-chunk-2/m, 'Each answer owns its own numbering');
assert(markdown.includes('第 4 页') && markdown.includes('片段 3') && markdown.includes('片段 2'));
assert.match(markdown, /^> \[1\] Legacy title.*legacy-source/m, 'Retain old records without inventing chunk IDs');
assert(!markdown.includes('undefined') && !markdown.includes('null'));
assert.equal(JSON.stringify(messages), snapshot, 'Export must not mutate the saved conversation');
console.log(JSON.stringify({ ok: true, actualNativeCallback: true, perAnswerCitationIdentity: true, originalTextAndHistoryUnchanged: true }));
