import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as logoutPost } from '../src/app/api/account/session/route';

const fixtureToken = 'local_contract_token';
const originalFetch = globalThis.fetch;
const originalBase = process.env.ACCOUNT_CENTER_API_BASE;

async function main() {
  const spec = JSON.parse(await readFile(path.join(process.cwd(), 'contracts/cross-app-auth-v1.json'), 'utf8'));
  assert.equal(spec.version, 'stoneai-auth-v1');
  assert.deepEqual(spec.products.knowtrail.sessionTransport, ['bearer']);
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['test:cross-app-auth-contract'], 'tsx ./scripts/test-cross-app-auth-contract.ts');
  const workflow = await readFile(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /pnpm run test:cross-app-auth-contract/);

  process.env.ACCOUNT_CENTER_API_BASE = 'https://account.invalid';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ status: 'ok' });
  };

  try {
    const missing = await logoutPost(new NextRequest('http://localhost/api/account/session', { method: 'POST' }));
    assert.equal(missing.status, 401, 'missing bearer token must fail closed');
    assert.equal(calls.length, 0, 'missing token must not call account service');

    const response = await logoutPost(new NextRequest('http://localhost/api/account/session', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${fixtureToken}`,
        'x-tenant-id': 'tenant-spoofed',
        'x-member-id': 'member-spoofed',
      },
    }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://account.invalid/v1/auth/logout');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(new Headers(calls[0].init?.headers).get('authorization'), `Bearer ${fixtureToken}`);
    assert.equal(new Headers(calls[0].init?.headers).get('x-tenant-id'), null);
    assert.equal(new Headers(calls[0].init?.headers).get('x-member-id'), null);

    globalThis.fetch = async () => Response.json({ error: 'account_unavailable' }, { status: 503 });
    const unavailable = await logoutPost(new NextRequest('http://localhost/api/account/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${fixtureToken}` },
    }));
    assert.equal(unavailable.status, 502, 'upstream failure must not be reported as successful logout');

    const pageSource = await readFile(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    assert.match(pageSource, /await revokeStoredAccountSession\(\)/);
    assert.doesNotMatch(pageSource, /const signOut = \(\) => \{\s*clearAccountSession\(\)/);

    console.log('KnowTrail cross-app auth contract passed');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.ACCOUNT_CENTER_API_BASE;
    else process.env.ACCOUNT_CENTER_API_BASE = originalBase;
  }
}

void main();
