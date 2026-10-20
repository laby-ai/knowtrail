function isTransientNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /fetch failed|terminated|ECONNRESET|ETIMEDOUT|UND_ERR|socket|network/i.test(message);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function waitForRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const cancelled = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancelled); resolve(); }, 600 * attempt);
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

export function buildOpenAIHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchWithTransientRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options?: { attempts?: number; label?: string },
): Promise<Response> {
  const attempts = Math.max(1, options?.attempts ?? Number(process.env.REAL_SERVICE_FETCH_RETRIES || 2));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    init.signal?.throwIfAborted();
    try {
      const response = await fetch(input, init);
      if (attempt < attempts && isRetryableStatus(response.status)) {
        await response.arrayBuffer().catch(() => undefined);
        await waitForRetry(attempt, init.signal || undefined);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt >= attempts || !isTransientNetworkError(error)) throw error;
      void options?.label;
      await waitForRetry(attempt, init.signal || undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'fetch failed'));
}

export function shouldRetryTransientError(error: unknown): boolean {
  return isTransientNetworkError(error);
}

export async function waitForTransientRetry(attempt: number): Promise<void> {
  await waitForRetry(attempt);
}
