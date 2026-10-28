import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const text = readFileSync(process.env.IMAGE_PPT_COMPONENT || 'src/components/studio/PresentationPanels.tsx', 'utf8');
const ast = ts.createSourceFile('PresentationPanels.tsx', text, ts.ScriptTarget.Latest, true);
const names = new Set(['PRESET_STYLES', 'DETAIL_LEVELS', 'LANG_OPTIONS', 'ASPECT_RATIOS']);
const printer = ts.createPrinter();
const print = node => printer.printNode(ts.EmitHint.Unspecified, node, ast);
const declarations = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => names.has(value.name.getText(ast))));
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PresentationPanel');
assert.equal(declarations.length, 4);
assert(component, 'Use the actual existing image PPT component');
const code = ts.transpileModule(declarations.map(print).join('\n') + '\n' + print(component) + '\nPresentationPanel;', { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const fixture = {
  deckTitle: 'Existing engineering fixture', activeIndex: 0, style: 'academic',
  detailLevel: 'default', language: 'zh', aspectRatio: '16:9', citations: [], history: {},
  slides: [{ id: 'first', title: 'Saved first page', imageUrl: 'data:image/png;base64,AA==', content: 'Saved content' }],
};
let writes = 0;
let providerCalls = 0;
function render(deck) {
  const context = {
    React, useState: React.useState, useRef: React.useRef, useEffect: React.useEffect, useCallback: React.useCallback,
    useApp: () => ({ getSelectedPapers: () => [{ id: 'source', title: 'Original source' }], aiConfig: {}, storageScopeKey: 'fixture:notebook' }),
    notebookIdFromStorageScopeKey: () => 'fixture',
    useStudioGenerationReadiness: () => ({ ready: true }),
    emptyImageDeck: () => ({ runId: '', deck: null }), isImageDeckDocument: () => true,
    usePrivateNotebookDocument: () => ({ data: { deck }, revision: { current: 'a'.repeat(64) }, update: () => { writes += 1; }, unsaved: false, loading: false, readFailed: false, conflict: false }),
    SavedToolStatus: () => null, StudioEvidenceStatusPanel: () => null,
    requestGeneratedDeck: () => { providerCalls += 1; throw new Error('Generation forbidden in render contract'); },
  };
  const icon = () => null;
  for (const name of ['Layout','Monitor','FileText','Languages','Layers','ImageIcon','AlertTriangle','Loader2','Sparkles','Eye','Wand2','Presentation','Download','Check']) context[name] = icon;
  const Panel = vm.runInNewContext(code, context);
  return renderToStaticMarkup(React.createElement(Panel));
}

const saved = render(fixture);
const settings = saved.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
assert(settings, 'Regeneration controls stay available in a native disclosure');
assert(!/\bopen(?:=|\s|$)/.test(settings[1]), 'A saved deck opens with regeneration settings collapsed');
assert.match(settings[2], /重新生成设置/);
assert.match(settings[2], /重新生成图片简报/, 'Regeneration is explicitly different from opening the saved deck');
assert.match(saved, /Saved first page/);
assert.equal((saved.match(/导出 PPTX/g) || []).length, 1, 'Reuse the one original export action');
assert(saved.indexOf('导出 PPTX') < saved.indexOf('alt="Saved first page"'), 'Export is reached before scrolling through the saved page and evidence');

const empty = render(null);
const emptySettings = empty.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
assert(emptySettings && /\bopen(?:=|\s|$)/.test(emptySettings[1]), 'A new notebook still opens its generation controls');
assert.match(emptySettings[2], /生成图片简报/);
assert(!empty.includes('导出 PPTX'), 'An empty notebook does not offer a saved file');
assert.equal(writes, 0, 'Reading either state does not write a deck');
assert.equal(providerCalls, 0, 'Reading or opening a saved deck does not generate');
console.log(JSON.stringify({ actualComponentRendering: true, savedResultFirst: true, oneOriginalExport: true, regenerationOnDemand: true, newNotebookControlsPreserved: true, documentWrites: writes, providerCalls }));
