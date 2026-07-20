import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const mutableEnv = process.env as Record<string, string | undefined>;

function startDoubaoTtsMock() {
  let hitCount = 0;
  let maxTtsTextLength = 0;
  const server = http.createServer((req, res) => {
    hitCount += 1;
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(rawBody) as { req_params?: { text?: string } };
        maxTtsTextLength = Math.max(maxTtsTextLength, parsed.req_params?.text?.length || 0);
      } catch {
        // Ignore malformed mock requests; provider tests cover payload shape.
      }
      if (rawBody.includes('额度失败')) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          reqid: 'req-studio-job-quota',
          code: 45000290,
          message: 'QuotaExceeded.AgentPlanQuotaExceeded',
        }));
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        data: {
          audio_url: 'https://cdn.example.com/studio-job-podcast.mp3',
        },
      }));
    });
  });

  return new Promise<{
    endpoint: string;
    getHitCount: () => number;
    getMaxTtsTextLength: () => number;
    close: () => Promise<void>;
  }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate Doubao TTS mock port.'));
        return;
      }
      resolve({
        endpoint: `http://127.0.0.1:${address.port}/api/v3/plan/tts/unidirectional`,
        getHitCount: () => hitCount,
        getMaxTtsTextLength: () => maxTtsTextLength,
        close: () => new Promise(closeResolve => server.close(() => closeResolve())),
      });
    });
  });
}

async function waitForJob(
  getJob: (id: string) => import('../src/lib/studio-job').StudioJob | undefined,
  id: string,
  expected: string,
) {
  const deadline = Date.now() + 5_000;
  let last: import('../src/lib/studio-job').StudioJob | undefined;
  while (Date.now() < deadline) {
    last = getJob(id);
    if (last?.status === expected) return last;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`Timed out waiting for ${id} to become ${expected}; last=${JSON.stringify(last)}`);
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function jsonGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

async function readJson(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-studio-podcast-job-'));
  const mock = await startDoubaoTtsMock();
  const originals = {
    sourceStorePath: mutableEnv.SOURCE_STORE_PATH,
    zvecStorePath: mutableEnv.ZVEC_STORE_PATH,
    endpoint: mutableEnv.AGENTPLAN_TTS_ENDPOINT,
    key: mutableEnv.AGENTPLAN_TTS_API_KEY,
    arkKey: mutableEnv.ARK_API_KEY,
    resource: mutableEnv.AGENTPLAN_TTS_RESOURCE_ID,
    speaker: mutableEnv.AGENTPLAN_TTS_SPEAKER,
    provider: mutableEnv.PODCAST_AUDIO_PROVIDER,
    maxTextChars: mutableEnv.AGENTPLAN_TTS_MAX_TEXT_CHARS,
    retryMaxTextChars: mutableEnv.AGENTPLAN_TTS_RETRY_MAX_TEXT_CHARS,
    maxSegments: mutableEnv.AGENTPLAN_TTS_MAX_SEGMENTS,
    studioJobStorePath: mutableEnv.STUDIO_JOB_STORE_PATH,
    accountRequireAuth: mutableEnv.ACCOUNT_CENTER_REQUIRE_AUTH,
  };

  try {
    mutableEnv.SOURCE_STORE_PATH = path.join(tmpDir, 'sources.json');
    mutableEnv.ZVEC_STORE_PATH = path.join(tmpDir, 'zvec');
    mutableEnv.STUDIO_JOB_STORE_PATH = path.join(tmpDir, 'studio-jobs.json');
    mutableEnv.AGENTPLAN_TTS_ENDPOINT = mock.endpoint;
    mutableEnv.AGENTPLAN_TTS_API_KEY = 'test-agent-plan-tts-key';
    delete mutableEnv.ARK_API_KEY;
    mutableEnv.AGENTPLAN_TTS_RESOURCE_ID = 'seed-tts-2.0';
    mutableEnv.AGENTPLAN_TTS_SPEAKER = 'test-speaker';
    mutableEnv.PODCAST_AUDIO_PROVIDER = 'doubao-tts';
    mutableEnv.AGENTPLAN_TTS_MAX_TEXT_CHARS = '1200';
    mutableEnv.AGENTPLAN_TTS_RETRY_MAX_TEXT_CHARS = '1200';
    // Keep this contract test on the local TTS mock. Multiple successful
    // segments are merged by fetching their audio URLs, which would turn the
    // example CDN URL below into an unintended external network dependency.
    mutableEnv.AGENTPLAN_TTS_MAX_SEGMENTS = '1';

    const { getPodcastStudioJobResponse, submitPodcastJob } = await import('../src/lib/studio-podcast-job');
    const { getStudioJob, reloadStudioJobsFromDiskForTest, studioJobStoreStatus, toStudioJobResponse } = await import('../src/lib/studio-job');

    const papers = [{
      id: 'paper-studio-podcast-job',
      title: 'Studio Podcast Job Contract',
      shortName: 'StudioJob. 2026',
      abstract: 'StudioJob 应统一管理播客任务的状态、阶段、进度、引用和音频产物。',
      content: '第 2 页：Open Notebook 式 Studio job 要保留 episode/profile 证据；RAGFlow 式引用要包含 sourceId 和 chunkId。',
    }];

    const successJob = await submitPodcastJob({
      requestedText: '请生成一段结构化双人播客。',
      papers,
      aiConfig: { apiKey: 'test-doubao-tts-key', ttsSpeaker: 'test-speaker' },
      ownerMemberId: 'member-alpha',
      notebookId: 'notebook-alpha',
    });
    assert.equal(successJob.type, 'podcast');
    assert.equal(successJob.ownerMemberId, 'member-alpha');
    assert.equal(successJob.notebookId, 'notebook-alpha');
    assert.ok(successJob.citations.length > 0, 'podcast job should preserve grounded citations');
    assert.equal(successJob.retrieval?.degraded, true);

    const succeeded = await waitForJob(getStudioJob, successJob.id, 'succeeded');
    const successResponse = toStudioJobResponse(succeeded);
    assert.equal(successResponse.status, 'completed');
    assert.equal(successResponse.audioUrl, 'https://cdn.example.com/studio-job-podcast.mp3');
    assert.equal(successResponse.job.stage, 'completed');
    assert.equal(successResponse.job.progress, 100);
    assert.equal(successResponse.provider, 'doubao-tts-v3');
    assert.ok(Array.isArray(successResponse.segments));
    assert.ok(successResponse.segments.length > 0, 'podcast response should expose segment status');
    assert.ok(mock.getMaxTtsTextLength() <= 280, `TTS text should be capped for Agent Plan; got ${mock.getMaxTtsTextLength()}`);
    reloadStudioJobsFromDiskForTest();
    const persistedSuccess = getStudioJob(successJob.id);
    assert.equal(persistedSuccess?.status, 'succeeded', 'completed StudioJob should survive memory reload from local job store');
    assert.equal(getStudioJob(successJob.id, { ownerMemberId: 'member-alpha' })?.status, 'succeeded');
    assert.equal(getStudioJob(successJob.id, { ownerMemberId: 'member-beta' }), undefined);
    assert.equal(getStudioJob(successJob.id, { ownerMemberId: 'member-alpha', notebookId: 'notebook-beta' }), undefined);
    assert.equal(getPodcastStudioJobResponse(successJob.id, { ownerMemberId: 'member-alpha', notebookId: 'notebook-alpha' })?.status, 'completed');
    assert.equal(getPodcastStudioJobResponse(successJob.id, { ownerMemberId: 'member-alpha', notebookId: 'notebook-beta' }), undefined);
    assert.equal(getPodcastStudioJobResponse(successJob.id, { ownerMemberId: 'member-beta' }), undefined);
    assert.equal(studioJobStoreStatus().path, path.join(tmpDir, 'studio-jobs.json'));

    const failedJob = await submitPodcastJob({
      requestedText: '请生成第二段播客，用于测试额度失败后的任务壳。',
      papers,
      aiConfig: { apiKey: 'test-doubao-tts-key', ttsSpeaker: 'test-speaker' },
      ownerMemberId: 'member-alpha',
      notebookId: 'notebook-alpha',
    });
    const failed = await waitForJob(getStudioJob, failedJob.id, 'failed');
    assert.equal(failed?.stage, 'failed');
    assert.equal(failed?.error?.type, 'rate_limit');
    assert.equal(failed?.error?.retryable, true);
    assert.equal(failed?.error?.requestId, 'req-studio-job-quota');
    assert.ok(failed?.citations.length, 'failed podcast job should keep citations for UI recovery');
    assert.ok(failed?.artifact?.meta?.dialoguePreview, 'failed podcast job should keep dialogue preview evidence');
    const failedResponse = toStudioJobResponse(failed);
    assert.equal(failedResponse.status, 'failed');
    assert.ok(failedResponse.dialoguePreview, 'failed response should expose dialogue preview for recovery UI');
    assert.ok(Array.isArray(failedResponse.segments), 'failed response should expose segment attempts for recovery UI');

    const { POST: podcastPost, GET: podcastGet } = await import('../src/app/api/ai/podcast/route');
    const postResponse = await podcastPost(jsonRequest('http://localhost/api/ai/podcast', {
      content: '请通过 API 路由提交播客 StudioJob。',
      papers,
      aiConfig: { apiKey: 'test-doubao-tts-key', ttsSpeaker: 'test-speaker' },
      notebookId: 'notebook-alpha',
    }));
    assert.equal(postResponse.status, 202);
    const postJson = await readJson(postResponse);
    assert.equal(postJson.status, 'running');
    assert.ok(String(postJson.taskId || '').startsWith('studio-podcast-'));

    let routeStatus: Record<string, unknown> | undefined;
    const routeDeadline = Date.now() + 5_000;
    while (Date.now() < routeDeadline) {
      const getResponse = await podcastGet(jsonGet(`http://localhost/api/ai/podcast?taskId=${postJson.taskId}&notebookId=notebook-alpha`));
      assert.equal(getResponse.status, 200);
      routeStatus = await readJson(getResponse);
      if (routeStatus.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    assert.equal(routeStatus?.status, 'completed');
    assert.equal(routeStatus?.audioUrl, 'https://cdn.example.com/studio-job-podcast.mp3');
    assert.equal((routeStatus?.job as { stage?: string } | undefined)?.stage, 'completed');

    mutableEnv.ACCOUNT_CENTER_REQUIRE_AUTH = 'true';
    const unauthPost = await podcastPost(jsonRequest('http://localhost/api/ai/podcast', {
      content: '未登录用户不应能创建播客任务。',
      papers,
      aiConfig: { apiKey: 'test-doubao-tts-key', ttsSpeaker: 'test-speaker' },
    }));
    assert.equal(unauthPost.status, 401);
    assert.equal((await readJson(unauthPost)).errorType, 'account_login_required');
    const unauthGet = await podcastGet(jsonGet(`http://localhost/api/ai/podcast?taskId=${postJson.taskId}`));
    assert.equal(unauthGet.status, 401);
    assert.equal((await readJson(unauthGet)).errorType, 'account_login_required');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'StudioJob creates a podcast job shell with stage/progress/sourceIds/citations/retrieval',
        'podcast StudioJob succeeds with Doubao AgentPlan TTS audio artifact and provider metadata',
        'podcast StudioJob preserves grounded citations and retrieval metadata',
        'podcast StudioJob failure classifies Doubao AgentPlan TTS quota as retryable rate_limit',
        'podcast StudioJob failure keeps dialogue preview evidence for recovery UI',
        'podcast StudioJob failure exposes dialogue preview and segment attempts in API response',
        'podcast StudioJob response exposes segment status for partial/retry UI',
        'podcast StudioJob persists to local job store and survives memory reload',
        'podcast StudioJob is scoped by ownerMemberId and notebookId for direct lookup and API response helpers',
        'podcast API POST returns a StudioJob task shell with 202',
        'podcast API GET polls the StudioJob to completed audioUrl',
        'podcast API POST/GET return 401 when account auth is required and no token is provided',
      ],
      successStatus: successResponse.status,
      successStage: successResponse.job.stage,
      successAudioUrl: successResponse.audioUrl,
      successSegmentCount: successResponse.segments?.length,
      successPartial: successResponse.partial,
      persistedAfterReload: persistedSuccess?.status,
      ownerScopedLookup: getStudioJob(successJob.id, { ownerMemberId: 'member-alpha' })?.status,
      notebookScopedLookup: getStudioJob(successJob.id, { ownerMemberId: 'member-alpha', notebookId: 'notebook-alpha' })?.status,
      crossNotebookLookup: getStudioJob(successJob.id, { ownerMemberId: 'member-alpha', notebookId: 'notebook-beta' })?.status || null,
      crossOwnerLookup: getStudioJob(successJob.id, { ownerMemberId: 'member-beta' })?.status || null,
      jobStorePath: studioJobStoreStatus().path,
      failedStatus: failed?.status,
      failedErrorType: failed?.error?.type,
      failedSegmentCount: failedResponse.segments?.length,
      failedHasDialoguePreview: Boolean(failedResponse.dialoguePreview),
      routeStatus: routeStatus?.status,
      routeAudioUrl: routeStatus?.audioUrl,
      unauthPostStatus: unauthPost.status,
      unauthGetStatus: unauthGet.status,
      maxTtsTextLength: mock.getMaxTtsTextLength(),
      doubaoTtsCalls: mock.getHitCount(),
    }, null, 2));
  } finally {
    if (originals.sourceStorePath === undefined) delete mutableEnv.SOURCE_STORE_PATH;
    else mutableEnv.SOURCE_STORE_PATH = originals.sourceStorePath;
    if (originals.zvecStorePath === undefined) delete mutableEnv.ZVEC_STORE_PATH;
    else mutableEnv.ZVEC_STORE_PATH = originals.zvecStorePath;
    if (originals.endpoint === undefined) delete mutableEnv.AGENTPLAN_TTS_ENDPOINT;
    else mutableEnv.AGENTPLAN_TTS_ENDPOINT = originals.endpoint;
    if (originals.key === undefined) delete mutableEnv.AGENTPLAN_TTS_API_KEY;
    else mutableEnv.AGENTPLAN_TTS_API_KEY = originals.key;
    if (originals.arkKey === undefined) delete mutableEnv.ARK_API_KEY;
    else mutableEnv.ARK_API_KEY = originals.arkKey;
    if (originals.resource === undefined) delete mutableEnv.AGENTPLAN_TTS_RESOURCE_ID;
    else mutableEnv.AGENTPLAN_TTS_RESOURCE_ID = originals.resource;
    if (originals.speaker === undefined) delete mutableEnv.AGENTPLAN_TTS_SPEAKER;
    else mutableEnv.AGENTPLAN_TTS_SPEAKER = originals.speaker;
    if (originals.provider === undefined) delete mutableEnv.PODCAST_AUDIO_PROVIDER;
    else mutableEnv.PODCAST_AUDIO_PROVIDER = originals.provider;
    if (originals.maxTextChars === undefined) delete mutableEnv.AGENTPLAN_TTS_MAX_TEXT_CHARS;
    else mutableEnv.AGENTPLAN_TTS_MAX_TEXT_CHARS = originals.maxTextChars;
    if (originals.retryMaxTextChars === undefined) delete mutableEnv.AGENTPLAN_TTS_RETRY_MAX_TEXT_CHARS;
    else mutableEnv.AGENTPLAN_TTS_RETRY_MAX_TEXT_CHARS = originals.retryMaxTextChars;
    if (originals.maxSegments === undefined) delete mutableEnv.AGENTPLAN_TTS_MAX_SEGMENTS;
    else mutableEnv.AGENTPLAN_TTS_MAX_SEGMENTS = originals.maxSegments;
    if (originals.studioJobStorePath === undefined) delete mutableEnv.STUDIO_JOB_STORE_PATH;
    else mutableEnv.STUDIO_JOB_STORE_PATH = originals.studioJobStorePath;
    if (originals.accountRequireAuth === undefined) delete mutableEnv.ACCOUNT_CENTER_REQUIRE_AUTH;
    else mutableEnv.ACCOUNT_CENTER_REQUIRE_AUTH = originals.accountRequireAuth;
    await mock.close();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
