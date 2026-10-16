import assert from 'node:assert/strict';
import { isResearchToolCall, isResearchPlugin, isResearchPresentationPlan } from '../src/lib/research-agent-contract';
import { isChatHistoryDocument } from '../src/lib/chat-history-document';
import { parseStoredChatHistory, serializeChatHistory } from '../src/lib/chat-generation-lifecycle';
import type { ChatMessage } from '../src/types';

const call = { id: 'tool-1', plugin: 'paper-search', query: 'transit', status: 'ready', results: [{ title: 'A real candidate', link: 'https://arxiv.org/abs/0000.00001', snippet: 'A metadata-only fixture.' }] };
assert.ok(isResearchToolCall(call));
for (const bad of [{ ...call, plugin: '__proto__' }, { ...call, status: 'success' }, { ...call, results: [{ title: 'x', link: 'javascript:alert(1)', snippet: 'x' }] }]) assert.equal(isResearchToolCall(bad), false);
assert.equal(isResearchPlugin('run-shell'), false);
const plan = { sourceIds: ['source-1'], outlineDraft: [{ id: 'slide-1', title: '模拟记录', focus: '12条剔除2条后保留10条，仅用于验收[1]。', sourceLabel: '本轮已选资料' }] };
assert.ok(isResearchPresentationPlan(plan));
const prepared = { id: 'ppt-plan', plugin: 'presentation', query: '准备可编辑PPT', status: 'ready', presentation: plan };
assert.ok(isResearchToolCall(prepared));
const generated = { ...prepared, presentation: { ...plan, artifact: { id: 'a'.repeat(64), fileName: 'verified.pptx', slideCount: 1 } } };
assert.ok(isResearchToolCall(generated));
for (const bad of [
  { ...plan, sourceIds: [] }, { ...plan, sourceIds: ['../another-account'] },
  { ...plan, outlineDraft: [] }, { ...plan, outlineDraft: [{ ...plan.outlineDraft[0], title: 'x'.repeat(81) }] },
  { ...plan, artifact: { id: 'https://example.org/other.pptx', fileName: 'x.pptx', slideCount: 1 } },
  { ...plan, artifact: { id: 'a'.repeat(64), fileName: 'x.pptx', slideCount: 2 } },
]) assert.equal(isResearchPresentationPlan(bad), false);
assert.equal(isResearchToolCall({ ...prepared, plugin: 'paper-search' }), false);
const messages: ChatMessage[] = [{ id: 'message-1', role: 'assistant', content: '已找到候选。', timestamp: '2026-10-17T00:00:00Z', toolCalls: [call, prepared, generated] } as ChatMessage];
assert.deepEqual(parseStoredChatHistory(serializeChatHistory(messages)), messages);
assert.ok(isChatHistoryDocument({ messages, draft: '请比较第二篇的方法', mode: 'paper-search' }));
assert.equal(isChatHistoryDocument({ messages: [{ ...messages[0], toolCalls: [{ ...call, plugin: 'run-shell' }] }], draft: '', mode: null }), false);
console.log('Search, confirmed PPT outlines and immutable artifact references survive private history; unsafe plugins, source paths and file links are rejected.');
