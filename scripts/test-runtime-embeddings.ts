import assert from 'node:assert/strict';
import http from 'node:http';

import { embedTexts } from '../src/lib/runtime-embeddings';

const secret = 'test-only-embedding-secret';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function main() {
  const embeddingRequests: Array<{ authorization?: string; body: unknown }> = [];
  const embeddingServer = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    embeddingRequests.push({
      authorization: request.headers.authorization,
      body: JSON.parse(raw),
    });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: { object: 'embedding', embedding: [0.2, 0.4] } }));
  });
  const embeddingPort = await listen(embeddingServer);

  const resolverServer = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    assert.equal(url.searchParams.get('scene'), 'paper_embedding');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      code: 0,
      data: {
        model: 'doubao-embedding-vision-251215',
        modelType: 5,
        apiKey: secret,
        url: `http://127.0.0.1:${embeddingPort}/api/v3`,
      },
    }));
  });
  const resolverPort = await listen(resolverServer);

  process.env.ZHIQI_MODEL_RESOLVE_URL = `http://127.0.0.1:${resolverPort}/admin-api/ai/model/resolve`;
  process.env.ZHIQI_SERVICE_TOKEN = 'test-only-service-token';
  process.env.ALLOW_INSECURE_API_BASE = 'true';
  process.env.ALLOW_PRIVATE_API_BASE = 'true';
  delete process.env.OPENAI_COMPAT_API_BASE;
  delete process.env.OPENAI_COMPAT_API_KEY;

  try {
    const vectors = await embedTexts(['first', 'second']);

    assert.deepEqual(vectors, [[0.2, 0.4], [0.2, 0.4]]);
    assert.equal(embeddingRequests.length, 2);
    assert.equal(embeddingRequests[0]?.authorization, `Bearer ${secret}`);
    assert.deepEqual(embeddingRequests.map(item => item.body), [
      { model: 'doubao-embedding-vision-251215', input: [{ type: 'text', text: 'first' }] },
      { model: 'doubao-embedding-vision-251215', input: [{ type: 'text', text: 'second' }] },
    ]);
    assert(!JSON.stringify(vectors).includes(secret));
  } finally {
    delete process.env.ZHIQI_MODEL_RESOLVE_URL;
    delete process.env.ZHIQI_SERVICE_TOKEN;
    delete process.env.ALLOW_INSECURE_API_BASE;
    delete process.env.ALLOW_PRIVATE_API_BASE;
    await Promise.all([
      new Promise<void>(resolve => embeddingServer.close(() => resolve())),
      new Promise<void>(resolve => resolverServer.close(() => resolve())),
    ]);
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'paper_embedding resolver config is used by business embedding calls',
      'Ark multimodal text request contract is preserved per input',
      'embedding credentials are not returned in vectors',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
