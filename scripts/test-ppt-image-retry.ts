import assert from 'node:assert/strict';
import { generateSlideImage } from '../src/lib/ppt/image-generation';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=';
const originalFetch = globalThis.fetch;
const keys = ['DASHSCOPE_IMAGE_API_BASE', 'DASHSCOPE_API_KEY', 'DASHSCOPE_IMAGE_MODEL', 'SITIAN_API_TOKEN'];
const originalEnv = keys.map(key => process.env[key]);
let calls = 0;
let timestamps: number[] = [];

function provider(status: number, code = 'Throttling.RateQuota', retryAfter?: string): Response {
  return new Response(JSON.stringify(status === 200
    ? { output: { choices: [{ message: { content: [{ image: 'https://assets.example/slide.png' }] } }] } }
    : { code, message: code === 'Throttling.RateQuota' ? 'Requests rate limit exceeded, please try again later.' : code }), {
    status,
    headers: { 'content-type': 'application/json', ...(retryAfter ? { 'retry-after': retryAfter } : {}) },
  });
}

function fixture(statuses: number[], code?: string, retryAfter?: string, abort?: AbortController) {
  calls = 0;
  timestamps = [];
  globalThis.fetch = (async input => {
    if (String(input) === 'https://assets.example/slide.png') {
      return new Response(Buffer.from(PNG, 'base64'), { status: 200 });
    }
    timestamps.push(Date.now());
    const response = provider(statuses[Math.min(calls++, statuses.length - 1)], code, retryAfter);
    if (abort) setTimeout(() => abort.abort(), 50);
    return response;
  }) as typeof fetch;
}

async function main() {
  process.env.DASHSCOPE_IMAGE_API_BASE = 'https://dashscope.example/api/v1';
  process.env.DASHSCOPE_API_KEY = 'fixture-key';
  process.env.DASHSCOPE_IMAGE_MODEL = 'qwen-image-2.0';
  delete process.env.SITIAN_API_TOKEN;
  const checked = [];
  try {
    fixture([429, 200], 'Throttling.RateQuota', '3');
    assert.equal(await generateSlideImage('retry fixture'), PNG);
    assert.equal(calls, 2);
    assert(timestamps[1] - timestamps[0] >= 2900);
    checked.push('429 recovers on the same slide and respects Retry-After');

    fixture([429]);
    await assert.rejects(generateSlideImage('persistent limit fixture'), /HTTP 429/);
    assert.equal(calls, 3);
    assert(timestamps[2] - timestamps[1] >= 7900);
    checked.push('persistent 429 stops after two retries with increasing delay');

    fixture([401], 'InvalidApiKey');
    await assert.rejects(generateSlideImage('auth failure fixture'), /HTTP 401/);
    assert.equal(calls, 1);
    fixture([429], 'BudgetLimitExceeded');
    await assert.rejects(generateSlideImage('budget failure fixture'), /HTTP 429/);
    assert.equal(calls, 1);
    checked.push('authentication and exhausted budget are not retried');

    fixture([429], 'Throttling.RateQuota', '120');
    await assert.rejects(generateSlideImage('long cooldown fixture'), /HTTP 429/);
    assert.equal(calls, 1);
    checked.push('long provider cooldown is respected without unbounded waiting');

    const abort = new AbortController();
    fixture([429], 'Throttling.RateQuota', undefined, abort);
    await assert.rejects(generateSlideImage('cancellation fixture', { signal: abort.signal }), error => error instanceof Error && error.name === 'AbortError');
    assert.equal(calls, 1);
    checked.push('cancellation interrupts retry waiting');

    fixture([200]);
    assert.equal(await generateSlideImage('success fixture'), PNG);
    assert.equal(calls, 1);
    checked.push('normal image success makes one provider call');
    console.log(JSON.stringify({ ok: true, checked }));
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (originalEnv[index] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[index];
    });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
