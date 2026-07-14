import assert from 'node:assert/strict';
import http from 'node:http';

import { llmInvoke } from '../src/lib/ai-service';

const secret = 'test-only-text-secret';

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
  const chatRequests: Array<{ authorization?: string; body: unknown }> = [];
  const chatServer = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    chatRequests.push({ authorization: request.headers.authorization, body: JSON.parse(raw) });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'managed ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'answer' } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n\n'));
  });
  const chatPort = await listen(chatServer);

  const resolverScenes: string[] = [];
  const resolverServer = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    resolverScenes.push(url.searchParams.get('scene') || '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      code: 0,
      data: {
        model: 'managed-paper-model',
        modelType: 1,
        apiKey: secret,
        url: `http://127.0.0.1:${chatPort}/api/v3`,
        temperature: 0.2,
        maxTokens: 512,
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
  delete process.env.ARK_API_BASE;
  delete process.env.ARK_API_KEY;

  try {
    const answer = await llmInvoke([{ role: 'user', content: 'Use the managed paper model.' }]);

    assert.equal(answer, 'managed answer');
    assert.deepEqual(resolverScenes, ['paper_reading']);
    assert.equal(chatRequests.length, 1);
    assert.equal(chatRequests[0]?.authorization, `Bearer ${secret}`);
    assert.deepEqual(chatRequests[0]?.body, {
      model: 'managed-paper-model',
      messages: [{ role: 'user', content: 'Use the managed paper model.' }],
      temperature: 0.7,
      stream: true,
    });
    assert(!answer.includes(secret));
  } finally {
    delete process.env.ZHIQI_MODEL_RESOLVE_URL;
    delete process.env.ZHIQI_SERVICE_TOKEN;
    delete process.env.ALLOW_INSECURE_API_BASE;
    delete process.env.ALLOW_PRIVATE_API_BASE;
    await Promise.all([
      new Promise<void>(resolve => chatServer.close(() => resolve())),
      new Promise<void>(resolve => resolverServer.close(() => resolve())),
    ]);
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'paper_reading resolver config is used by business text calls',
      'managed model credentials stay server-side',
      'OpenAI-compatible SSE remains supported',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
