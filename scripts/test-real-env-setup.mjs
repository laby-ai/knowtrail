import assert from 'node:assert/strict';
import { applyClipboardModelSecrets, serializePrivateEnv } from './lib/real-env-setup.mjs';

const values = new Map();
const fakeBailianKey = ['sk', 'testonly0123456789abcdef'].join('-');
const fakeSitianToken = [
  'eyJ0ZXN0IjoidHJ1ZSJ9',
  'eyJzdWIiOiJmaXh0dXJlIn0',
  'fixture-signature',
].join('.');
const input = [
  `Use this Bailian key: ${fakeBailianKey}`,
  `Use this image token: ${fakeSitianToken}`,
].join('\n');

const result = applyClipboardModelSecrets(values, input);
assert.equal(result.bailianConfigured, true);
assert.equal(result.sitianConfigured, true);
assert.equal(values.get('OPENAI_COMPAT_API_BASE'), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
assert.equal(values.get('OPENAI_COMPAT_MODEL'), 'qwen3.7-plus');
assert.equal(values.get('SITIAN_API_BASE'), 'https://images.sitianai.com');
assert.equal(values.get('SITIAN_IMAGE_PROVIDER_REQUIRED'), 'true');

const serialized = serializePrivateEnv(values);
assert(serialized.includes(`OPENAI_COMPAT_API_KEY=${fakeBailianKey}`));
assert(serialized.includes(`SITIAN_API_TOKEN=${fakeSitianToken}`));
assert(!JSON.stringify(result).includes(fakeBailianKey));
assert(!JSON.stringify(result).includes(fakeSitianToken));

console.log(JSON.stringify({
  ok: true,
  checked: [
    'clipboard Bailian keys map to the OpenAI-compatible DashScope runtime',
    'clipboard image tokens map to the Sitian image provider',
    'operator summaries never contain secret values',
  ],
}, null, 2));
