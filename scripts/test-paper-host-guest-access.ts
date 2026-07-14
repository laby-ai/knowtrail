import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';

function paperHostRequest(accountScope: string) {
  const referer = new URL('https://agent.example/');
  referer.searchParams.set('host', 'paper-web');
  referer.searchParams.set('embed', 'research-agent');
  referer.searchParams.set('workspaceKey', 'guest-agent-session-01');
  referer.searchParams.set('accountScope', accountScope);
  return new NextRequest('https://agent.example/api/ai/chat', {
    headers: { referer: referer.toString() },
  });
}

async function main() {
  const guestChat = await resolveAccountNotebookScope(paperHostRequest('guest'), {
    notebookId: 'notebook-01',
    loginMessage: '请先登录。',
  });
  assert.equal(guestChat.ok, true, 'Ordinary agent features should remain available to a scoped guest.');

  const guestHighCost = await resolveAccountNotebookScope(paperHostRequest('guest'), {
    notebookId: 'notebook-01',
    loginMessage: '请先登录后再使用高成本生成。',
    requireAuthenticatedPaperHost: true,
  });
  assert.equal(guestHighCost.ok, false, 'High-cost generation must reject a guest paper-host scope.');
  if (!guestHighCost.ok) {
    assert.equal(guestHighCost.response.status, 401);
    assert.deepEqual(await guestHighCost.response.json(), {
      error: '请先登录后再使用高成本生成。',
      status: 'failed',
      errorType: 'paper_host_login_required',
    });
  }

  const memberHighCost = await resolveAccountNotebookScope(paperHostRequest('current-user'), {
    notebookId: 'notebook-01',
    loginMessage: '请先登录后再使用高成本生成。',
    requireAuthenticatedPaperHost: true,
  });
  assert.equal(memberHighCost.ok, true, 'A signed-in paper-host scope should retain high-cost generation access.');

  const protectedRoutes = [
    'src/app/api/ai/ppt/route.ts',
    'src/app/api/ai/ppt-v2/route.ts',
    'src/app/api/ai/ppt-html/route.ts',
    'src/app/api/ai/ppt-html-repair/route.ts',
    'src/app/api/ai/ppt-slide-revise/route.ts',
    'src/app/api/ai/scientific-illustration/route.ts',
    'src/app/api/ai/scientific-illustration/[id]/route.ts',
  ];
  for (const route of protectedRoutes) {
    const source = fs.readFileSync(path.resolve(route), 'utf8');
    assert.match(source, /requireAuthenticatedPaperHost:\s*true/, `${route} must require a signed-in host account.`);
  }

  console.log('paper-host guest access contract passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
