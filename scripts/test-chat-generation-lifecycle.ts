import assert from 'node:assert/strict';
import {
  CHAT_HISTORY_LIMIT,
  chatHistoryStorageKey,
  classifyChatFailure,
  createPendingAssistantMessage,
  findRetryTarget,
  parseChatStreamPayload,
  parseStoredChatHistory,
  serializeChatHistory,
} from '../src/lib/chat-generation-lifecycle';
import { copyTextWithFallback } from '../src/lib/clipboard';

const now = '2026-07-13T11:30:00.000Z';

const failedAssistant = {
  id: 'assistant-1',
  role: 'assistant' as const,
  content: '生成超时，请重试。',
  timestamp: now,
  generation: {
    status: 'timeout' as const,
    question: '这篇论文的结论是什么？',
    updatedAt: now,
  },
};

async function main() {
assert.notEqual(
  chatHistoryStorageKey('account-a:notebook-1'),
  chatHistoryStorageKey('account-b:notebook-1'),
  'chat history must stay isolated by account/workspace scope',
);

const pending = createPendingAssistantMessage('assistant-2', '  请总结证据  ', now);
assert.equal(pending.generation?.status, 'pending');
assert.equal(pending.generation?.question, '请总结证据');
assert.equal(pending.content, '');

const history = [
  { id: 'user-1', role: 'user' as const, content: '这篇论文的结论是什么？', timestamp: now },
  failedAssistant,
];
const retry = findRetryTarget(history, 'assistant-1');
assert.deepEqual(retry, {
  assistantMessageId: 'assistant-1',
  question: '这篇论文的结论是什么？',
});
assert.equal(history.length, 2, 'finding a retry target must not append a duplicate user message');

const serialized = serializeChatHistory(history);
assert.deepEqual(parseStoredChatHistory(serialized), history, 'failed generation history must survive reload');
assert.deepEqual(parseStoredChatHistory('{broken json'), [], 'invalid stored history must fail closed');

const oversized = Array.from({ length: CHAT_HISTORY_LIMIT + 3 }, (_, index) => ({
  id: `message-${index}`,
  role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
  content: `content-${index}`,
  timestamp: now,
}));
const bounded = parseStoredChatHistory(JSON.stringify(oversized));
assert.equal(bounded.length, CHAT_HISTORY_LIMIT, 'browser history retention must be bounded');
assert.equal(bounded[0]?.id, 'message-3');

assert.deepEqual(classifyChatFailure({ aborted: true, stoppedByUser: false }), {
  status: 'timeout',
  content: '真实模型生成超过 45 秒，已停止等待。请稍后重试，或把问题缩短为更具体的一问。',
});
assert.deepEqual(classifyChatFailure({ aborted: true, stoppedByUser: true }), {
  status: 'stopped',
  content: '已停止生成。可以换个问法继续提问。',
});
assert.equal(classifyChatFailure({ aborted: false, stoppedByUser: false, errorMessage: 'quota exceeded' }).status, 'failed');

assert.deepEqual(parseChatStreamPayload('[DONE]'), { kind: 'done' });
assert.deepEqual(parseChatStreamPayload(JSON.stringify({ content: '片段' })), {
  kind: 'event',
  event: { content: '片段' },
});
assert.deepEqual(parseChatStreamPayload(JSON.stringify({ error: '上游超时' })), {
  kind: 'error',
  error: '上游超时',
});
assert.deepEqual(parseChatStreamPayload('{invalid'), { kind: 'ignore' });

let fallbackCalls = 0;
const copiedWithFallback = await copyTextWithFallback('最终回答', {
  writeText: async () => { throw new Error('clipboard unavailable'); },
  legacyCopy: () => { fallbackCalls += 1; return true; },
});
assert.equal(copiedWithFallback, true);
assert.equal(fallbackCalls, 1, 'clipboard fallback must run when the modern API is unavailable');
assert.equal(await copyTextWithFallback('', { legacyCopy: () => true }), false, 'empty text is not copyable');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'account/workspace-scoped history key',
    'pending and failed generation state',
    'retry reuses the failed answer without duplicating the question',
    'bounded failure history survives reload',
    'timeout/stop/error classification',
    'SSE error events are not swallowed',
    'clipboard fallback and explicit failure contract',
  ],
}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
