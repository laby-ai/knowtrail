import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const app = createRequire(`${process.cwd()}/package.json`);
const reopen = process.argv.includes('--reopen');
let fixture = process.argv[process.argv.indexOf('--reopen') + 1] || '';
const owner = `paper-host:paper-user-${'a'.repeat(32)}`;
const notebook = 'metadata-fixture';

async function main() {
  if (!reopen) fixture = await mkdtemp(path.join(tmpdir(), 'knowtrail-metadata-'));
process.env.SOURCE_STORE_PATH = path.join(fixture, 'sources.json');
process.env.SOURCE_STORE_ADAPTER = 'local-json';
process.env.PAPER_HOST_SESSION_VERIFY_URL = 'https://sms-fixture.invalid/session?provider=knowtrail';
for (const key of ['OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY']) process.env[key] = '';

  await mkdir(fixture, { recursive: true });
  const { NextRequest } = app('next/server');
  const { ingestExtractedSource } = app('./src/lib/ingestion-store.ts');
  const route = app('./src/app/api/ingestion/sources/route.ts');
  globalThis.fetch = async (input, init) => {
    assert.ok(String(input).includes('sms-fixture.invalid'), 'No model or external network calls');
    const cookie = new Headers(init?.headers).get('cookie') || '';
    const who = cookie.includes('fixture-valid-a') ? 'a' : cookie.includes('fixture-valid-b') ? 'b' : null;
    return who ? Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: `paper-user-${who.repeat(32)}`, capabilities: ['verified-sms-session'] } }) : Response.json({}, { status: 401 });
  };
  const get = (id = '', who = 'a') => route.GET(new NextRequest(`https://fixture.invalid/knowtrail/api/ingestion/sources?notebookId=${notebook}${id ? `&id=${id}` : ''}`, { headers: who ? { cookie: `userId=fixture; token=fixture-valid-${who}` } : {} }));
  const rawContent = '标题：专用恢复样本\n作者：样本甲、样本乙\n年份：2022\n模拟记录12条，剔除2条后保留10条。仅用于软件验收。';
  if (!reopen) {
    await ingestExtractedSource({ id: 'metadata-known', ownerMemberId: owner, notebookId: notebook, fileName: 'metadata.docx', fileType: 'docx', title: '专用恢复样本', authors: ['样本甲', '样本乙'], year: 2022, keywords: ['软件验收'], journal: '模拟期刊', doi: 'fixture-only', abstract: '专用摘要，不是真实研究。', content: '12条模拟记录剔除2条后保留10条。', rawContent, shortName: '样本甲. 2022', fileKey: 'uploads/fixture.docx', fileUrl: 'uploads/fixture.docx' });
  }
  const response = await get('metadata-known');
  assert.equal(response.status, 200);
  const { source } = await response.json();
  assert.deepEqual(source.authors, ['样本甲', '样本乙']);
  assert.equal(source.year, 2022);
  assert.equal(source.rawContent, rawContent);
  assert.equal(source.abstract, '专用摘要，不是真实研究。');
  assert.equal(source.journal, '模拟期刊');
  assert.equal(source.doi, 'fixture-only');
  assert.deepEqual(source.keywords, ['软件验收']);
  assert.equal(source.storageKey, 'uploads/fixture.docx');
  if (reopen) {
    console.log(JSON.stringify({ ok: true, freshProcessRestore: true, authors: source.authors, year: source.year, rawTextPreserved: true, paidCalls: 0 }));
    return;
  }
  const list = await (await get()).json();
  assert.deepEqual(list.sources[0].authors, source.authors);
  assert.equal(list.sources[0].year, 2022);
  await ingestExtractedSource({ id: 'metadata-unknown', ownerMemberId: owner, notebookId: notebook, fileName: 'unknown.txt', fileType: 'txt', rawContent: '这段2024年的模拟记录没有说明作者或发表年份。' });
  const unknown = (await (await get('metadata-unknown')).json()).source;
  assert.deepEqual(unknown.authors, []);
  assert.equal(unknown.year, undefined, 'A date in the body is not a publication year');
  const storePath = path.join(fixture, 'sources.json');
  const store = JSON.parse(await readFile(storePath, 'utf8'));
  const legacy = { ...store.sources[0], id: 'legacy-labelled', authors: undefined, year: undefined, rawContent: undefined, content: undefined, chunks: [{ id: 'legacy::chunk-1', sourceId: 'legacy-labelled', chunkIndex: 0, text: rawContent }] };
  store.sources.push(legacy);
  await writeFile(storePath, JSON.stringify(store));
  const hash = async () => createHash('sha256').update(await readFile(storePath)).digest('hex');
  const beforeReadHash = await hash();
  const restored = (await (await get('legacy-labelled')).json()).source;
  assert.deepEqual(restored.authors, ['样本甲', '样本乙']);
  assert.equal(restored.year, 2022);
  assert.equal(await hash(), beforeReadHash, 'Reading legacy metadata must not rewrite stored user records');
  assert.equal((await get('metadata-known', 'b')).status, 404);
  assert.equal((await get('metadata-known', '')).status, 401);
  const child = spawnSync(process.execPath, ['--import', 'tsx', path.resolve(process.argv[1]), '--reopen', fixture], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /freshProcessRestore/);
  console.log(JSON.stringify({ ok: true, actualIngestionAndApi: true, metadataRestored: true, unknownRemainsUnknown: true, labelledLegacyRecoveredWithoutRewrite: true, otherOwner: 404, anonymous: 401, paidCalls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
