import assert from 'node:assert/strict';
import { isResearchToolCall, isResearchPlugin } from '../src/lib/research-agent-contract';
import { isChatHistoryDocument } from '../src/lib/chat-history-document';
import { parseStoredChatHistory, serializeChatHistory } from '../src/lib/chat-generation-lifecycle';
import type { ChatMessage } from '../src/types';

const call = { id: 'tool-1', plugin: 'paper-search', query: 'transit', status: 'ready', results: [{ title: 'A real candidate', link: 'https://arxiv.org/abs/0000.00001', snippet: 'A metadata-only fixture.' }] };
assert.ok(isResearchToolCall(call));
for (const bad of [{ ...call, plugin: '__proto__' }, { ...call, status: 'success' }, { ...call, results: [{ title: 'x', link: 'javascript:alert(1)', snippet: 'x' }] }]) assert.equal(isResearchToolCall(bad), false);
assert.equal(isResearchPlugin('run-shell'), false);
const messages: ChatMessage[] = [{ id: 'message-1', role: 'assistant', content: '已找到候选。', timestamp: '2026-10-17T00:00:00Z', toolCalls: [call] } as ChatMessage];
assert.deepEqual(parseStoredChatHistory(serializeChatHistory(messages)), messages);
assert.ok(isChatHistoryDocument({ messages, draft: '请比较第二篇的方法', mode: 'paper-search' }));
assert.equal(isChatHistoryDocument({ messages: [{ ...messages[0], toolCalls: [{ ...call, plugin: 'run-shell' }] }], draft: '', mode: null }), false);
console.log('Research tool calls survive private history validation and reject unknown plugins or unsafe links.');
