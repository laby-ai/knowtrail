import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { resolveAccountSessionFromRequest } from '../src/lib/account-session';
import { clearZhiqiPortalAuth, readZhiqiPortalAuthHeaders, saveZhiqiPortalAuth } from '../src/lib/zhiqi-portal-auth';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function main() {
  const sessionStorage = new MemoryStorage();
  Object.assign(globalThis, { window: { sessionStorage } });
  saveZhiqiPortalAuth({ accessToken: 'portal-token', tenantId: '8' });
  assert.deepEqual(readZhiqiPortalAuthHeaders(), {
    Authorization: 'Bearer portal-token', 'tenant-id': '8', 'x-zhiqi-host': '1',
  });
  clearZhiqiPortalAuth();
  assert.deepEqual(readZhiqiPortalAuthHeaders(), {});

  process.env.ZHIQI_PORTAL_AUTH_INFO_URL = 'https://portal.invalid/admin-api/system/auth/get-permission-info';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), process.env.ZHIQI_PORTAL_AUTH_INFO_URL);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer verified-token');
    assert.equal(new Headers(init?.headers).get('tenant-id'), '9');
    return Response.json({ code: 0, data: { user: { id: 42, nickname: '研究教师', username: 'teacher42' } } });
  }) as typeof fetch;
  try {
    const session = await resolveAccountSessionFromRequest(new NextRequest('http://localhost/api/test', {
      headers: { Authorization: 'Bearer verified-token', 'tenant-id': '9', 'x-zhiqi-host': '1' },
    }));
    assert.equal(session?.tenant_id, '9');
    assert.equal(session?.member.id, 'zhiqi:9:42');
    assert.equal(session?.member.display_name, '研究教师');
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('zhiqi portal auth contract passed');
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
