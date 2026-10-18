import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalJsonSourceStoreAdapter } from '../src/lib/source-store/local-json-adapter';
import type { StoredSourceRecord } from '../src/lib/source-store/types';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-source-safety-'));
  const originalPath = process.env.SOURCE_STORE_PATH;
  const target = path.join(directory, 'sources.json');
  process.env.SOURCE_STORE_PATH = target;
  try {
    const adapter = new LocalJsonSourceStoreAdapter();
    assert.deepEqual((await adapter.read()).sources, [], 'Only a missing file represents an initial empty store');
    const source: StoredSourceRecord = {
      id: 'gillon-2017', fileName: '1703.01424v1.pdf', fileType: 'pdf', title: 'TRAPPIST-1', shortName: 'Gillon et al. 2017',
      status: 'succeeded', createdAt: '2017-03-03T00:00:00Z', updatedAt: '2017-03-03T00:00:00Z', stages: [], chunks: [], chunkCount: 0, tokenEstimate: 0,
      vectorIndex: { status: 'not_configured', updatedAt: '2017-03-03T00:00:00Z' },
    };
    await adapter.mutate(store => { store.sources.push(source); return store; });
    const valid = await readFile(target, 'utf8');
    for (const raw of ['{invalid json', 'null', '{"version":2,"sources":[]}', '{"version":1,"sources":null}']) {
      await writeFile(target, raw);
      await assert.rejects(() => adapter.read(), 'Corruption must not masquerade as an empty library');
      let mutatorCalled = false;
      await assert.rejects(() => adapter.mutate(store => { mutatorCalled = true; return store; }));
      assert.equal(mutatorCalled, false);
      assert.equal(await readFile(target, 'utf8'), raw, 'Failed reads must preserve every original byte');
    }
    const inaccessible = path.join(directory, 'directory-instead-of-file');
    const privateFragment = 'PRIVATE_LIBRARY_FRAGMENT_do_not_echo';
    await writeFile(target, privateFragment);
    await assert.rejects(() => adapter.read(), error => error instanceof Error && !error.message.includes('PRIVATE_LI'), 'Parser diagnostics must not expose global library fragments to upload callers');
    assert.equal(await readFile(target, 'utf8'), privateFragment);
    await mkdir(inaccessible);
    process.env.SOURCE_STORE_PATH = inaccessible;
    await assert.rejects(() => adapter.read(), 'I/O errors other than ENOENT must propagate');
    await assert.rejects(() => adapter.mutate(store => store));
    process.env.SOURCE_STORE_PATH = target;
    await writeFile(target, valid);
    await Promise.all(Array.from({ length: 4 }, (_, index) => adapter.mutate(store => { store.sources.push({ ...source, id: 'copy-' + index }); return store; })));
    assert.deepEqual((await adapter.read()).sources.map(item => item.id), ['gillon-2017', 'copy-0', 'copy-1', 'copy-2', 'copy-3'], 'Failed writes must not poison the queue or drop existing records');
    console.log(JSON.stringify({ ok: true, missingOnlyInitializes: true, corruptAndUnreadablePreserved: true, queueRecovers: true, paidCalls: 0 }));
  } finally {
    if (originalPath === undefined) delete process.env.SOURCE_STORE_PATH;
    else process.env.SOURCE_STORE_PATH = originalPath;
    assert.equal(path.dirname(directory), os.tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
