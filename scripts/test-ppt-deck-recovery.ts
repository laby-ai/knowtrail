import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { savePptDeckDocument, readDeckImage, PptDeckAccessError } from '../src/lib/ppt/deck-store';
import { isHtmlDeckDocument, isImageDeckDocument, type ImageDeckDocument, type HtmlDeckDocument } from '../src/lib/ppt/deck-document';
import { NotebookDocumentConflict, readNotebookDocument } from '../src/lib/private-notebook-document';
import { cancelDeckGeneration, prepareDeckGeneration } from '../src/lib/ppt/deck-generation-storage';
import { extractHtmlDocument } from '../src/lib/ppt/html-slide-safety';
import { readDeckExport, saveDeckExport } from '../src/lib/ppt/deck-export-store';
import { parseDeckOutline, parseDeckNarrations } from '../src/lib/ppt/deck-json';

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-ppt-deck-'));
  const old = process.env.STUDIO_DOCUMENT_STORE_DIR;
  process.env.STUDIO_DOCUMENT_STORE_DIR = root;
  const a = { ownerMemberId: 'fixture-a', notebookId: 'ppt-deck-fixture' };
  const b = { ...a, ownerMemberId: 'fixture-b' };
  const runId = '00000000-0000-4000-a000-000000000001';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const data: ImageDeckDocument = { runId, deck: { deckTitle: '模拟记录', activeIndex: 0, history: {}, style: 'academic', detailLevel: 'default', language: 'zh', aspectRatio: '16:9', citations: [], retrieval: null,
    slides: [{ id: 'one', order: 0, title: '12条剔除2条保留10条', content: '导入→检查时间戳→剔除缺失→人工核对', narration: '仅用于软件验收。', imageUrl: 'data:image/png;base64,' + png, citations: [] }] } };
  try {
    const quoted = { title: '包含"引号"的原文标题', points: ['12条剔除2条后保留10条'] };
    assert.deepEqual(parseDeckOutline(JSON.stringify({ pages: [quoted] }), 1), [quoted]);
    assert.deepEqual(parseDeckNarrations('{"narrations":["仅用于模拟验收。"]}', 1), ['仅用于模拟验收。']);
    assert.throws(() => parseDeckOutline('{"pages":[{"title":"未转义"引号","points":[]}]}', 1), /大纲格式不完整/);
    assert.throws(() => parseDeckOutline('{"pages":[]}', 4), /大纲格式不完整/);
    assert.throws(() => parseDeckNarrations('{"narrations":[""]}', 1), /演讲稿未完整/);
    assert(isImageDeckDocument(data));
    const saved = await savePptDeckDocument(a, 'image-deck', data, null);
    assert(isImageDeckDocument(saved.data));
    assert(saved.data.deck);
    const url = new URL(saved.data.deck.slides[0].imageUrl!, 'https://fixture.invalid');
    const asset = url.searchParams.get('assetId')!;
    assert.equal((await readDeckImage(a, asset)).buffer.toString('base64'), png);
    assert((await readFile(path.join(root, (await import('node:crypto')).createHash('sha256').update(a.ownerMemberId).digest('hex'), a.notebookId, 'image-deck', 'current.json'), 'utf8')).includes('/api/studio/artifacts?'));
    assert(!(JSON.stringify(saved.data).includes(png)), 'Do not embed large images in the metadata store');
    assert.equal(await readNotebookDocument(b, 'image-deck'), null);
    await assert.rejects(readDeckImage(b, asset), (e: unknown) => e instanceof PptDeckAccessError && e.status === 404);
    assert.deepEqual(await savePptDeckDocument(a, 'image-deck', data, null), saved, 'same bytes retry is idempotent');
    await assert.rejects(savePptDeckDocument(a, 'image-deck', { ...saved.data, deck: { ...saved.data.deck, activeIndex: 0, deckTitle: '新标题' } }, null), NotebookDocumentConflict);
    await assert.rejects(savePptDeckDocument(b, 'image-deck', saved.data, null), PptDeckAccessError);
    const replay = await prepareDeckGeneration({ persistArtifact: true, runId, expectedRevision: null }, 'image-deck', a);
    assert.equal(replay?.previous?.revision, saved.revision, 'lost-response replay avoids model work');
    const nextRun = { persistArtifact: true, runId: '00000000-0000-4000-a000-000000000002', expectedRevision: saved.revision };
    const active = await prepareDeckGeneration(nextRun, 'image-deck', a);
    await assert.rejects(prepareDeckGeneration(nextRun, 'image-deck', a), PptDeckAccessError);
    assert.equal(cancelDeckGeneration(b, 'image-deck', nextRun.runId), false);
    assert.equal(active?.signal?.aborted, false);
    assert.equal(cancelDeckGeneration(a, 'image-deck', nextRun.runId), true);
    assert.equal(active?.signal?.aborted, true);
    active?.release();
    const released = await prepareDeckGeneration(nextRun, 'image-deck', a); released?.release();
    const html: HtmlDeckDocument = { runId, deck: { deckTitle: '模拟HTML', activeIndex: 0, styleId: 'minimal', language: 'zh', citations: [], retrieval: null, slides: [{ title: '模拟记录', layoutHint: 'grid', html: '<!DOCTYPE html><html><body><p>12条剔除2条保留10条</p></body></html>' }] } };
    assert(isHtmlDeckDocument(html));
    const htmlSaved = await savePptDeckDocument(a, 'html-deck', html, null);
    const file = Buffer.from([80, 75, 3, 4, 1, 2]); // Storage protocol only; browser QA opens an actual rendered PPTX.
    const exported = await saveDeckExport(a, 'html-deck', htmlSaved.revision, file);
    assert.deepEqual((await readDeckExport(a, 'html-deck', htmlSaved.revision, exported.id)).buffer, file);
    await assert.rejects(readDeckExport(b, 'html-deck', htmlSaved.revision, exported.id), PptDeckAccessError);
    assert.deepEqual(await readNotebookDocument(a, 'html-deck'), htmlSaved);
    assert.equal(await readNotebookDocument(b, 'html-deck'), null);
    assert(!isHtmlDeckDocument({ ...html, deck: { ...html.deck, slides: [{ title: 'unsafe', layoutHint: 'grid', html: '<html><script>fetch("https://outside.invalid")</script></html>' }] } }));
    for (const markup of ['<img src=//outside.invalid/a>', '<style>body{background:url(//outside.invalid/a)}</style>', '<meta http-equiv="refresh" content="0;url=https://outside.invalid">']) assert.equal(extractHtmlDocument('<html>' + markup + '</html>'), null);
    const parent = process.env.STUDIO_DOCUMENT_STORE_DIR;
    await writeFile(path.join(root, 'not-a-directory'), 'fixture');
    process.env.STUDIO_DOCUMENT_STORE_DIR = path.join(root, 'not-a-directory', 'unwritable');
    await assert.rejects(savePptDeckDocument(a, 'html-deck', html, null));
    process.env.STUDIO_DOCUMENT_STORE_DIR = parent;
    assert.deepEqual(await readNotebookDocument(a, 'html-deck'), htmlSaved, 'failed write preserves the previous deck');
    console.log('PPT private image/HTML persistence, exact files, owner boundary, CAS, replay, active request and write-failure checks passed.');
  } finally {
    if (old === undefined) delete process.env.STUDIO_DOCUMENT_STORE_DIR; else process.env.STUDIO_DOCUMENT_STORE_DIR = old;
    await rm(root, { recursive: true, force: true });
  }
}
void main();
