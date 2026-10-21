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
console.log(JSON.stringify({ ok: true, actualResultBuilder: true, fullOwnedChunkRetained: true, cardPreviewUnchanged: true, scopeIdentityRetained: true, originalContextLimit: 9000, providerCalls: 0 }));
