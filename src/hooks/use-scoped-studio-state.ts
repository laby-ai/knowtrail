'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  parseStoredStudioValue,
  serializeStudioValue,
  studioSessionStorageKey,
} from '@/lib/studio-session-storage';

function readSessionValue<T>(storageKey: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    return parseStoredStudioValue(window.sessionStorage.getItem(storageKey), fallback);
  } catch {
    return fallback;
  }
}

export function useScopedStudioState<T>(
  scopeKey: string,
  toolId: string,
  field: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = studioSessionStorageKey(scopeKey, toolId, field);
  const [entry, setEntry] = useState(() => ({
    key: storageKey,
    value: readSessionValue(storageKey, initialValue),
  }));

  useEffect(() => {
    if (entry.key === storageKey) return;
    setEntry({ key: storageKey, value: readSessionValue(storageKey, initialValue) });
  }, [entry.key, initialValue, storageKey]);

  useEffect(() => {
    if (entry.key !== storageKey || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(storageKey, serializeStudioValue(entry.value));
    } catch {
      // Browser storage is best-effort; the in-memory tool remains usable.
    }
  }, [entry, storageKey]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    setEntry(current => {
      const currentValue = current.key === storageKey
        ? current.value
        : readSessionValue(storageKey, initialValue);
      return {
        key: storageKey,
        value: typeof nextValue === 'function'
          ? (nextValue as (previous: T) => T)(currentValue)
          : nextValue,
      };
    });
  }, [initialValue, storageKey]);

  return [entry.value, setValue];
}
