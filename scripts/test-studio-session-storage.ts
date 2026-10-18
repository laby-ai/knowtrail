import assert from 'node:assert/strict';
import {
  parseStoredStudioValue,
  serializeStudioValue,
  studioSessionStorageKey,
} from '../src/lib/studio-session-storage';

assert.equal(
  studioSessionStorageKey('guest:notebook-a', 'peer-review', 'manuscript'),
  'knowtrail:studio-session:v1:guest:notebook-a:peer-review:manuscript',
);
assert.notEqual(
  studioSessionStorageKey('guest:notebook-a', 'peer-review', 'manuscript'),
  studioSessionStorageKey('member-42:notebook-a', 'peer-review', 'manuscript'),
);
assert.notEqual(
  studioSessionStorageKey('guest:notebook-a', 'peer-review', 'manuscript'),
  studioSessionStorageKey('guest:notebook-b', 'peer-review', 'manuscript'),
);
assert.equal(parseStoredStudioValue(null, 'fallback'), 'fallback');
assert.equal(parseStoredStudioValue('not-json', 'fallback'), 'fallback');
assert.deepEqual(
  parseStoredStudioValue('{"title":"审查结果","comments":["问题一"]}', null),
  { title: '审查结果', comments: ['问题一'] },
);
assert.equal(serializeStudioValue({ value: '保留输入' }), '{"value":"保留输入"}');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'studio session keys are isolated by identity, notebook, tool, and field',
    'invalid or missing browser data falls back safely',
    'structured tool inputs and results can survive a refresh',
  ],
}, null, 2));
