import assert from 'node:assert/strict';
import {
  parseStoredSourceSelection,
  serializeSourceSelection,
  sourceSelectionStorageKey,
} from '../src/lib/source-selection-storage';

assert.equal(sourceSelectionStorageKey('guest:notebook-a'), 'knowtrail:source-selection:v1:guest:notebook-a');
assert.deepEqual(parseStoredSourceSelection(null, ['featured-a']), ['featured-a']);
assert.deepEqual(parseStoredSourceSelection('not-json', ['featured-a']), ['featured-a']);
assert.deepEqual(
  parseStoredSourceSelection('["featured-a","paper-new","paper-new",null]', []),
  ['featured-a', 'paper-new'],
);
assert.equal(serializeSourceSelection(['featured-a', 'paper-new', 'paper-new']), '["featured-a","paper-new"]');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'selection key is isolated by workspace scope',
    'first visit keeps featured defaults',
    'stored paper selection survives reload without duplicates',
  ],
}, null, 2));
