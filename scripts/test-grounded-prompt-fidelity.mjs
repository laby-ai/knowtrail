import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('src/lib/grounded-retrieval.ts', 'utf8');
const ast = ts.createSourceFile('grounded-retrieval.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['toPromptContext', 'makeResult']);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
assert.equal(functions.length, 2, 'Exercise the actual retrieval result and prompt builder');
const budget = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'MAX_PROMPT_CONTEXT_CHARS'));
assert(budget, 'Exercise the actual shared context limit');
const js = ts.transpileModule(budget.getText(ast) + '\n' + functions.map(node => node.getText(ast)).join('\n') + '\nmakeResult;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const makeResult = vm.runInNewContext(js);
const text = 'Background context. '.repeat(28) + '\nDiameter of Primary Mirror\n6.5 m approximately\nThe quoted value is approximate, not current telemetry.';
const chunk = { id: 'source::chunk-3', sourceId: 'source', chunkIndex: 2, text };
const citation = { chunkId: chunk.id, sourceId: chunk.sourceId, paperShortName: 'Public facts', sourceTitle: 'Frozen public source', excerpt: text.slice(0, 320) };
const result = makeResult([chunk], [citation], 'persisted-vector', 1, 1, false);
assert(result.promptContext.includes('6.5 m approximately'), 'A fact beyond the card preview must reach the model');
assert(result.promptContext.includes('not current telemetry'), 'The source qualification must remain with the fact');
assert.equal(result.citations[0].excerpt, citation.excerpt, 'Card preview and citation identity stay unchanged');
assert(result.promptContext.includes('chunkId: source::chunk-3'));
const wrong = makeResult([{ ...chunk, sourceId: 'another-source', text: 'Foreign source text' }], [citation], 'persisted-vector', 1, 1, false);
assert(!wrong.promptContext.includes('Foreign source text'), 'A matching chunk ID from another source cannot supply evidence');
assert(wrong.promptContext.includes(citation.excerpt), 'The original excerpt remains the fallback when full owned text is absent');
const long = { ...chunk, text: 'x'.repeat(11000) };
const bounded = makeResult([long], [citation], 'persisted-vector', 1, 1, false);
assert(bounded.promptContext.endsWith('x'.repeat(9000)));
assert(!bounded.promptContext.endsWith('x'.repeat(9001)), 'The existing context body limit remains 9000 characters');

const anchors = Array.from({ length: 6 }, (_, index) => ({
  id: `${index === 5 ? 'b' : 'a'}::${index + 1}`,
  sourceId: index === 5 ? 'b' : 'a',
  chunkIndex: index === 5 ? 1 : index * 2 + 1,
  paperShortName: index === 5 ? 'B' : 'A', sourceTitle: 'Public text',
  text: `Retrieved passage ${index + 1}. ` + 'Unchanged raw context. '.repeat(40),
}));
const hits = anchors.map(chunk => ({ ...citation, chunkId: chunk.id, sourceId: chunk.sourceId, chunkIndex: chunk.chunkIndex, score: 0.8, excerpt: chunk.text.slice(0, 320) }));
const continuation = { ...anchors[5], id: 'b::next', chunkIndex: 2, text: 'The table continues: 37 µmol/L, 95% interval [-0.2, 0.4] mK; no statistical test.' };
const expanded = makeResult([...anchors, continuation], hits, 'persisted-vector', 2, 2, false);
assert(expanded.promptContext.includes(continuation.text), 'A minority source must retain the available continuation after its matched passage');
assert.equal(expanded.citations[6]?.chunkId, continuation.id, 'A continuation has its own original locator, never the anchor locator');
assert.equal(JSON.stringify(expanded.citations.slice(0, hits.length)), JSON.stringify(hits), 'Original hit numbers, order, scores and card previews stay unchanged');
assert.equal(expanded.citations[6].score, 0, 'An unranked adjacent passage must not inherit a fabricated vector similarity');
assert(expanded.promptContext.length <= 9000, 'Optional context must also fit the complete prompt budget');

const gaps = makeResult([...anchors, { ...continuation, chunkIndex: 19 }], hits, 'persisted-vector', 2, 2, false);
assert.equal(gaps.citations.length, hits.length, 'Do not jump across missing passages');
const foreign = makeResult([...anchors, { ...continuation, sourceId: 'unselected' }], hits, 'persisted-vector', 2, 2, false);
assert(!foreign.promptContext.includes(continuation.text), 'Only the same source can extend a hit');
const stale = makeResult([continuation], [hits[5]], 'persisted-vector', 1, 1, false);
assert(!stale.promptContext.includes(continuation.text), 'An anchor absent from current owned chunks cannot authorize adjacent reading');
const oversized = makeResult([...anchors, { ...continuation, text: 'OVERSIZED_CONTINUATION'.repeat(1000) }], hits, 'persisted-vector', 2, 2, false);
assert.equal(oversized.citations.length, hits.length, 'An optional passage that does not fit is omitted whole without evicting hits');
assert(!oversized.promptContext.includes('OVERSIZED_CONTINUATION'));
const duplicate = makeResult([...anchors.map(chunk => chunk.sourceId === 'b' ? { ...chunk, text: chunk.text + continuation.text } : chunk), continuation], hits, 'persisted-vector', 2, 2, false);
assert.equal(duplicate.citations.length, hits.length, 'Do not spend the remaining budget repeating a passage already fully present from that source');
const competing = makeResult([...anchors,
  ...anchors.slice(0, 2).map((chunk, index) => ({ ...chunk, id: `a::next-${index}`, chunkIndex: chunk.chunkIndex + 1, text: `Additional A context ${index}. ` + 'a'.repeat(1170) })),
  { ...continuation, text: continuation.text + 'b'.repeat(1100) },
], hits, 'persisted-vector', 2, 2, false);
assert(competing.citations.some(citation => citation.chunkId === continuation.id), 'Several hits from one source cannot consume all optional reading before another source gets a turn');
console.log(JSON.stringify({ ok: true, actualResultBuilder: true, fullOwnedChunkRetained: true, cardPreviewUnchanged: true, scopeIdentityRetained: true, originalContextLimit: 9000, providerCalls: 0 }));
