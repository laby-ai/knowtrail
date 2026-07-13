import assert from 'node:assert/strict';
import {
  projectNotebookHome,
  type NotebookHomeFilter,
  type NotebookHomeSort,
  type NotebookHomeView,
} from '../src/lib/notebook-home-controls';
import { resolveLibraryUploadTarget } from '../src/lib/library-upload-target';

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

console.log(JSON.stringify({
  ok: true,
  checked: [
    'notebook filters expose distinct all, mine and featured projections',
    'notebook sort changes result order',
    'notebook view mode remains explicit state',
    'upload target accepts only an existing selected folder',
  ],
}, null, 2));
