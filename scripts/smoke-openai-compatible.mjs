import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';

const mockPort = Number(process.env.MOCK_OPENAI_PORT || 58761);
const mockBase = `http://127.0.0.1:${mockPort}/v1`;
const apiKey = 'smoke-test-key';
const model = 'smoke-model';
const visionModel = 'smoke-vision-model';
const embeddingModel = 'smoke-embedding-model';
const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.OPENAI_COMPAT_SMOKE_TIMEOUT_MS || 30_000);
let appOrigin = '';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function startMockOpenAI() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/v1/embeddings') {
        const authorization = req.headers.authorization || '';
        const body = JSON.parse(await readBody(req));
        requests.push({ authorization, body, kind: 'embeddings' });

        if (authorization !== `Bearer ${apiKey}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `bad authorization header: ${authorization}` }));
          return;
        }

        if (body.model !== embeddingModel || !Array.isArray(body.input)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad embeddings payload' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0, 0] })),
          model: embeddingModel,
        }));
        return;
      }

      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }

      const authorization = req.headers.authorization || '';
      const body = JSON.parse(await readBody(req));
      requests.push({ authorization, body, kind: 'chat' });

      if (authorization !== `Bearer ${apiKey}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `bad authorization header: ${authorization}` }));
        return;
      }

      if (![model, visionModel].includes(body.model) || body.stream !== true || !Array.isArray(body.messages)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad chat completion payload' }));
        return;
      }

      const joinedMessages = body.messages.map(message => String(message.content || '')).join('\n');
      if (body.model === visionModel) {
        const hasImageUrl = body.messages.some(message =>
          Array.isArray(message.content) &&
          message.content.some(part => part?.type === 'image_url' && part?.image_url?.url),
        );
        if (!hasImageUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'vision request missing image_url content' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                title: 'VISION_OK',
                authors: ['Smoke'],
                year: 2026,
                journal: '',
                doi: '',
                keywords: ['vision'],
                abstract: 'VISION_OK',
                content: 'VISION_OK',
              }),
            },
          }],
        }));
        return;
      }

      if (joinedMessages.includes('生成一篇结构化的跨文献总结报告')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'REPORT_OK' } }] }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"choices":[{"delta":{"content":"OK[1]"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'mock error' }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(mockPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({ server, requests });
    });
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local smoke app port.'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Smoke app exited before /api/health completed with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok && body.ok === true) return body;
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for /api/health at ${origin}. Last error: ${lastError}`);
}

function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function resolveSmokeApp() {
  if (process.env.APP_ORIGIN?.trim()) {
    return { appOrigin: process.env.APP_ORIGIN.trim(), child: undefined, managed: false };
  }

  const port = await findFreePort();
  const appOrigin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      ALLOW_USER_RUNTIME_AI_CONFIG: 'true',
      ALLOW_INSECURE_API_BASE: 'true',
      ALLOW_PRIVATE_API_BASE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  try {
    await waitForHealth(appOrigin, child);
    return { appOrigin, child, managed: true, output };
  } catch (error) {
    const recentOutput = output.join('').slice(-4000);
    if (recentOutput) console.error(recentOutput);
    killProcessTree(child);
    throw error;
  }
}

async function postJson(path, payload) {
  const response = await fetch(`${appOrigin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response;
}

async function getJson(path) {
  const response = await fetch(`${appOrigin}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const body = await response.json();
  return { response, body };
}

async function postOversizedUpload(maxBytes) {
  const formData = new FormData();
  const oversized = new Blob([new Uint8Array(maxBytes + 1)], { type: 'text/plain' });
  formData.append('files', oversized, 'oversized-smoke-test.txt');

  const response = await fetch(`${appOrigin}/api/upload`, {
    method: 'POST',
    body: formData,
  });
  const body = await response.json();
  return { response, body };
}

async function readSSEEvents(response) {
  if (!response.body) throw new Error('SSE response has no body');

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let content = '';
  let citations;
  let retrieval;
  let citationAudit;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;
      const parsed = JSON.parse(payload);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.content) content += parsed.content;
      if (parsed.citations) citations = parsed.citations;
      if (parsed.retrieval) retrieval = parsed.retrieval;
      if (parsed.citationAudit) citationAudit = parsed.citationAudit;
    }
  }

  return { content, citations, retrieval, citationAudit };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const { server, requests } = await startMockOpenAI();
  let smokeApp;
  const aiConfig = {
    apiBase: mockBase,
    apiKey,
    model,
    visionModel,
    embeddingModel,
  };

  try {
    smokeApp = await resolveSmokeApp();
    appOrigin = smokeApp.appOrigin;
    const health = await getJson('/api/health');
    assert(health.response.ok, `/api/health failed: ${JSON.stringify(health.body)}`);
    assert(health.body.ok === true, `/api/health returned not ok: ${JSON.stringify(health.body)}`);
    assert(health.body.capabilities?.userProvidedOpenAICompatibleConfig === true, 'health response does not advertise user-provided API config support');
    assert(
      ['ilike', 'fts'].includes(health.body.capabilities?.sourceStore?.readyChunkSearch?.mode),
      'health response does not expose sourceStore.readyChunkSearch.mode',
    );
    assert(Number.isInteger(health.body.limits?.maxUploadBytes), 'health response does not expose maxUploadBytes');

    const oversizedUpload = await postOversizedUpload(health.body.limits.maxUploadBytes);
    assert(oversizedUpload.response.ok, `/api/upload oversized response was not a handled JSON result: ${JSON.stringify(oversizedUpload.body)}`);
    const uploadError = oversizedUpload.body.results?.[0]?.error || '';
    assert(uploadError.includes('文件过大'), `oversized upload was not rejected by size guard: ${JSON.stringify(oversizedUpload.body)}`);

    const testConfigResponse = await postJson('/api/ai/test-config', { aiConfig });
    const testConfigBody = await testConfigResponse.json();
    if (!testConfigResponse.ok && String(testConfigBody.error || '').includes('默认只允许 HTTPS')) {
      throw new Error('/api/ai/test-config rejected the local HTTP mock. Restart the app for local smoke with ALLOW_INSECURE_API_BASE=true and ALLOW_PRIVATE_API_BASE=true, then rerun pnpm smoke:openai-compatible.');
    }
    assert(testConfigResponse.ok, `/api/ai/test-config failed: ${JSON.stringify(testConfigBody)}`);
    assert(testConfigBody.ok === true, `/api/ai/test-config returned not ok: ${JSON.stringify(testConfigBody)}`);
    assert(String(testConfigBody.sample || '').includes('OK'), 'test-config response did not include mock content');
    assert(String(testConfigBody.visionSample || '').includes('VISION_OK'), 'test-config response did not include mock vision content');
    assert(testConfigBody.embeddingDimension === 4, `test-config response did not include mock embedding dimension: ${JSON.stringify(testConfigBody)}`);

    const invalidBaseResponse = await postJson('/api/ai/test-config', {
      aiConfig: { ...aiConfig, apiBase: 'ftp://example.com/v1' },
    });
    const invalidBaseBody = await invalidBaseResponse.json();
    assert(invalidBaseResponse.status === 400, `/api/ai/test-config should reject unsupported protocols with 400: ${JSON.stringify(invalidBaseBody)}`);
    assert(String(invalidBaseBody.error || '').includes('http'), `invalid API Base error should explain allowed protocols: ${JSON.stringify(invalidBaseBody)}`);

    const badKey = 'smoke-secret-should-not-leak';
    const badAuthResponse = await postJson('/api/ai/test-config', {
      aiConfig: { ...aiConfig, apiKey: badKey },
    });
    const badAuthBody = await badAuthResponse.json();
    assert(badAuthResponse.status === 502, `/api/ai/test-config should surface upstream auth failures as 502: ${JSON.stringify(badAuthBody)}`);
    assert(!JSON.stringify(badAuthBody).includes(badKey), `upstream error leaked the submitted API key: ${JSON.stringify(badAuthBody)}`);
    assert(!JSON.stringify(badAuthBody).includes(`Bearer ${badKey}`), `upstream error leaked bearer credentials: ${JSON.stringify(badAuthBody)}`);

    const chatResponse = await postJson('/api/ai/chat', {
      aiConfig,
      message: '请用一句话总结这份资料。',
      maxTokens: 32,
      papers: [{
        id: 'smoke-paper',
        title: 'Smoke Test Paper',
        authors: ['Lingbi'],
        year: 2026,
        shortName: 'Lingbi. 2026',
        abstract: 'A small source used to validate OpenAI-compatible routing.',
        content: 'This paper verifies the chat proxy and SSE stream.',
        rawContent: 'Page 1: The chat route should retrieve grounded chunks before answering. The source citation should include a stable sourceId and chunkId.',
      }],
    });
    assert(chatResponse.ok, `/api/ai/chat failed: ${chatResponse.status}`);
    const chatEvents = await readSSEEvents(chatResponse);
    const chatContent = chatEvents.content;
    assert(chatContent.includes('OK'), 'chat SSE response did not include mock content');
    assert(Array.isArray(chatEvents.citations) && chatEvents.citations.length > 0, 'chat SSE response did not include citations');
    assert(chatEvents.retrieval?.mode === 'request-keyword', `chat SSE response exposed unexpected retrieval mode: ${JSON.stringify(chatEvents.retrieval)}`);
    assert(chatEvents.citationAudit?.status === 'pass', `chat SSE citation audit did not pass: ${JSON.stringify(chatEvents.citationAudit)}`);
    const chatRequest = requests.find(request =>
      request.body?.messages?.some(message => String(message.content || '').includes('sourceId: smoke-paper')),
    );
    assert(chatRequest, 'chat request did not include grounded source/chunk context');
    assert(
      chatRequest.body.messages.some(message => String(message.content || '').includes('chunkId: smoke-paper::chunk-')),
      'chat request did not include stable chunk ids',
    );
    assert(chatRequest.body.max_tokens === 32, `chat request did not preserve low max_tokens smoke guard: ${JSON.stringify(chatRequest.body)}`);

    const reportResponse = await postJson('/api/ai/report', {
      aiConfig,
      outline: '核心论点与证据',
      papers: [{
        title: 'Smoke Test Paper',
        authors: ['Lingbi'],
        year: 2026,
        shortName: 'Lingbi. 2026',
        abstract: 'A small source used to validate OpenAI-compatible report routing.',
        content: 'This paper verifies the report proxy and non-SSE JSON fallback.',
      }],
    });
    assert(reportResponse.ok, `/api/ai/report failed: ${reportResponse.status}`);
    const reportContent = (await readSSEEvents(reportResponse)).content;
    assert(reportContent.includes('REPORT_OK'), 'report SSE wrapper did not include non-stream mock content');

    const analyzeImageResponse = await postJson('/api/ai/analyze', {
      aiConfig,
      fileName: 'vision-smoke.png',
      fileType: 'png',
      imageBase64: 'data:image/png;base64,iVBORw0KGgo=',
    });
    const analyzeImageBody = await analyzeImageResponse.json();
    assert(analyzeImageResponse.ok, `/api/ai/analyze image failed: ${JSON.stringify(analyzeImageBody)}`);
    assert(analyzeImageBody.success === true, `/api/ai/analyze image did not return success: ${JSON.stringify(analyzeImageBody)}`);
    assert(analyzeImageBody.analysis?.title === 'VISION_OK', `/api/ai/analyze image did not use vision response: ${JSON.stringify(analyzeImageBody)}`);
    assert(requests.some(request => request.body?.model === visionModel), 'vision model was not used by image analysis route');

    assert(requests.length >= 4, `expected at least 4 mock OpenAI requests, got ${requests.length}`);
    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      mockBase,
      managedApp: smokeApp.managed,
      checked: ['/api/health', '/api/upload oversized guard', '/api/ai/test-config text/vision/embedding', '/api/ai/test-config invalid base', '/api/ai/test-config redaction', '/api/ai/chat grounded SSE citations/citationAudit/max_tokens', '/api/ai/report non-SSE JSON fallback', '/api/ai/analyze image visionModel routing'],
      mockRequests: requests.length,
    }, null, 2));
  } finally {
    await new Promise(resolve => server.close(resolve));
    killProcessTree(smokeApp?.child);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
