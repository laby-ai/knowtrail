import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyChatHistory, isChatHistoryDocument, restoreChatDraft, type ChatHistoryDocument } from '../src/lib/chat-history-document';
import { createPendingAssistantMessage, generationUpdate } from '../src/lib/chat-generation-lifecycle';
import { NotebookDocumentConflict, notebookDocumentDirectory, readNotebookDocument, saveNotebookDocument } from '../src/lib/private-notebook-document';

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-chat-'));
  const before = process.env.STUDIO_DOCUMENT_STORE_DIR;
  process.env.STUDIO_DOCUMENT_STORE_DIR = root;
  const a = { ownerMemberId: 'fixture-a', notebookId: 'chat-recovery-fixture' };
  try {
    const data: ChatHistoryDocument = { ...emptyChatHistory(), draft: '未发送原文', mode: 'text-polishing', messages: [{ id: 'answer', role: 'assistant', content: '12条剔除2条后保留10条[1]。', timestamp: '2026-10-16T11:00:00Z' }] };
    assert(isChatHistoryDocument(data));
    assert(!isChatHistoryDocument({ ...data, mode: 'unknown' }));
    assert(!isChatHistoryDocument({ ...data, messages: [{ id: 'x', role: 'user', content: 1 }] }));
    const saved = await saveNotebookDocument(a, 'chat-history', data, null);
    assert.deepEqual(await saveNotebookDocument(a, 'chat-history', data, null), saved);
    const writers = await Promise.allSettled(['新稿甲', '新稿乙'].map(draft => saveNotebookDocument(a, 'chat-history', { ...data, draft }, saved.revision)));
    assert.equal(writers.filter(x => x.status === 'fulfilled').length, 1);
    assert(writers.some(x => x.status === 'rejected' && x.reason instanceof NotebookDocumentConflict));
    let latest = (await readNotebookDocument<typeof data>(a, 'chat-history'))!;
    const versions = async () => (await readdir(notebookDocumentDirectory(a, 'chat-history'))).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
    for (let edit = 0; edit < 12; edit++) latest = await saveNotebookDocument(a, 'chat-history', { ...latest.data, draft: `未发送草稿 ${edit}`, mode: null }, latest.revision);
    assert.equal((await versions()).length, 1, 'Draft and mode edits only replace the recovery snapshot');
    assert.deepEqual(await readNotebookDocument(a, 'chat-history', latest.revision), latest, 'The current recovery revision remains readable');
    assert.deepEqual(await readNotebookDocument(a, 'chat-history', saved.revision), saved, 'Old immutable history remains readable');
    const pending = createPendingAssistantMessage('stream', '隔离原文问题', '2026-10-23T11:00:00Z');
    for (let chunk = 0; chunk < 12; chunk++) latest = await saveNotebookDocument(a, 'chat-history', { ...latest.data, messages: [...data.messages, { ...pending, content: `流式片段 ${chunk}` }] }, latest.revision);
    assert.equal((await versions()).length, 1, 'Intermediate generation snapshots are recoverable without permanent versions');
    latest = await saveNotebookDocument(a, 'chat-history', { ...latest.data, messages: [...data.messages, { ...pending, content: '完整原文回答', ...generationUpdate('completed', '隔离原文问题', '2026-10-23T11:01:00Z') }] }, latest.revision);
    assert.equal((await versions()).length, 2, 'A completed conversation change creates a permanent version');
    assert.deepEqual(await readNotebookDocument(a, 'chat-history', latest.revision), latest);
    const other = { ...a, notebookId: 'draft-only' };
    const draftOnly = await saveNotebookDocument(other, 'chat-history', { ...emptyChatHistory(), draft: '只有草稿' }, null);
    assert.deepEqual(await readdir(notebookDocumentDirectory(other, 'chat-history')), ['current.json']);
    assert.deepEqual(await readNotebookDocument(other, 'chat-history', draftOnly.revision), draftOnly);
    const incoming = { ...latest.data, messages: [...latest.data.messages, { id: 'newest', role: 'user' as const, content: '另页新增的对话', timestamp: '2026-10-23T12:00:00Z' }] };
    const restored = restoreChatDraft(incoming, { ...data, draft: '保留本页未发送问题' });
    assert.deepEqual(restored.messages, incoming.messages, 'Explicit conflict recovery reads the latest conversation');
    assert.equal(restored.draft, '保留本页未发送问题');
    assert.equal(restored.mode, data.mode);
    const completed = latest;
    latest = await saveNotebookDocument(a, 'chat-history', saved.data, latest.revision);
    assert.deepEqual(await readNotebookDocument(a, 'chat-history', saved.revision), saved, 'Restoring old history must not rewrite its original metadata');
    latest = await saveNotebookDocument(a, 'chat-history', completed.data, latest.revision);
    assert.deepEqual(await readNotebookDocument(a, 'chat-history', completed.revision), completed);
    assert.equal(await readNotebookDocument({ ...a, ownerMemberId: 'fixture-b' }, 'chat-history'), null);
    assert.equal(await readNotebookDocument({ ...a, notebookId: 'other-book' }, 'chat-history'), null);
    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', `const {readNotebookDocument}=require('./src/lib/private-notebook-document.ts');readNotebookDocument(${JSON.stringify(a)},'chat-history').then(d=>{if(d?.data?.messages?.[0]?.content!=='12条剔除2条后保留10条[1]。'||d.data.draft!=='未发送草稿 11')process.exitCode=1})`], { env: process.env });
    assert.equal(child.status, 0, child.stderr?.toString());
    console.log(JSON.stringify({ ok: true, freshProcessRestore: true, draftAndMode: true, ownerAndBookIsolation: true, concurrentConflict: true, paidCalls: 0 }));
  } finally {
    if (before === undefined) delete process.env.STUDIO_DOCUMENT_STORE_DIR; else process.env.STUDIO_DOCUMENT_STORE_DIR = before;
    await rm(root, { recursive: true, force: true });
  }
}
void main();
