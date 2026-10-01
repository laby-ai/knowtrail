import assert from 'node:assert/strict';
import { fitWorkbenchWidths } from '../src/lib/workbench-widths';
import { notebookIdFromStorageScopeKey } from '../src/lib/notebook-scope';
import { chatHistoryStorageKey } from '../src/lib/chat-generation-lifecycle';
for (const width of [1024, 1280, 1440, 1920]) {
  for (const [left, right] of [[320,380], [450,650], [99999,99999], [NaN,Infinity], [-50,-50]]) {
    const result = fitWorkbenchWidths(width, left, right);
    assert.ok(result.left + result.right + 372 <= width);
    assert.ok(result.left > 0 && result.right > 0);
  }
}
assert.equal(fitWorkbenchWidths(1024,450,650,true).left, 0);
assert.equal(notebookIdFromStorageScopeKey('guest:notebook-A'), 'notebook-A');
assert.notEqual(chatHistoryStorageKey('guest:notebook-A'), chatHistoryStorageKey('guest:notebook-B'));
assert.notEqual(chatHistoryStorageKey('account-A:notebook-A'), chatHistoryStorageKey('account-B:notebook-A'));
console.log('PASS: bounded panels, collapsed panels, notebook and account storage keys');
