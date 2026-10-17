import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-notebook-catalog-'));
  process.env.NOTEBOOK_CATALOG_STORE_PATH = path.join(tempDir, 'notebooks.json');

  try {
    const { getNotebookCatalog, saveNotebookCatalog } = await import('../src/lib/notebook-catalog-store');
    assert.equal(await getNotebookCatalog('member-a'), null);

    const saved = await saveNotebookCatalog('member-a', {
      expectedRevision: null,
      notebooks: [
        {
          id: 'default-workspace',
          title: '  恒星光谱  ',
          sourceCount: 2,
          updatedAt: '2026-07-24T00:00:00.000Z',
          accent: 'from-sky-50',
        },
      ],
      activeNotebookId: 'default-workspace',
      workbenchPreferences: {
        leftPanelWidth: 320,
        rightPanelWidth: 520,
        leftPanelCollapsed: true,
        rightPanelCollapsed: false,
        activeStudioTool: 'report',
      },
    });
    assert.equal(saved.notebooks[0]?.title, '恒星光谱');
    assert.equal(saved.activeNotebookId, 'default-workspace');
    assert.deepEqual(saved.workbenchPreferences, {
      leftPanelWidth: 320,
      rightPanelWidth: 520,
      leftPanelCollapsed: true,
      rightPanelCollapsed: false,
      activeStudioTool: 'report',
    });
    assert.equal((await getNotebookCatalog('member-a'))?.notebooks[0]?.sourceCount, 2);
    assert.equal((await getNotebookCatalog('member-a'))?.workbenchPreferences?.activeStudioTool, 'report');
    assert.equal(await getNotebookCatalog('member-b'), null);

    const persisted = JSON.parse(await readFile(process.env.NOTEBOOK_CATALOG_STORE_PATH, 'utf8')) as {
      catalogs: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(persisted.catalogs), ['member-a']);
    console.log('notebook catalog store contract passed');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main();
