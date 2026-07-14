import assert from 'node:assert/strict';
import { resolveEmbeddedEntryState } from '@/lib/embedded-entry-state';

const embeddedBase = 'host=paper-web&hostBridge=postMessage&workspaceKey=guest-session-01';

assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}&view=notebooks`, hash: '#notebooks' }),
  { view: 'notebooks', embedded: true, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}`, hash: '' }),
  { view: 'notebooks', embedded: true, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}&view=landing`, hash: '' }),
  { view: 'notebooks', embedded: true, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}&view=workbench&notebookId=workspace-42`, hash: '#workbench' }),
  { view: 'workbench', embedded: true, notebookId: 'workspace-42' },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}&view=workbench&notebookId=../other-workspace`, hash: '#workbench' }),
  { view: 'workbench', embedded: true, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: '', hash: '' }),
  { view: 'landing', embedded: false, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: '?view=notebooks', hash: '#notebooks' }),
  { view: 'notebooks', embedded: false, notebookId: null },
);

console.log('embedded entry state contract passed');
