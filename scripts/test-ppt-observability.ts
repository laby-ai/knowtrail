import assert from 'node:assert/strict';
import { getLlmCallLogs, markFallback, markFallbackRecovered, withLlmCallLogs, type LlmCallLog } from '../src/lib/ppt/academic-observability';
const record = (stage: string): LlmCallLog => ({ stage, model: 'test', temperature: 0, timeoutMs: 1, success: true, timedOut: false, durationMs: 1, jsonParsedOk: true, fallbackTriggered: false, fallbackReason: '', rawPreview: '', errorPreview: '' });
async function main() {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await Promise.all([
    withLlmCallLogs(async () => {
      getLlmCallLogs().push(record('refineSlidePlan'));
      markFallback('refineSlidePlan', 'invalid closing slide');
      await waiting;
      assert.equal(getLlmCallLogs().length, 1, 'another request must not clear or append to this request');
      assert.equal(getLlmCallLogs().filter(log => log.fallbackTriggered && !log.fallbackRecovered).length, 1, 'unrecovered failure must still block');
      markFallbackRecovered('refineSlidePlan');
      assert.equal(getLlmCallLogs().filter(log => log.fallbackTriggered && !log.fallbackRecovered).length, 0, 'validated retry removes only the active quality failure');
      assert.equal(getLlmCallLogs()[0].fallbackTriggered, true, 'retain original failure for diagnostics');
    }),
    withLlmCallLogs(async () => {
      getLlmCallLogs().push(record('other-request'));
      assert.equal(getLlmCallLogs().length, 1);
      assert.equal(getLlmCallLogs()[0].stage, 'other-request');
      release?.();
    }),
  ]);
  assert.equal(getLlmCallLogs().length, 0, 'completed requests must not leak logs');
  console.log('PPT request isolation and recovered retry regression passed');
}
void main();
