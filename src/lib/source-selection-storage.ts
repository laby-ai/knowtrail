const STORAGE_PREFIX = 'knowtrail:source-selection:v1';

export function sourceSelectionStorageKey(scopeKey: string): string {
  return `${STORAGE_PREFIX}:${scopeKey}`;
}

export function parseStoredSourceSelection(raw: string | null, fallback: string[]): string[] {
  if (!raw) return [...fallback];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...fallback];
    return [...new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
  } catch {
    return [...fallback];
  }
}

export function serializeSourceSelection(paperIds: string[]): string {
  return JSON.stringify([...new Set(paperIds)]);
}
