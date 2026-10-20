import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual reader locator; adjacent stored chunks intentionally overlap.
const source = readFileSync('src/components/library/LibraryPanel.tsx', 'utf8');
const ast = ts.createSourceFile('LibraryPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['normalizeEvidenceText', 'citationChunkLocator', 'findCitationContextSnippet']);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
assert.equal(functions.length, names.size, 'Locate the actual citation context functions');
const js = ts.transpileModule(functions.map(node => node.getText(ast)).join('\n') + '\nfindCitationContextSnippet;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const locate = vm.runInNewContext(js);
const overlap = 'This evidence appears at the end of the preceding chunk and at the beginning of the cited chunk. ';
const chunks = [
  { id: 'source::chunk-1', chunkIndex: 0, text: 'Earlier discussion. ' + overlap },
  { id: 'source::chunk-2', chunkIndex: 1, text: overlap + 'The complete cited explanation continues only here.' },
];
const citation = { chunkId: chunks[1].id, chunkIndex: 1, excerpt: chunks[1].text };
assert.equal(locate(chunks, citation).locator, '片段 2', 'An overlapping prefix cannot override the exact chunk ID');
assert.equal(locate(chunks, citation).text, chunks[1].text, 'The original includes the remainder of the cited explanation');
assert.equal(locate(chunks, { ...citation, chunkIndex: 0 }).locator, '片段 2', 'Exact ID remains authoritative over a conflicting index');
assert.equal(locate(chunks, { chunkIndex: 1, excerpt: overlap }).locator, '片段 2', 'Legacy index precedes fuzzy excerpt matching');
assert.equal(locate(chunks, { excerpt: 'Earlier discussion.' }).locator, '片段 1', 'Unlocated legacy citations retain excerpt fallback');
assert.equal(locate(chunks, { chunkId: 'missing', excerpt: 'Not in this source.' }), null, 'Missing evidence is not invented');
assert.equal(locate([], citation), null);
console.log(JSON.stringify({ ok: true, actualComponentFunctions: true, overlappingChunkIdentity: true,
  exactIdPrecedence: true, legacyIndexAndExcerpt: true, missingEvidence: true, modelQualityAcceptance: false }));
