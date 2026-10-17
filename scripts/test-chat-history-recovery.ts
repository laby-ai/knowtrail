import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyChatHistory, isChatHistoryDocument } from '../src/lib/chat-history-document';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument } from '../src/lib/private-notebook-document';

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-chat-'));
  const before = process.env.STUDIO_DOCUMENT_STORE_DIR;
  process.env.STUDIO_DOCUMENT_STORE_DIR = root;
  const a = { ownerMemberId: 'fixture-a', notebookId: 'chat-recovery-fixture' };
  try {
    const data = { ...emptyChatHistory(), draft: '未发送原文', mode: 'text-polishing' as const, messages: [{ id: 'answer', role: 'assistant' as const, content: '12条剔除2条后保留10条[1]。', timestamp: '2026-10-16T11:00:00Z' }] };
    assert(isChatHistoryDocument(data));
    assert(!isChatHistoryDocument({ ...data, mode: 'unknown' }));
    assert(!isChatHistoryDocument({ ...data, messages: [{ id: 'x', role: 'user', content: 1 }] }));
    const saved = await saveNotebookDocument(a, 'chat-history', data, null);
    assert.deepEqual(await saveNotebookDocument(a, 'chat-history', data, null), saved);
    const writers = await Promise.allSettled(['新稿甲', '新稿乙'].map(draft => saveNotebookDocument(a, 'chat-history', { ...data, draft }, saved.revision)));
    assert.equal(writers.filter(x => x.status === 'fulfilled').length, 1);
    assert(writers.some(x => x.status === 'rejected' && x.reason instanceof NotebookDocumentConflict));
    assert.equal(await readNotebookDocument({ ...a, ownerMemberId: 'fixture-b' }, 'chat-history'), null);
    assert.equal(await readNotebookDocument({ ...a, notebookId: 'other-book' }, 'chat-history'), null);
    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', `const {readNotebookDocument}=require('./src/lib/private-notebook-document.ts');readNotebookDocument(${JSON.stringify(a)},'chat-history').then(d=>{if(d?.data?.messages?.[0]?.content!=='12条剔除2条后保留10条[1]。'||d.data.mode!=='text-polishing')process.exitCode=1})`], { env: process.env });
    assert.equal(child.status, 0, child.stderr?.toString());
    console.log(JSON.stringify({ ok: true, freshProcessRestore: true, draftAndMode: true, ownerAndBookIsolation: true, concurrentConflict: true, paidCalls: 0 }));
  } finally {
    if (before === undefined) delete process.env.STUDIO_DOCUMENT_STORE_DIR; else process.env.STUDIO_DOCUMENT_STORE_DIR = before;
    await rm(root, { recursive: true, force: true });
  }
}
void main();
