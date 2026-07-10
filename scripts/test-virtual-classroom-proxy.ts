import assert from 'node:assert/strict';
import {
  resolveClassroomProxyTarget,
  shouldProxyMissingClassroomAsset,
} from '../src/lib/virtual-classroom/proxy-target';

assert.deepEqual(
  resolveClassroomProxyTarget('/classroom-runtime/api/health?fresh=1', '/classroom-runtime/api/health'),
  { shouldProxy: true, targetPath: '/api/health?fresh=1' },
);

const mainStaticRoot = '/app/.next/static';
assert.equal(
  shouldProxyMissingClassroomAsset(
    '/_next/static/chunks/main.js',
    mainStaticRoot,
    file => file.replace(/\\/g, '/').endsWith('/chunks/main.js'),
  ),
  false,
);
assert.equal(
  shouldProxyMissingClassroomAsset('/_next/static/chunks/classroom.js', mainStaticRoot, () => false),
  true,
);
assert.equal(
  shouldProxyMissingClassroomAsset('/_next/static/%2e%2e/server.js', mainStaticRoot, () => false),
  false,
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
    'main application assets keep priority over sidecar assets',
    'missing sidecar asset hashes are proxied without allowing path traversal',
  ],
}, null, 2));
