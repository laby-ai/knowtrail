import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { ingestExtractedSource } from '../src/lib/ingestion-store';
import { POST as knowledgeCardsPost } from '../src/app/api/ai/knowledge-cards/route';
import { POST as podcastPost } from '../src/app/api/ai/podcast/route';
import { POST as pptPost } from '../src/app/api/ai/ppt/route';
import { POST as pptV2Post } from '../src/app/api/ai/ppt-v2/route';
import { POST as reportPost } from '../src/app/api/ai/report/route';
import { POST as studioToolPost } from '../src/app/api/ai/studio-tool/route';
import { GET as ingestionSourcesGet } from '../src/app/api/ingestion/sources/route';

function jsonRequest(url: string, body: unknown, token?: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response) {
  const text = await response.text();
  return JSON.parse(text) as Record<string, unknown>;
}

function startAccountAuthMock() {
  const sessions: Record<string, unknown> = {
    'token-alpha': {
      tenant_id: 'tenant_acme',
      tenant_name: 'Acme',
      member: {
        id: 'member-alpha',
        display_name: 'Alpha',
        email: 'alpha@example.com',
        role_key: 'member',
        status: 'active',
      },
    },
    'token-beta': {
      tenant_id: 'tenant_acme',
      tenant_name: 'Acme',
      member: {
        id: 'member-beta',
        display_name: 'Beta',
        email: 'beta@example.com',
        role_key: 'member',
        status: 'active',
      },
    },
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && url.pathname === '/v1/auth/me') {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
      const session = sessions[token];
      if (session) {
        res.end(JSON.stringify(session));
        return;
      }
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'invalid_token' }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  return new Promise<{ origin: string; close: () => Promise<void> }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate account auth mock port.'));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(closeResolve => server.close(() => closeResolve())),
      });
    });
  });
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-studio-grounded-test-'));
  const originals = {
    sourceStorePath: process.env.SOURCE_STORE_PATH,
    zvecStorePath: process.env.ZVEC_STORE_PATH,
    accountApiBase: process.env.ACCOUNT_CENTER_API_BASE,
    accountRequireAuth: process.env.ACCOUNT_CENTER_REQUIRE_AUTH,
  };
  process.env.SOURCE_STORE_PATH = path.join(tmpDir, 'sources.json');
  process.env.ZVEC_STORE_PATH = path.join(tmpDir, 'zvec');
  process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'false';

  try {
    await ingestExtractedSource({
      id: 'paper-studio-grounded',
      fileName: 'studio-grounded.txt',
      fileType: 'txt',
      title: 'Studio Grounded Context',
      shortName: 'Studio. 2026',
      content: '右侧 Studio prompt 产物必须复用同一套 grounded context，并保留 sourceId、chunkId 和页码引用。',
      rawContent: '第 3 页：报告、知识卡片和 PPT 应该复用统一检索证据，避免各路由重新拼全文。',
      ownerMemberId: 'member-alpha',
      notebookId: 'notebook-alpha',
    });

    const papers = [{ id: 'paper-studio-grounded', title: 'Studio Grounded Context' }];

    const cardsResponse = await knowledgeCardsPost(jsonRequest('http://localhost/api/ai/knowledge-cards', {
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: '知识卡片应复用统一检索证据并展示来源编号[1]。',
    }));
    assert.equal(cardsResponse.status, 200);
    const cardsJson = await readJson(cardsResponse);
    assert.equal((cardsJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((cardsJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');
    assert.equal((cardsJson.citationAudit as { status?: string }).status, 'pass');

    const reportResponse = await reportPost(jsonRequest('http://localhost/api/ai/report', {
      papers,
      outline: '统一 grounded context 的工程价值',
      debugRetrievalOnly: true,
    }));
    assert.equal(reportResponse.status, 200);
    const reportJson = await readJson(reportResponse);
    assert.equal((reportJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((reportJson.citations as Array<{ chunkId?: string }>)[0].chunkId, 'paper-studio-grounded::chunk-1');

    const podcastResponse = await podcastPost(jsonRequest('http://localhost/api/ai/podcast', {
      content: '请生成播客脚本',
      papers,
      debugRetrievalOnly: true,
    }));
    assert.equal(podcastResponse.status, 200);
    const podcastJson = await readJson(podcastResponse);
    assert.equal((podcastJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((podcastJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');

    const pptResponse = await pptPost(jsonRequest('http://localhost/api/ai/ppt', {
      papers,
      debugRetrievalOnly: true,
      pageCount: 4,
      detailLevel: 'concise',
      language: 'zh',
    }));
    assert.equal(pptResponse.status, 200);
    const pptJson = await readJson(pptResponse);
    assert.equal((pptJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((pptJson.citations as Array<{ chunkId?: string }>)[0].chunkId, 'paper-studio-grounded::chunk-1');

    const pptV2Response = await pptV2Post(jsonRequest('http://localhost/api/ai/ppt-v2', {
      papers,
      debugRetrievalOnly: true,
      duration: 10,
      audience: 'researchers',
    }));
    assert.equal(pptV2Response.status, 200);
    const pptV2Json = await readJson(pptV2Response);
    assert.equal((pptV2Json.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((pptV2Json.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');

    const studioToolResponse = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
      toolId: 'interactive',
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: '互动页面应复用统一检索证据并展示来源编号[1]。',
    }));
    assert.equal(studioToolResponse.status, 200);
    const studioToolJson = await readJson(studioToolResponse);
    assert.equal((studioToolJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((studioToolJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');
    assert.equal((studioToolJson.citationAudit as { status?: string }).status, 'pass');

    const seminarToolResponse = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
      toolId: 'seminar',
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: '组会材料草稿必须标出证据来源并展示来源编号[1]。',
    }));
    assert.equal(seminarToolResponse.status, 200);
    const seminarToolJson = await readJson(seminarToolResponse);
    assert.equal((seminarToolJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((seminarToolJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');
    assert.equal((seminarToolJson.citationAudit as { status?: string }).status, 'pass');

    const experimentToolResponse = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
      toolId: 'experiment',
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: '实验记录草稿必须标出实验条件、观察结果和证据来源[1]。',
    }));
    assert.equal(experimentToolResponse.status, 200);
    const experimentToolJson = await readJson(experimentToolResponse);
    assert.equal((experimentToolJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((experimentToolJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');
    assert.equal((experimentToolJson.citationAudit as { status?: string }).status, 'pass');

    const resultsToolResponse = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
      toolId: 'results',
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: 'Results 初稿必须区分数据观察、证据依据和局限边界[1]。',
    }));
    assert.equal(resultsToolResponse.status, 200);
    const resultsToolJson = await readJson(resultsToolResponse);
    assert.equal((resultsToolJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((resultsToolJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');
    assert.equal((resultsToolJson.citationAudit as { status?: string }).status, 'pass');

    const resultsMissingMarkersResponse = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
      toolId: 'results',
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: 'Results 初稿缺少来源标记。',
    }));
    assert.equal(resultsMissingMarkersResponse.status, 422);
    const resultsMissingMarkersJson = await readJson(resultsMissingMarkersResponse);
    assert.equal(resultsMissingMarkersJson.success, false);
    assert.equal(resultsMissingMarkersJson.errorType, 'results_citation_audit_failed');
    assert.equal((resultsMissingMarkersJson.citationAudit as { status?: string }).status, 'missing-markers');

    const resultsInvalidMarkersResponse = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
      toolId: 'results',
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: 'Results 初稿引用了不存在的来源[99]。',
    }));
    assert.equal(resultsInvalidMarkersResponse.status, 422);
    const resultsInvalidMarkersJson = await readJson(resultsInvalidMarkersResponse);
    assert.equal(resultsInvalidMarkersJson.success, false);
    assert.equal(resultsInvalidMarkersJson.errorType, 'results_citation_audit_failed');
    assert.equal((resultsInvalidMarkersJson.citationAudit as { status?: string }).status, 'invalid-markers');

    const accountMock = await startAccountAuthMock();
    try {
      process.env.ACCOUNT_CENTER_API_BASE = accountMock.origin;
      process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'true';
      const unauthStudioTool = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
        toolId: 'interactive',
        papers,
        debugRetrievalOnly: true,
      }));
      assert.equal(unauthStudioTool.status, 401);
      assert.equal((await readJson(unauthStudioTool)).errorType, 'account_login_required');

      const alphaStudioTool = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
        toolId: 'interactive',
        notebookId: 'notebook-alpha',
        papers,
        debugRetrievalOnly: true,
      }, 'token-alpha'));
      assert.equal(alphaStudioTool.status, 200);
      const alphaStudioJson = await readJson(alphaStudioTool);
      assert.equal((alphaStudioJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
      assert.equal((alphaStudioJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');

      const alphaWrongNotebookStudioTool = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
        toolId: 'interactive',
        notebookId: 'notebook-beta',
        papers,
        debugRetrievalOnly: true,
      }, 'token-alpha'));
      assert.equal(alphaWrongNotebookStudioTool.status, 200);
      const alphaWrongNotebookJson = await readJson(alphaWrongNotebookStudioTool);
      assert.notEqual((alphaWrongNotebookJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
      assert.equal((alphaWrongNotebookJson.retrieval as { persistedSourceCount?: number }).persistedSourceCount, 0);

      const alphaSourceList = await ingestionSourcesGet(new NextRequest('http://localhost/api/ingestion/sources?notebookId=notebook-alpha', {
        headers: { authorization: 'Bearer token-alpha' },
      }));
      assert.equal(alphaSourceList.status, 200);
      const alphaSourceListJson = await readJson(alphaSourceList);
      assert.equal((alphaSourceListJson.sources as Array<{ id?: string }>).length, 1);

      const alphaWrongNotebookSourceList = await ingestionSourcesGet(new NextRequest('http://localhost/api/ingestion/sources?notebookId=notebook-beta', {
        headers: { authorization: 'Bearer token-alpha' },
      }));
      assert.equal(alphaWrongNotebookSourceList.status, 200);
      const alphaWrongNotebookSourceListJson = await readJson(alphaWrongNotebookSourceList);
      assert.equal((alphaWrongNotebookSourceListJson.sources as Array<{ id?: string }>).length, 0);

      const betaStudioTool = await studioToolPost(jsonRequest('http://localhost/api/ai/studio-tool', {
        toolId: 'interactive',
        papers,
        debugRetrievalOnly: true,
      }, 'token-beta'));
      assert.equal(betaStudioTool.status, 200);
      const betaStudioJson = await readJson(betaStudioTool);
      assert.notEqual((betaStudioJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
      assert.equal((betaStudioJson.retrieval as { persistedSourceCount?: number }).persistedSourceCount, 0);
    } finally {
      await accountMock.close();
      if (originals.accountApiBase === undefined) delete process.env.ACCOUNT_CENTER_API_BASE;
      else process.env.ACCOUNT_CENTER_API_BASE = originals.accountApiBase;
      process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'false';
    }

    const emptyPptResponse = await pptPost(jsonRequest('http://localhost/api/ai/ppt', {
      papers: [],
      debugRetrievalOnly: true,
    }));
    assert.equal(emptyPptResponse.status, 400, 'ppt route should reject empty paper selection');
    const emptyPptJson = await readJson(emptyPptResponse);
    assert.match(String(emptyPptJson.error || ''), /请选择|文献|PPT/, 'ppt empty-selection error should be user-facing');

    const emptyPptV2Response = await pptV2Post(jsonRequest('http://localhost/api/ai/ppt-v2', {
      papers: [],
      debugRetrievalOnly: true,
    }));
    assert.equal(emptyPptV2Response.status, 400, 'ppt-v2 route should reject empty paper selection');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'knowledge cards route uses grounded retrieval debug path',
        'knowledge cards route audits citation markers in generated card text',
        'report route uses grounded retrieval debug path',
        'podcast route accepts content and uses grounded retrieval debug path',
        'ppt route builds grounded evidence outline debug path',
        'ppt-v2 route builds academic evidence outline debug path',
        'studio-tool route builds grounded artifact evidence debug path',
        'seminar material Studio tool builds grounded artifact evidence debug path',
        'experiment record Studio tool builds grounded artifact evidence debug path',
        'Results draft Studio tool builds grounded artifact evidence debug path',
        'Results draft rejects missing citation markers',
        'Results draft rejects invalid citation markers',
        'studio-tool route returns 401 when account auth is required and no token is provided',
        'studio-tool route scopes persisted retrieval by ownerMemberId from account token',
        'studio-tool route scopes persisted retrieval by notebookId under the same owner',
        'ingestion sources route scopes source lists by ownerMemberId and notebookId',
        'studio routes can scope persisted sources by selected paper id',
        'ppt routes reject empty source selection with user-facing errors',
      ],
      cardsMode: (cardsJson.retrieval as { mode?: string }).mode,
      reportMode: (reportJson.retrieval as { mode?: string }).mode,
      podcastMode: (podcastJson.retrieval as { mode?: string }).mode,
      pptMode: (pptJson.retrieval as { mode?: string }).mode,
      pptV2Mode: (pptV2Json.retrieval as { mode?: string }).mode,
      studioToolMode: (studioToolJson.retrieval as { mode?: string }).mode,
      citationSource: (reportJson.citations as Array<{ sourceId?: string }>)[0].sourceId,
    }, null, 2));
  } finally {
    if (originals.sourceStorePath === undefined) delete process.env.SOURCE_STORE_PATH;
    else process.env.SOURCE_STORE_PATH = originals.sourceStorePath;
    if (originals.zvecStorePath === undefined) delete process.env.ZVEC_STORE_PATH;
    else process.env.ZVEC_STORE_PATH = originals.zvecStorePath;
    if (originals.accountApiBase === undefined) delete process.env.ACCOUNT_CENTER_API_BASE;
    else process.env.ACCOUNT_CENTER_API_BASE = originals.accountApiBase;
    if (originals.accountRequireAuth === undefined) delete process.env.ACCOUNT_CENTER_REQUIRE_AUTH;
    else process.env.ACCOUNT_CENTER_REQUIRE_AUTH = originals.accountRequireAuth;
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
