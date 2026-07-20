import assert from 'node:assert/strict';
import {
  projectNotebookHome,
  type NotebookHomeFilter,
  type NotebookHomeSort,
  type NotebookHomeView,
} from '../src/lib/notebook-home-controls';
import { resolveLibraryUploadTarget } from '../src/lib/library-upload-target';
import {
  loadNotebookSourceCounts,
  mergeNotebookSourceCounts,
} from '../src/lib/notebook-source-counts';

const notebooks = [
  { id: 'older', title: 'Older', sourceCount: 1, updatedAt: '2026-01-01T00:00:00.000Z', accent: '' },
  { id: 'newer', title: 'Newer', sourceCount: 2, updatedAt: '2026-07-01T00:00:00.000Z', accent: '' },
];

function project(filter: NotebookHomeFilter, sort: NotebookHomeSort, view: NotebookHomeView) {
  return projectNotebookHome({ notebooks, query: '', filter, sort, view });
}

assert.deepEqual(project('all', 'latest', 'comfortable').notebooks.map(item => item.id), ['newer', 'older']);
assert.deepEqual(project('mine', 'oldest', 'grid').notebooks.map(item => item.id), ['older', 'newer']);
assert.equal(project('featured', 'latest', 'list').showFeatured, true);
assert.equal(project('featured', 'latest', 'list').showPersonal, false);
assert.equal(project('mine', 'latest', 'grid').showFeatured, false);
assert.equal(project('mine', 'latest', 'grid').showPersonal, true);
assert.equal(projectNotebookHome({ notebooks, query: 'new', filter: 'all', sort: 'title', view: 'list' }).notebooks[0].id, 'newer');

const folders = [{ id: 'folder-a' }, { id: 'folder-b' }];
assert.equal(resolveLibraryUploadTarget('folder-b', folders), 'folder-b');
assert.equal(resolveLibraryUploadTarget('missing', folders), null);
assert.equal(resolveLibraryUploadTarget(null, folders), null);

async function runSourceCountContract() {
  const sourceCounts = await loadNotebookSourceCounts({
    notebookIds: ['featured-research-reading', 'workspace-empty', 'workspace-failed'],
    request: async input => {
      const notebookId = new URL(String(input), 'http://local.test').searchParams.get('notebookId');
      if (notebookId === 'workspace-failed') return new Response(null, { status: 503 });
      return Response.json({
        sources: notebookId === 'featured-research-reading' ? [{ id: 'persisted-source' }] : [],
      });
    },
  });
  assert.deepEqual(sourceCounts, {
    'featured-research-reading': 1,
    'workspace-empty': 0,
  });
  assert.deepEqual(mergeNotebookSourceCounts({
    notebooks: [
      { id: 'featured-research-reading', title: 'Research', sourceCount: 2, updatedAt: '', accent: '' },
      { id: 'workspace-empty', title: 'Empty', sourceCount: 4, updatedAt: '', accent: '' },
      { id: 'workspace-failed', title: 'Failed', sourceCount: 7, updatedAt: '', accent: '' },
    ],
    persistedCounts: sourceCounts,
    builtInCounts: { 'featured-research-reading': 2 },
  }), [
    { id: 'featured-research-reading', title: 'Research', sourceCount: 3, updatedAt: '', accent: '' },
    { id: 'workspace-empty', title: 'Empty', sourceCount: 0, updatedAt: '', accent: '' },
    { id: 'workspace-failed', title: 'Failed', sourceCount: 7, updatedAt: '', accent: '' },
  ]);
}

runSourceCountContract().then(() => {
  console.log(JSON.stringify({
    ok: true,
    checked: [
      'notebook filters expose distinct all, mine and featured projections',
      'notebook sort changes result order',
      'notebook view mode remains explicit state',
      'upload target accepts only an existing selected folder',
      'notebook source counts include persisted additions, clear deleted sources and preserve failed scopes',
    ],
  }, null, 2));
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
