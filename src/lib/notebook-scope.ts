const NOTEBOOK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

export function normalizeNotebookId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !NOTEBOOK_ID_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

export function notebookIdFromStorageScopeKey(scopeKey: string): string | undefined {
  const separatorIndex = scopeKey.indexOf(':');
  return normalizeNotebookId(separatorIndex >= 0 ? scopeKey.slice(separatorIndex + 1) : scopeKey);
}
