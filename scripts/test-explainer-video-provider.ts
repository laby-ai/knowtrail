import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  createArkExplainerVideoProvider,
  resolveExplainerVideoProviderConfig,
} from '../src/lib/explainer-video-provider';

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

async function main() {
  const requests: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = [];
  let pollCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ url, init, body });

    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (init?.method === 'POST') return jsonResponse({ id: 'task-video-1' });
    pollCount += 1;
    if (pollCount === 1) return jsonResponse({ status: 'running' });
    return jsonResponse({
      status: 'succeeded',
      content: {
        video_url: 'https://cdn.example.com/explainer.mp4',
        last_frame_url: 'https://cdn.example.com/explainer-last-frame.webp',
      },
    });
  };

  const config = resolveExplainerVideoProviderConfig({
    ARK_AGENTPLAN_API_BASE: 'https://ark.example.com/api/plan/v3',
    ARK_AGENTPLAN_API_KEY: 'test-video-key',
    ARK_AGENTPLAN_VIDEO_MODEL: 'doubao-seedance-1-5-pro-test',
  });
  assert.equal(config.modelFamily, 'seedance-1.5');
  assert.equal(config.configured, true);
  assert.equal('apiKey' in config.publicStatus, false, 'public status must never expose credentials');

  const provider = createArkExplainerVideoProvider(config, {
    fetchImpl,
    wait: async () => undefined,
  });
  const task = await provider.submit({
    prompt: '基于已核验来源生成一段方法流程讲解镜头，不添加统计结论。',
    ratio: '16:9',
    resolution: '720p',
    durationSeconds: 7,
    generateAudio: true,
  });
  assert.equal(task.id, 'task-video-1');
  assert.equal(requests[0].url, 'https://ark.example.com/api/plan/v3/contents/generations/tasks');
  assert.equal(requests[0].init?.method, 'POST');
  assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, 'Bearer test-video-key');
  assert.equal(requests[0].body?.duration, 10, 'Seedance 1.5 duration must normalize to a supported value');
  assert.equal(requests[0].body?.watermark, false);
  assert.equal(requests[0].body?.generate_audio, true);
  assert.deepEqual(requests[0].body?.content, [{
    type: 'text',
    text: '基于已核验来源生成一段方法流程讲解镜头，不添加统计结论。',
  }]);

  const completed = await provider.waitForResult(task.id, { maxAttempts: 3, intervalMs: 1 });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.videoUrl, 'https://cdn.example.com/explainer.mp4');
  assert.equal(completed.lastFrameUrl, 'https://cdn.example.com/explainer-last-frame.webp');
  assert.equal(requests[1].url, 'https://ark.example.com/api/plan/v3/contents/generations/tasks/task-video-1');

  const failedProvider = createArkExplainerVideoProvider(config, {
    fetchImpl: async () => jsonResponse({ status: 'failed', error: { message: 'provider rejected prompt' } }),
    wait: async () => undefined,
  });
  await assert.rejects(
    () => failedProvider.waitForResult('task-failed', { maxAttempts: 1, intervalMs: 1 }),
    /provider rejected prompt/,
  );

  const pendingProvider = createArkExplainerVideoProvider(config, {
    fetchImpl: async () => jsonResponse({ status: 'running' }),
    wait: async () => undefined,
  });
  await assert.rejects(
    () => pendingProvider.waitForResult('task-timeout', { maxAttempts: 2, intervalMs: 1 }),
    /超时/,
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => provider.submit({
      prompt: '该调用应在请求发送前取消。',
      ratio: '16:9',
      resolution: '720p',
      durationSeconds: 5,
      generateAudio: false,
    }, { signal: controller.signal }),
    error => error instanceof Error && error.name === 'AbortError',
  );

  const missing = resolveExplainerVideoProviderConfig({});
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.publicStatus.missing, ['apiBase', 'apiKey', 'model']);
  assert.throws(() => createArkExplainerVideoProvider(missing), /未配置/);

  const taxonomySource = readFileSync(path.join(process.cwd(), 'src/lib/studio-research-taxonomy.ts'), 'utf8');
  const studioPanelSource = readFileSync(path.join(process.cwd(), 'src/components/studio/StudioPanel.tsx'), 'utf8');
  const healthRouteSource = readFileSync(path.join(process.cwd(), 'src/app/api/health/route.ts'), 'utf8');
  assert.doesNotMatch(taxonomySource, /explainer-video|讲解视频/);
  assert.doesNotMatch(studioPanelSource, /ExplainerVideo|讲解视频/);
  assert.match(healthRouteSource, /resolveExplainerVideoProviderConfig/);
  assert.match(healthRouteSource, /explainerVideoProvider/);
  assert.equal(
    existsSync(path.join(process.cwd(), 'src/components/features/PublishExport.tsx')),
    false,
    'the unreachable timer-only export panel must not advertise fake MP4 output',
  );

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'Ark task URL, authorization, and Seedance 1.5 duration normalization',
      'task polling returns a real video URL and last frame URL',
      'provider failure, timeout, and cancellation remain explicit',
      'public readiness status reports missing fields without exposing credentials',
      'the provider contract is backend-only and does not create a product entry',
      'the unreachable timer-only MP4 export placeholder is removed',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
