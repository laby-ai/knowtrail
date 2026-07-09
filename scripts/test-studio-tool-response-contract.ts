import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as studioToolPost } from '../src/app/api/ai/studio-tool/route';

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai/studio-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

function assertNoStore(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

async function main() {
  const previousRequireAuth = process.env.ACCOUNT_CENTER_REQUIRE_AUTH;
  process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'false';

  try {
    const unknownTool = await studioToolPost(jsonRequest({ toolId: 'not-a-tool', papers: [{}] }));
    assert.equal(unknownTool.status, 400);
    assertNoStore(unknownTool);
    assert.deepEqual(await readJson(unknownTool), {
      success: false,
      error: '未知的产物工具',
      errorType: 'studio_tool_unknown',
    });

    const missingSources = await studioToolPost(jsonRequest({ toolId: 'interactive', papers: [] }));
    assert.equal(missingSources.status, 400);
    assertNoStore(missingSources);
    assert.deepEqual(await readJson(missingSources), {
      success: false,
      error: '请先选择资料，再生成产物。',
      errorType: 'studio_tool_sources_required',
    });

    const malformedRequest = new NextRequest('http://localhost/api/ai/studio-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    const malformed = await studioToolPost(malformedRequest);
    assert.equal(malformed.status, 500);
    assertNoStore(malformed);
    const malformedJson = await readJson(malformed);
    assert.equal(malformedJson.success, false);
    assert.equal(malformedJson.errorType, 'studio_tool_generation_failed');
    assert.equal(typeof malformedJson.error, 'string');

    process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'true';
    const loginRequired = await studioToolPost(jsonRequest({
      toolId: 'interactive',
      papers: [{ id: 'auth-source', content: '需要账号作用域的资料。' }],
    }));
    assert.equal(loginRequired.status, 401);
    assertNoStore(loginRequired);
    const loginRequiredJson = await readJson(loginRequired);
    assert.equal(loginRequiredJson.success, false);
    assert.equal(loginRequiredJson.errorType, 'account_login_required');
    assert.equal(loginRequiredJson.status, 'failed');

    process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'false';
    const citationsUnavailable = await studioToolPost(jsonRequest({
      toolId: 'discussion',
      papers: [{ id: 'empty-source' }],
      debugRetrievalOnly: true,
      debugAnswerText: '当前没有可引用内容。',
    }));
    assert.equal(citationsUnavailable.status, 422);
    assertNoStore(citationsUnavailable);
    const citationsUnavailableJson = await readJson(citationsUnavailable);
    assert.equal(citationsUnavailableJson.success, false);
    assert.equal(citationsUnavailableJson.errorType, 'studio_tool_citations_unavailable');

    const debugSuccess = await studioToolPost(jsonRequest({
      toolId: 'interactive',
      papers: [{ id: 'contract-source', title: '契约来源', content: '可追溯的科研证据。' }],
      debugRetrievalOnly: true,
    }));
    assert.equal(debugSuccess.status, 200);
    assertNoStore(debugSuccess);
    assert.equal((await readJson(debugSuccess)).success, true);

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'unknown Studio tool has stable 400 error contract',
        'missing Studio sources have stable 400 error contract',
        'account login failures retain the compatible 401 contract',
        'evidence failures use the stable 422 contract',
        'unexpected Studio failure has stable 500 error contract',
        'Studio success response remains backwards compatible and no-store',
      ],
    }, null, 2));
  } finally {
    if (previousRequireAuth === undefined) delete process.env.ACCOUNT_CENTER_REQUIRE_AUTH;
    else process.env.ACCOUNT_CENTER_REQUIRE_AUTH = previousRequireAuth;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
