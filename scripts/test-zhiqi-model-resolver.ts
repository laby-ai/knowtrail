import assert from 'node:assert/strict';
import http from 'node:http';

import {
  getZhiqiModelResolverHealth,
  resolveZhiqiRuntimeModel,
} from '../src/lib/zhiqi-model-resolver';

const fakeSecret = 'test-only-model-secret';

async function main() {
  let embeddingReady = true;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const scene = url.searchParams.get('scene');
    const modelType = scene === 'paper_embedding' ? 5 : 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      code: 0,
      data: scene === 'paper_embedding' && !embeddingReady ? null : {
        model: `${scene}-model`,
        modelType,
        apiKey: fakeSecret,
        url: 'https://ark.example.com/api/v3',
      },
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.ZHIQI_MODEL_RESOLVE_URL = `http://127.0.0.1:${address.port}/admin-api/ai/model/resolve`;
  process.env.ZHIQI_SERVICE_TOKEN = 'test-only-service-token';

  const textModel = await resolveZhiqiRuntimeModel('paper_reading');
  assert.equal(textModel?.model, 'paper_reading-model');
  assert.equal(textModel?.modelType, 1);
  assert.equal(textModel?.apiKey, fakeSecret);

  const health = await getZhiqiModelResolverHealth();
  assert.equal(health.configured, true);
  assert.equal(health.reachable, true);
  assert.equal(health.textModelReady, true);
  assert.equal(health.embeddingModelReady, true);
  assert.equal(health.ready, true);
  assert(!JSON.stringify(health).includes(fakeSecret));
  assert(!JSON.stringify(health).includes('test-only-service-token'));

  embeddingReady = false;
  const partial = await getZhiqiModelResolverHealth();
  assert.equal(partial.reachable, true);
  assert.equal(partial.textModelReady, true);
  assert.equal(partial.embeddingModelReady, false);
  assert.equal(partial.ready, false);
  assert.equal(partial.status, 'partial');

  delete process.env.ZHIQI_MODEL_RESOLVE_URL;
  const unconfigured = await getZhiqiModelResolverHealth();
  assert.deepEqual(unconfigured, {
    configured: false,
    reachable: false,
    textModelReady: false,
    embeddingModelReady: false,
    ready: false,
    status: 'not-configured',
  });

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'text and embedding scenes resolve independently',
      'public health never includes model or service secrets',
      'missing embedding model reports a truthful partial state',
      'missing resolver configuration reports not-configured',
    ],
  }, null, 2));
  } finally {
    delete process.env.ZHIQI_MODEL_RESOLVE_URL;
    delete process.env.ZHIQI_SERVICE_TOKEN;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
