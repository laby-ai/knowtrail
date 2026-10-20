import assert from 'node:assert/strict';
import { llmInvoke } from '../src/lib/ai-service';

async function main() {
  process.env.ALLOW_USER_RUNTIME_AI_CONFIG = 'true';
  process.env.ALLOW_INSECURE_API_BASE = 'true';
  process.env.ALLOW_PRIVATE_API_BASE = 'true';
  const original = globalThis.fetch;
  let captured = '';
  globalThis.fetch = async (_input, init) => {
    captured = String(init?.body);
    return new Response('data: {"choices":[{"delta":{"content":"fixture response"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const config = { apiBase: 'http://127.0.0.1:5190/v1', apiKey: 'fixture-only', model: 'fixture-model', outputLanguage: 'en' as const };
    assert.equal(await llmInvoke([{ role: 'user', content: 'Summarize this source.' }], {}, undefined, config), 'fixture response');
    assert.match(captured, /User output-language preference: English/);
    assert.match(captured, /Preserve JSON keys/);
    await llmInvoke([{ role: 'user', content: 'Summarize this source.' }], {}, undefined, { ...config, outputLanguage: 'auto' });
    assert.doesNotMatch(captured, /User output-language preference/);
    console.log('PASS: language preference reaches the actual LLM request; auto leaves prompts unchanged; JSON format protected');
  } finally { globalThis.fetch = original; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
