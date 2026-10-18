import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyIllustration, isIllustrationDocument } from '../src/lib/scientific-illustration-document';
import { readScientificIllustration, saveScientificIllustration } from '../src/lib/scientific-illustration-store';
import { readNotebookDocument, saveNotebookDocument } from '../src/lib/private-notebook-document';

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-illustration-'));
  const old = { image: process.env.SCIENTIFIC_ILLUSTRATION_STORE_DIR, docs: process.env.STUDIO_DOCUMENT_STORE_DIR };
  process.env.SCIENTIFIC_ILLUSTRATION_STORE_DIR = root; process.env.STUDIO_DOCUMENT_STORE_DIR = path.join(root, 'documents');
  try {
    const scope = { ownerMemberId: 'fixture-a', notebookId: 'illustration-fixture' };
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const meta = await saveScientificIllustration({ image, ...scope, purpose: '模拟四步核验流程', figureKind: 'workflow', aspectRatio: '16:9', sourceLabels: ['专用模拟资料'] });
    assert.equal((await readScientificIllustration(meta.id, scope.ownerMemberId)).image.toString('base64'), image.toString('base64'));
    await assert.rejects(readScientificIllustration(meta.id, 'fixture-b'), /无权访问/);
    const document = { ...emptyIllustration(), runId: '00000000-0000-4000-a000-000000000001', result: { ...meta, imageUrl: `/api/ai/scientific-illustration/${meta.id}?notebookId=${scope.notebookId}`, downloadUrl: `/api/ai/scientific-illustration/${meta.id}?notebookId=${scope.notebookId}&download=1`, reviewRequired: true, boundary: '仅示意，仍需人工核验' } };
    assert(isIllustrationDocument(document));
    assert(!isIllustrationDocument({ ...document, result: { ...document.result, imageUrl: 'https://outside.invalid/exfil' } }));
    const saved = await saveNotebookDocument(scope, 'scientific-illustration', document, null);
    assert.deepEqual((await readNotebookDocument(scope, 'scientific-illustration'))?.data, document);
    assert.equal(await readNotebookDocument({ ...scope, ownerMemberId: 'fixture-b' }, 'scientific-illustration'), null);
    await assert.rejects(saveNotebookDocument(scope, 'scientific-illustration', { ...document, result: null }, null), /另一个页面/);
    assert.deepEqual(await saveNotebookDocument(scope, 'scientific-illustration', document, null), saved);
    const file = path.join(root, `${meta.id}.json`);
    await writeFile(file, JSON.stringify({ ...meta, ownerMemberId: undefined }));
    await assert.rejects(readScientificIllustration(meta.id, scope.ownerMemberId), /无权访问/);
    await writeFile(file, JSON.stringify(meta));
    const bytes = await readFile(path.join(root, `${meta.id}.png`)); bytes[bytes.length - 1] ^= 1; await writeFile(path.join(root, `${meta.id}.png`), bytes);
    await assert.rejects(readScientificIllustration(meta.id, scope.ownerMemberId), /校验失败/);
    console.log(JSON.stringify({ ok: true, exactImage: true, accountAndBookStorage: true, orphanDenied: true, corruptBytesDenied: true, conflictAndReplay: true, externalUrlRejected: true, paidCalls: 0 }));
  } finally {
    if (old.image === undefined) delete process.env.SCIENTIFIC_ILLUSTRATION_STORE_DIR; else process.env.SCIENTIFIC_ILLUSTRATION_STORE_DIR = old.image;
    if (old.docs === undefined) delete process.env.STUDIO_DOCUMENT_STORE_DIR; else process.env.STUDIO_DOCUMENT_STORE_DIR = old.docs;
    await rm(root, { recursive: true, force: true });
  }
}
void main();
