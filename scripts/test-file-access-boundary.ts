import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-file-access-'));
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const workspace = 'paper-user-' + 'a'.repeat(32);
  let verificationUnavailable = false;
  try {
    Object.assign(process.env, {
      APP_RUNTIME_ENV: 'production', FILE_STORAGE_ADAPTER: 'local', NEXT_PUBLIC_BASE_PATH: '/knowtrail',
      PAPER_HOST_SESSION_VERIFY_URL: 'https://session-fixture.invalid/verify', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'),
      LOCAL_FILE_STORAGE_DIR: path.join(directory, 'uploads'),
    });
    await writeFile(process.env.SOURCE_STORE_PATH!, JSON.stringify({ version: 1, sources: [{ id: 'gillon-2017', ownerMemberId: 'paper-host:' + workspace, notebookId: 'trappist-1', storageKey: '/uploads/1703.01424v1.pdf', fileUrl: '/uploads/1703.01424v1.pdf' }] }));
    globalThis.fetch = async (input, init) => {
      assert.ok(String(input).startsWith('https://session-fixture.invalid/'), 'File authorization must not fetch arbitrary URLs');
      if (verificationUnavailable) return Response.json({}, { status: 503 });
      const cookie = new Headers(init?.headers).get('cookie') || '';
      if (!cookie.includes('token=valid')) return Response.json({}, { status: 401 });
      const owner = cookie.includes('userId=other') ? 'paper-user-' + 'b'.repeat(32) : workspace;
      return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: owner, capabilities: ['verified-sms-session'] } });
    };
    const { GET: getFile } = await import('../src/app/api/file/route');
    const cases: { key: string; cookie?: string; notebookId?: string; status: number }[] = [
      { key: 'https://redirect-fixture.invalid/paper.pdf', status: 401 },
      { key: '/uploads/1703.01424v1.pdf', status: 401 },
      { key: '/uploads/1703.01424v1.pdf', cookie: 'userId=fixture; token=invalid', status: 401 },
      { key: '/uploads/1703.01424v1.pdf', cookie: 'userId=other; token=valid', status: 404 },
      { key: '/uploads/1703.01424v1.pdf', cookie: 'userId=fixture; token=valid', notebookId: 'other-notebook', status: 404 },
      { key: '/uploads/unknown.pdf', cookie: 'userId=fixture; token=valid', status: 404 },
      { key: 'https://redirect-fixture.invalid/paper.pdf', cookie: 'userId=fixture; token=valid', status: 404 },
      { key: '/uploads/../private.json', cookie: 'userId=fixture; token=valid', status: 404 },
      { key: '/uploads/1703.01424v1.pdf', cookie: 'userId=fixture; token=valid', notebookId: 'trappist-1', status: 307 },
    ];
    for (const row of cases) {
      const url = new URL('https://workbench.invalid/knowtrail/api/file');
      url.searchParams.set('key', row.key);
      if (row.notebookId) url.searchParams.set('notebookId', row.notebookId);
      const response = await getFile(new NextRequest(url, { headers: row.cookie ? { cookie: row.cookie } : {} }));
      assert.equal(response.status, row.status, 'Files must be resolved only after verified owner and notebook checks');
      assert.match(response.headers.get('cache-control') || '', /no-store/);
      if (row.status === 307) assert.equal(response.headers.get('location'), 'https://workbench.invalid/knowtrail/uploads/1703.01424v1.pdf');
      else assert.equal(response.headers.get('location'), null);
    }
    const { storeFile } = await import('../src/lib/storage');
    const stored = await storeFile(Buffer.from('TRAPPIST-1 reading notes'), '1703.01424v1 #notes%20 中文.pdf');
    await writeFile(process.env.SOURCE_STORE_PATH!, JSON.stringify({ version: 1, sources: [{ id: 'gillon-notes', ownerMemberId: 'paper-host:' + workspace, storageKey: stored.key }] }));
    const ownUrl = new URL('https://workbench.invalid/knowtrail/api/file');
    ownUrl.searchParams.set('key', stored.key);
    const own = await getFile(new NextRequest(ownUrl, { headers: { cookie: 'userId=fixture; token=valid' } }));
    assert.equal(own.status, 307, 'Every legitimate stored filename, including #, %, spaces and Chinese, must remain accessible');
    assert.equal(own.headers.get('location'), 'https://workbench.invalid/knowtrail/uploads/' + encodeURIComponent(path.basename(stored.key)));
    verificationUnavailable = true;
    assert.equal((await getFile(new NextRequest('https://workbench.invalid/knowtrail/api/file?key=%2Fuploads%2F1703.01424v1.pdf', { headers: { cookie: 'userId=fixture; token=valid' } }))).status, 503);
    console.log(JSON.stringify({ ok: true, ownFileRedirect: true, anonymousOtherOwnerWrongNotebookAndExternalDenied: true, paidCalls: 0, sessionIsFixture: true }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    assert.equal(path.dirname(directory), os.tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
