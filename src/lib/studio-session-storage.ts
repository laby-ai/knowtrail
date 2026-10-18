const STUDIO_SESSION_STORAGE_PREFIX = 'knowtrail:studio-session:v1';

export function studioSessionStorageKey(
  scopeKey: string,
  toolId: string,
  field: string,
): string {
  return `${STUDIO_SESSION_STORAGE_PREFIX}:${scopeKey}:${toolId}:${field}`;
}

export function parseStoredStudioValue<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function serializeStudioValue<T>(value: T): string {
  return JSON.stringify(value);
}
