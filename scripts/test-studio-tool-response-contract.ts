import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as studioToolPost } from '../src/app/api/ai/studio-tool/route';
import {
  studioToolError,
  studioToolSuccess,
  type StudioToolDebugResponse,
  type StudioToolGenerateResponse,
} from '../src/lib/studio-tool-api-contract';

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai/studio-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJson<T = Record<string, unknown>>(response: Response) {
  return await response.json() as T;
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
    assert.equal(malformed.status, 400);
    assertNoStore(malformed);
    const malformedJson = await readJson(malformed);
    assert.equal(malformedJson.success, false);
    assert.equal(malformedJson.errorType, 'studio_tool_invalid_request');
    assert.equal(malformedJson.error, '请求内容不是有效的 JSON 对象。');

    const nullBody = await studioToolPost(jsonRequest(null));
    assert.equal(nullBody.status, 400);
    assertNoStore(nullBody);
    assert.deepEqual(await readJson(nullBody), {
      success: false,
      error: '请求内容不是有效的 JSON 对象。',
      errorType: 'studio_tool_invalid_request',
    });

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
    const debugSuccessJson = await readJson<StudioToolDebugResponse>(debugSuccess);
    assert.equal(debugSuccessJson.success, true);
    if (debugSuccessJson.success) {
      assert.equal(typeof debugSuccessJson.promptContextLength, 'number');
      assert.ok(!('artifact' in debugSuccessJson));
    }

    const generatedContractResponse = studioToolSuccess({
      artifact: {
        id: 'studio-tool-contract-1',
        type: 'discussion' as const,
        notebookId: 'notebook-contract',
        title: 'Discussion 初稿',
        markdown: '## 核心发现\n证据支持当前结论[1]。',
        createdAt: '2026-07-10T00:00:00.000Z',
        generationPattern: '按证据生成',
        resultShape: ['核心发现'],
      },
      citations: [],
      retrieval: null,
      billing: { status: 'settled' as const, estimatedUnits: 1 },
    });
    const generatedContract = await readJson<StudioToolGenerateResponse>(generatedContractResponse);
    assert.equal(generatedContract.success, true);
    if (generatedContract.success) {
      assert.equal(generatedContract.artifact.type, 'discussion');
      assert.deepEqual(generatedContract.citations, []);
      assert.equal(generatedContract.retrieval, null);
      assert.equal(generatedContract.billing?.status, 'settled');
    }

    const timeoutContract = studioToolError(
      'studio_tool_timeout',
      '产物生成超时。请减少资料数量或稍后重试。',
      504,
    );
    assert.equal(timeoutContract.status, 504);
    assertNoStore(timeoutContract);
    assert.equal((await readJson(timeoutContract)).errorType, 'studio_tool_timeout');

    const billingContract = studioToolError(
      'quota_reservation_failed',
      '账号额度预占失败，请检查账号额度或稍后重试。',
      402,
      { status: 'failed' },
    );
    assert.equal(billingContract.status, 402);
    assertNoStore(billingContract);
    const billingContractJson = await readJson(billingContract);
    assert.equal(billingContractJson.success, false);
    assert.equal(billingContractJson.status, 'failed');

    const auditContract = studioToolError(
      'studio_tool_citation_audit_failed',
      '引用校验失败。',
      422,
      { artifact: generatedContract.success ? generatedContract.artifact : undefined, citations: [], retrieval: null },
    );
    assert.equal(auditContract.status, 422);
    assert.equal((await readJson(auditContract)).success, false);

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'unknown Studio tool has stable 400 error contract',
        'missing Studio sources have stable 400 error contract',
        'account login failures retain the compatible 401 contract',
        'evidence failures use the stable 422 contract',
        'malformed and null JSON bodies have a user-safe 400 contract',
        'Studio success response remains backwards compatible and no-store',
        'debug and generated success response types are distinct',
        'generated success exposes the complete client-consumed contract',
        'timeout, billing, and audit failures preserve stable status and metadata contracts',
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
