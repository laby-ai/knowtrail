import assert from 'node:assert/strict';
import { generateSlideImage } from '../src/lib/ppt/image-generation';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=';
const originalFetch = globalThis.fetch;
const originalEnv = {
  apiBase: process.env.DASHSCOPE_IMAGE_API_BASE,
  apiKey: process.env.DASHSCOPE_API_KEY,
  model: process.env.DASHSCOPE_IMAGE_MODEL,
  sitianToken: process.env.SITIAN_API_TOKEN,
};

let providerRequest: { url: string; body: Record<string, unknown> } | null = null;

async function main() {
  process.env.DASHSCOPE_IMAGE_API_BASE = 'https://dashscope.example/api/v1';
  process.env.DASHSCOPE_API_KEY = 'fixture-bailian-key';
  process.env.DASHSCOPE_IMAGE_MODEL = 'qwen-image-2.0';
  delete process.env.SITIAN_API_TOKEN;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!providerRequest) {
      providerRequest = {
        url,
        body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
      };
      return new Response(JSON.stringify({
        output: {
          choices: [{ message: { content: [{ image: 'https://assets.example/generated.png' }] } }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    assert.equal(url, 'https://assets.example/generated.png');
    return new Response(Buffer.from(ONE_PIXEL_PNG, 'base64'), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  }) as typeof fetch;

  try {
    const result = await generateSlideImage('生成科研流程图', {
      aspectRatio: '16:9',
      negativePrompt: '不要水印',
    });
    assert.equal(result, ONE_PIXEL_PNG);
    assert.equal(
      providerRequest?.url,
      'https://dashscope.example/api/v1/services/aigc/multimodal-generation/generation',
    );
    assert.equal(providerRequest?.body.model, 'qwen-image-2.0');
    assert.equal((providerRequest?.body.parameters as Record<string, unknown>)?.size, '2688*1536');
    assert.deepEqual(
      ((providerRequest?.body.input as Record<string, unknown>)?.messages as Array<Record<string, unknown>>)?.[0]?.content,
      [{ text: '生成科研流程图' }],
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      DASHSCOPE_IMAGE_API_BASE: originalEnv.apiBase,
      DASHSCOPE_API_KEY: originalEnv.apiKey,
      DASHSCOPE_IMAGE_MODEL: originalEnv.model,
      SITIAN_API_TOKEN: originalEnv.sitianToken,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'qwen-image-2.0 uses the official synchronous multimodal endpoint',
      'the temporary provider URL is downloaded into durable base64 output',
      'the requested aspect ratio maps to the documented qwen-image-2.0 size',
    ],
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
