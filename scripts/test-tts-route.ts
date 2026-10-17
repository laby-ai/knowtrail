import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

function startDoubaoTtsRouteMock() {
  let seenBody = '';
  let seenHeaders: http.IncomingHttpHeaders = {};
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    seenHeaders = req.headers;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      seenBody += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        result: {
          audioData: Buffer.from('route-mp3-audio').toString('base64'),
        },
      }));
    });
  });

  return new Promise<{
    endpoint: string;
    close: () => Promise<void>;
    seen: () => { body: string; headers: http.IncomingHttpHeaders };
  }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate Doubao TTS route mock port.'));
        return;
      }
      resolve({
        endpoint: `http://127.0.0.1:${address.port}/api/v3/plan/tts/unidirectional`,
        close: () => new Promise<void>(done => server.close(() => done())),
        seen: () => ({ body: seenBody, headers: seenHeaders }),
      });
    });
  });
}

async function main() {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const originals = {
    endpoint: mutableEnv.AGENTPLAN_TTS_ENDPOINT,
    key: mutableEnv.AGENTPLAN_TTS_API_KEY,
    resource: mutableEnv.AGENTPLAN_TTS_RESOURCE_ID,
    speaker: mutableEnv.AGENTPLAN_TTS_SPEAKER,
    adapter: mutableEnv.FILE_STORAGE_ADAPTER,
  };
  const mock = await startDoubaoTtsRouteMock();
  try {
    mutableEnv.AGENTPLAN_TTS_ENDPOINT = mock.endpoint;
    mutableEnv.AGENTPLAN_TTS_API_KEY = 'test-route-key';
    mutableEnv.AGENTPLAN_TTS_RESOURCE_ID = 'seed-tts-2.0';
    mutableEnv.AGENTPLAN_TTS_SPEAKER = 'test-speaker';
    mutableEnv.FILE_STORAGE_ADAPTER = 'local';

    const { POST } = await import('../src/app/api/ai/tts/route');
    const missing = await POST({
      json: async () => ({}),
    } as never);
    assert.equal(missing.status, 400);

    const response = await POST({
      json: async () => ({ text: '灵笔工作室讲稿语音生成路由测试。', speaker: 'request-speaker' }),
    } as never);
    assert.equal(response.status, 200);
    const json = await response.json() as {
      audioUri: string;
      audioSize: number;
      provider: string;
      textLength: number;
    };
    assert.equal(json.provider, 'doubao-tts-v3');
    assert.ok(json.audioUri.startsWith('/uploads/'), `expected local upload url, got ${json.audioUri}`);
    assert.ok(json.audioSize > 0);
    assert.ok(json.textLength > 0);

    const localPath = path.join(process.cwd(), 'public', json.audioUri.replace(/^\//, ''));
    assert.ok(existsSync(localPath), `expected audio file to exist: ${localPath}`);
    assert.ok(statSync(localPath).size > 0, 'expected generated audio file to be non-empty');

    const seen = mock.seen();
    assert.equal(seen.headers['x-api-resource-id'], 'seed-tts-2.0');
    assert.equal(seen.headers.authorization, 'Bearer test-route-key');
    const payload = JSON.parse(seen.body);
    assert.equal(payload.req_params.speaker, 'request-speaker');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        '/api/ai/tts rejects missing text',
        '/api/ai/tts uses Doubao AgentPlan TTS request headers',
        '/api/ai/tts writes returned audio into local uploads',
        '/api/ai/tts returns doubao-tts-v3 provider metadata',
      ],
      audioUri: json.audioUri,
      localPath,
      bytes: statSync(localPath).size,
    }, null, 2));
  } finally {
    await mock.close();
    if (originals.endpoint === undefined) delete mutableEnv.AGENTPLAN_TTS_ENDPOINT;
    else mutableEnv.AGENTPLAN_TTS_ENDPOINT = originals.endpoint;
    if (originals.key === undefined) delete mutableEnv.AGENTPLAN_TTS_API_KEY;
    else mutableEnv.AGENTPLAN_TTS_API_KEY = originals.key;
    if (originals.resource === undefined) delete mutableEnv.AGENTPLAN_TTS_RESOURCE_ID;
    else mutableEnv.AGENTPLAN_TTS_RESOURCE_ID = originals.resource;
    if (originals.speaker === undefined) delete mutableEnv.AGENTPLAN_TTS_SPEAKER;
    else mutableEnv.AGENTPLAN_TTS_SPEAKER = originals.speaker;
    if (originals.adapter === undefined) delete mutableEnv.FILE_STORAGE_ADAPTER;
    else mutableEnv.FILE_STORAGE_ADAPTER = originals.adapter;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
