import { normalizeNotebookId } from '@/lib/notebook-scope';

export type EmbeddedEntryView = 'landing' | 'notebooks' | 'workbench';

export type EmbeddedEntryState = {
  view: EmbeddedEntryView;
  embedded: boolean;
  notebookId: string | null;
};

export function resolveEmbeddedEntryState({
  search,
  hash,
}: {
  search: string;
  hash: string;
}): EmbeddedEntryState {
  const params = new URLSearchParams(search);
  const embedded = params.get('host') === 'paper-web' && params.get('hostBridge') === 'postMessage';
  const requestedView = params.get('view');
  const workbenchRequested = hash === '#workbench' || requestedView === 'workbench';

  if (workbenchRequested) {
    return {
      view: 'workbench',
      embedded,
      notebookId: normalizeNotebookId(params.get('notebookId')) || null,
    };
  }

  if (embedded || hash === '#notebooks' || requestedView === 'notebooks') {
    return { view: 'notebooks', embedded, notebookId: null };
  }

  return { view: 'landing', embedded: false, notebookId: null };
}
