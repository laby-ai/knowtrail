import assert from 'node:assert/strict';
import { resolveClassroomProxyTarget } from '../src/lib/virtual-classroom/proxy-target';

assert.deepEqual(
  resolveClassroomProxyTarget('/classroom-runtime/api/health?fresh=1', '/classroom-runtime/api/health'),
  { shouldProxy: true, targetPath: '/api/health?fresh=1' },
);
assert.deepEqual(
  resolveClassroomProxyTarget('/classroom-runtime/classroom/demo-id', '/classroom-runtime/classroom/demo-id'),
  { shouldProxy: true, targetPath: '/classroom/demo-id' },
);
assert.deepEqual(
  resolveClassroomProxyTarget('/api/classroom?id=demo-id', '/api/classroom'),
  { shouldProxy: true, targetPath: '/api/classroom?id=demo-id' },
);
assert.deepEqual(
  resolveClassroomProxyTarget('/classroom-runtime', '/classroom-runtime'),
  { shouldProxy: true, targetPath: '/' },
);
assert.deepEqual(
  resolveClassroomProxyTarget('/classroom-runtime-evil', '/classroom-runtime-evil'),
  { shouldProxy: false, targetPath: '' },
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'public classroom prefix is removed before sidecar forwarding',
    'query strings are preserved',
    'root sidecar API calls remain root-relative',
    'lookalike prefixes are not proxied',
  ],
}, null, 2));
