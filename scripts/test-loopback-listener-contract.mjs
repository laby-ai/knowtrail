import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

assert.doesNotMatch(
  source,
  /process\.env\.HOSTNAME/,
  'generic HOSTNAME must not control the application listener',
);
assert.match(
  source,
  /const bindHost = process\.env\.BIND_HOST \|\| \(dev \? 'localhost' : '127\.0\.0\.1'\);/,
  'production must default to loopback while development remains local-friendly',
);
assert.match(
  source,
  /server\.listen\(port, bindHost, \(\) =>/,
  'the HTTP listener must bind the validated host instead of all interfaces',
);
assert.match(source, /http:\/\/\$\{bindHost\}:\$\{port\}/, 'startup logs must report the real listener');

console.log('loopback listener contract passed');
