import assert from 'node:assert/strict';
import {
  buildReferenceImageInput,
  parseSlideReferenceImage,
  publicSlideRevisionError,
} from '../src/lib/ppt/slide-image-contract';
import { generateSlideImage } from '../src/lib/ppt/image-generation';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=';

async function main() {
const parsed = parseSlideReferenceImage(ONE_PIXEL_PNG);
assert.equal(parsed.mimeType, 'image/png');
assert.equal(parsed.base64, ONE_PIXEL_PNG);
assert.equal(parsed.dataUrl, `data:image/png;base64,${ONE_PIXEL_PNG}`);

assert.deepEqual(
  buildReferenceImageInput(parsed, 'https://ark.example/api/v3/images/generations', 'doubao-seedream-4-0'),
  [parsed.dataUrl],
  'Ark/Seedream image editing must use the documented string[] image contract.',
);
assert.equal(
  buildReferenceImageInput(parsed, 'https://openai.example/v1/images/generations', 'gpt-image-1'),
  parsed.dataUrl,
  'Other OpenAI-compatible providers still receive an explicit data URL, never naked base64.',
);

assert.throws(() => parseSlideReferenceImage('not-an-image'), /图片格式/);
assert.throws(() => parseSlideReferenceImage('data:text/plain;base64,SGVsbG8='), /图片格式/);

const invalidUrl = publicSlideRevisionError(new Error(
  '图片模型 API 失败:HTTP 400 - {"error":{"code":"InvalidParameter","message":"invalid url specified. Request id: secret-request-id"}}',
));
assert.deepEqual(invalidUrl, {
  status: 422,
  code: 'reference_image_invalid',
  message: '参考图片无法被图片模型读取，请重新打开该页后重试。',
  retryable: true,
});
assert.doesNotMatch(JSON.stringify(invalidUrl), /request id|secret-request-id|invalid url|https?:\/\//i);

const rateLimited = publicSlideRevisionError(new Error('图片模型 API 失败:HTTP 429 - upstream detail'));
assert.equal(rateLimited.status, 429);
assert.equal(rateLimited.code, 'image_provider_busy');
assert.equal(rateLimited.retryable, true);
assert.doesNotMatch(rateLimited.message, /upstream|HTTP|429/i);

const unknown = publicSlideRevisionError(new Error('private provider response'));
assert.equal(unknown.status, 502);
assert.equal(unknown.code, 'image_provider_failed');
assert.doesNotMatch(unknown.message, /private provider response/i);

const originalFetch = globalThis.fetch;
const originalAllowRuntime = process.env.ALLOW_USER_RUNTIME_AI_CONFIG;
let capturedBody: Record<string, unknown> | null = null;
process.env.ALLOW_USER_RUNTIME_AI_CONFIG = 'true';
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  capturedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  return new Response(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;
try {
  const generated = await generateSlideImage('fixture only', {
    referenceImageBase64: ONE_PIXEL_PNG,
    runtimeConfig: {
      apiBase: 'https://ark.example/api/v3',
      apiKey: ['fixture', 'key'].join('-'),
      visionModel: 'doubao-seedream-4-0',
    },
  });
  assert.equal(generated, ONE_PIXEL_PNG);
  assert.deepEqual((capturedBody as Record<string, unknown> | null)?.image, [parsed.dataUrl]);
} finally {
  globalThis.fetch = originalFetch;
  if (originalAllowRuntime === undefined) delete process.env.ALLOW_USER_RUNTIME_AI_CONFIG;
  else process.env.ALLOW_USER_RUNTIME_AI_CONFIG = originalAllowRuntime;
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    'reference image bytes are validated before provider requests',
    'Ark and Seedream receive a string-array data URL contract',
    'other compatible providers never receive naked base64',
    'provider request ids and raw responses never reach the user',
    'safe failures remain explicitly retryable',
  ],
}, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
