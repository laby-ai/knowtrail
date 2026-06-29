import assert from 'node:assert/strict';
import {
  parseRuntimeAIConfigJson,
  redactRuntimeAISecrets,
  resolveOpenAIChatEndpoint,
  resolveOpenAIEmbeddingsEndpoint,
  resolveServerRuntimeAIConfig,
  serverRuntimeAIConfigFromEnv,
  sanitizeRuntimeAIConfig,
} from '../src/lib/runtime-ai-config';
import { resolveInternalAppOrigin } from '../src/lib/internal-origin';

const originalNodeEnv = process.env.NODE_ENV;
const originalAllowInsecure = process.env.ALLOW_INSECURE_API_BASE;
const originalAllowPrivate = process.env.ALLOW_PRIVATE_API_BASE;
const originalAllowUserRuntimeAIConfig = process.env.ALLOW_USER_RUNTIME_AI_CONFIG;
const originalInternalOrigin = process.env.INTERNAL_APP_ORIGIN;
const originalDeployRunPort = process.env.DEPLOY_RUN_PORT;
const originalPort = process.env.PORT;
const originalOpenAICompatApiBase = process.env.OPENAI_COMPAT_API_BASE;
const originalOpenAICompatApiKey = process.env.OPENAI_COMPAT_API_KEY;
const originalOpenAICompatModel = process.env.OPENAI_COMPAT_MODEL;
const originalOpenAICompatVisionModel = process.env.OPENAI_COMPAT_VISION_MODEL;
const originalOpenAICompatEmbeddingModel = process.env.OPENAI_COMPAT_EMBEDDING_MODEL;
const originalArkApiBase = process.env.ARK_API_BASE;
const originalArkApiKey = process.env.ARK_API_KEY;
const originalArkModel = process.env.ARK_MODEL;
const originalArkVisionModel = process.env.ARK_VISION_MODEL;
const originalArkEmbeddingModel = process.env.ARK_EMBEDDING_MODEL;
const originalTtsSpeaker = process.env.AGENTPLAN_TTS_SPEAKER;
const originalArkTtsSpeaker = process.env.ARK_TTS_SPEAKER;
const mutableEnv = process.env as Record<string, string | undefined>;

function setProductionEnv() {
  mutableEnv.NODE_ENV = 'production';
  delete mutableEnv.ALLOW_INSECURE_API_BASE;
  delete mutableEnv.ALLOW_PRIVATE_API_BASE;
}

function restoreEnv() {
  if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = originalNodeEnv;

  if (originalAllowInsecure === undefined) delete mutableEnv.ALLOW_INSECURE_API_BASE;
  else mutableEnv.ALLOW_INSECURE_API_BASE = originalAllowInsecure;

  if (originalAllowPrivate === undefined) delete mutableEnv.ALLOW_PRIVATE_API_BASE;
  else mutableEnv.ALLOW_PRIVATE_API_BASE = originalAllowPrivate;

  if (originalAllowUserRuntimeAIConfig === undefined) delete mutableEnv.ALLOW_USER_RUNTIME_AI_CONFIG;
  else mutableEnv.ALLOW_USER_RUNTIME_AI_CONFIG = originalAllowUserRuntimeAIConfig;

  if (originalInternalOrigin === undefined) delete mutableEnv.INTERNAL_APP_ORIGIN;
  else mutableEnv.INTERNAL_APP_ORIGIN = originalInternalOrigin;

  if (originalDeployRunPort === undefined) delete mutableEnv.DEPLOY_RUN_PORT;
  else mutableEnv.DEPLOY_RUN_PORT = originalDeployRunPort;

  if (originalPort === undefined) delete mutableEnv.PORT;
  else mutableEnv.PORT = originalPort;

  if (originalOpenAICompatApiBase === undefined) delete mutableEnv.OPENAI_COMPAT_API_BASE;
  else mutableEnv.OPENAI_COMPAT_API_BASE = originalOpenAICompatApiBase;
  if (originalOpenAICompatApiKey === undefined) delete mutableEnv.OPENAI_COMPAT_API_KEY;
  else mutableEnv.OPENAI_COMPAT_API_KEY = originalOpenAICompatApiKey;
  if (originalOpenAICompatModel === undefined) delete mutableEnv.OPENAI_COMPAT_MODEL;
  else mutableEnv.OPENAI_COMPAT_MODEL = originalOpenAICompatModel;
  if (originalOpenAICompatVisionModel === undefined) delete mutableEnv.OPENAI_COMPAT_VISION_MODEL;
  else mutableEnv.OPENAI_COMPAT_VISION_MODEL = originalOpenAICompatVisionModel;
  if (originalOpenAICompatEmbeddingModel === undefined) delete mutableEnv.OPENAI_COMPAT_EMBEDDING_MODEL;
  else mutableEnv.OPENAI_COMPAT_EMBEDDING_MODEL = originalOpenAICompatEmbeddingModel;
  if (originalArkApiBase === undefined) delete mutableEnv.ARK_API_BASE;
  else mutableEnv.ARK_API_BASE = originalArkApiBase;
  if (originalArkApiKey === undefined) delete mutableEnv.ARK_API_KEY;
  else mutableEnv.ARK_API_KEY = originalArkApiKey;
  if (originalArkModel === undefined) delete mutableEnv.ARK_MODEL;
  else mutableEnv.ARK_MODEL = originalArkModel;
  if (originalArkVisionModel === undefined) delete mutableEnv.ARK_VISION_MODEL;
  else mutableEnv.ARK_VISION_MODEL = originalArkVisionModel;
  if (originalArkEmbeddingModel === undefined) delete mutableEnv.ARK_EMBEDDING_MODEL;
  else mutableEnv.ARK_EMBEDDING_MODEL = originalArkEmbeddingModel;
  if (originalTtsSpeaker === undefined) delete mutableEnv.AGENTPLAN_TTS_SPEAKER;
  else mutableEnv.AGENTPLAN_TTS_SPEAKER = originalTtsSpeaker;
  if (originalArkTtsSpeaker === undefined) delete mutableEnv.ARK_TTS_SPEAKER;
  else mutableEnv.ARK_TTS_SPEAKER = originalArkTtsSpeaker;
}

try {
  assert.deepEqual(
    sanitizeRuntimeAIConfig({ apiBase: ' https://api.example.com ', apiKey: 'sk-test', model: 123, visionModel: 'vision', embeddingModel: 'embed', ttsSpeaker: 'voice-a' }),
    { apiBase: ' https://api.example.com ', apiKey: 'sk-test', model: '', visionModel: 'vision', embeddingModel: 'embed', ttsSpeaker: 'voice-a' },
  );
  assert.equal(parseRuntimeAIConfigJson('{bad json'), undefined);
  assert.deepEqual(
    parseRuntimeAIConfigJson('{"apiBase":"https://api.openai.com/v1","apiKey":"sk-test","model":"gpt"}'),
    { apiBase: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt', visionModel: '', embeddingModel: '', ttsSpeaker: '' },
  );
  assert.deepEqual(
    parseRuntimeAIConfigJson('{"apiBase":"https://api.openai.com/v1","apiKey":"sk-test","embeddingModel":"text-embedding-3-small","ttsSpeaker":"voice-b"}'),
    { apiBase: 'https://api.openai.com/v1', apiKey: 'sk-test', model: '', visionModel: '', embeddingModel: 'text-embedding-3-small', ttsSpeaker: 'voice-b' },
  );

  delete mutableEnv.OPENAI_COMPAT_API_BASE;
  mutableEnv.OPENAI_COMPAT_API_KEY = 'sk-stale-openai-compatible-key';
  delete mutableEnv.OPENAI_COMPAT_MODEL;
  delete mutableEnv.OPENAI_COMPAT_VISION_MODEL;
  delete mutableEnv.OPENAI_COMPAT_EMBEDDING_MODEL;
  mutableEnv.ARK_API_BASE = 'https://ark.example.com/api/plan/v3';
  mutableEnv.ARK_API_KEY = 'ark-env-test-key';
  mutableEnv.ARK_MODEL = 'doubao-text';
  mutableEnv.ARK_VISION_MODEL = 'doubao-vision';
  mutableEnv.ARK_EMBEDDING_MODEL = 'doubao-embedding';
  mutableEnv.ARK_TTS_SPEAKER = 'voice-env';
  assert.deepEqual(serverRuntimeAIConfigFromEnv(), {
    apiBase: 'https://ark.example.com/api/plan/v3',
    apiKey: 'ark-env-test-key',
    model: 'doubao-text',
    visionModel: 'doubao-vision',
    embeddingModel: 'doubao-embedding',
    ttsSpeaker: 'voice-env',
  });
  mutableEnv.OPENAI_COMPAT_API_BASE = 'https://openai-compatible.example.com/v1';
  mutableEnv.OPENAI_COMPAT_API_KEY = 'sk-openai-compatible-key';
  mutableEnv.OPENAI_COMPAT_MODEL = 'openai-compatible-text';
  assert.deepEqual(serverRuntimeAIConfigFromEnv(), {
    apiBase: 'https://openai-compatible.example.com/v1',
    apiKey: 'sk-openai-compatible-key',
    model: 'openai-compatible-text',
    visionModel: 'doubao-vision',
    embeddingModel: 'doubao-embedding',
    ttsSpeaker: 'voice-env',
  });
  delete mutableEnv.OPENAI_COMPAT_API_BASE;
  mutableEnv.OPENAI_COMPAT_API_KEY = 'sk-stale-openai-compatible-key';
  assert.deepEqual(
    resolveServerRuntimeAIConfig({ apiBase: '', apiKey: '', model: '', visionModel: '', embeddingModel: '', ttsSpeaker: '' }),
    serverRuntimeAIConfigFromEnv(),
  );
  delete mutableEnv.ALLOW_USER_RUNTIME_AI_CONFIG;
  assert.deepEqual(
    resolveServerRuntimeAIConfig({ apiBase: 'https://user.example.com/v1', apiKey: 'sk-user', model: 'user-model' }),
    serverRuntimeAIConfigFromEnv(),
  );
  mutableEnv.ALLOW_USER_RUNTIME_AI_CONFIG = 'true';
  assert.deepEqual(
    resolveServerRuntimeAIConfig({ apiBase: 'https://user.example.com/v1', apiKey: 'sk-user', model: 'user-model' }),
    { apiBase: 'https://user.example.com/v1', apiKey: 'sk-user', model: 'user-model' },
  );

  setProductionEnv();
  assert.equal(
    resolveOpenAIChatEndpoint({ apiBase: 'https://api.openai.com/v1', apiKey: 'sk-test', model: '', visionModel: '', embeddingModel: '' }),
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(
    resolveOpenAIEmbeddingsEndpoint({ apiBase: 'https://api.openai.com/v1', apiKey: 'sk-test', model: '', visionModel: '', embeddingModel: '' }),
    'https://api.openai.com/v1/embeddings',
  );
  assert.equal(
    resolveOpenAIChatEndpoint({ apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3', apiKey: 'ark-test', model: '', visionModel: '', embeddingModel: '' }),
    'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions',
  );
  assert.equal(
    resolveOpenAIEmbeddingsEndpoint({ apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3', apiKey: 'ark-test', model: '', visionModel: '', embeddingModel: '' }),
    'https://ark.cn-beijing.volces.com/api/plan/v3/embeddings',
  );
  assert.equal(
    resolveOpenAIChatEndpoint({ apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions', apiKey: 'ark-test', model: '', visionModel: '', embeddingModel: '' }),
    'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions',
  );
  assert.equal(
    resolveOpenAIEmbeddingsEndpoint({ apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3/embeddings', apiKey: 'ark-test', model: '', visionModel: '', embeddingModel: '' }),
    'https://ark.cn-beijing.volces.com/api/plan/v3/embeddings',
  );
  assert.equal(
    resolveOpenAIEmbeddingsEndpoint({
      apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'ark-test',
      model: '',
      visionModel: '',
      embeddingModel: 'doubao-embedding-vision-251215',
    }),
    'https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal',
  );
  assert.throws(
    () => resolveOpenAIChatEndpoint({ apiBase: 'ftp://example.com/v1', apiKey: 'sk-test', model: '', visionModel: '', embeddingModel: '' }),
    /仅支持 http 或 https/,
  );
  assert.throws(
    () => resolveOpenAIEmbeddingsEndpoint({ apiBase: 'http://api.example.com/v1', apiKey: 'sk-test', model: '', visionModel: '', embeddingModel: '' }),
    /默认只允许 HTTPS/,
  );
  assert.throws(
    () => resolveOpenAIChatEndpoint({ apiBase: 'https://127.0.0.1:8787/v1', apiKey: 'sk-test', model: '', visionModel: '', embeddingModel: '' }),
    /localhost 或私有网段/,
  );

  mutableEnv.ALLOW_INSECURE_API_BASE = 'true';
  mutableEnv.ALLOW_PRIVATE_API_BASE = 'true';
  assert.equal(
    resolveOpenAIEmbeddingsEndpoint({ apiBase: 'http://127.0.0.1:8787/v1', apiKey: 'sk-test', model: '', visionModel: '', embeddingModel: '' }),
    'http://127.0.0.1:8787/v1/embeddings',
  );
  assert.equal(
    resolveOpenAIChatEndpoint({ apiBase: 'http://127.0.0.1:8787/v1', apiKey: 'sk-test', model: '', visionModel: '', embeddingModel: '' }),
    'http://127.0.0.1:8787/v1/chat/completions',
  );

  const leakedKey = 'sk-secret-123';
  const redacted = redactRuntimeAISecrets(`{"authorization":"Bearer ${leakedKey}","apiKey":"${leakedKey}"}`, leakedKey);
  assert(!redacted.includes(leakedKey), 'redacted text should not contain the submitted API key');
  assert(redacted.includes('[REDACTED]'), 'redacted text should include a redaction marker');

  delete mutableEnv.INTERNAL_APP_ORIGIN;
  mutableEnv.DEPLOY_RUN_PORT = '5100';
  delete mutableEnv.PORT;
  assert.equal(resolveInternalAppOrigin(), 'http://localhost:5100');
  mutableEnv.INTERNAL_APP_ORIGIN = 'https://lingbi.example.com/app';
  assert.equal(resolveInternalAppOrigin(), 'https://lingbi.example.com');
  mutableEnv.INTERNAL_APP_ORIGIN = 'ftp://lingbi.example.com';
  assert.throws(() => resolveInternalAppOrigin(), /http or https/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'sanitizeRuntimeAIConfig',
      'parseRuntimeAIConfigJson',
      'server-side runtime env fallback',
      'production endpoint allowlist',
      'versioned OpenAI-compatible base paths',
      'OpenAI-compatible embeddings endpoint resolution',
      'private-network guard',
      'secret redaction',
      'internal app origin resolution',
    ],
  }, null, 2));
} finally {
  restoreEnv();
}
