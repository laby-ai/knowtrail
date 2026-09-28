const MAX_CALLS_PER_HOUR = 30;
const MAX_CONCURRENT = 4;

const callLog = new Map<string, number[]>();
let activeCount = 0;

export function checkRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const hourAgo = now - 3600_000;

  const calls = (callLog.get(userId) || []).filter(t => t > hourAgo);
  callLog.set(userId, calls);

  if (calls.length >= MAX_CALLS_PER_HOUR) {
    const oldest = calls[0];
    const retryAfter = Math.ceil((oldest + 3600_000 - now) / 1000);
    return { allowed: false, retryAfter };
  }

  calls.push(now);
  callLog.set(userId, calls);
  return { allowed: true };
}

export async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  while (activeCount >= MAX_CONCURRENT) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  activeCount++;
  try {
    return await fn();
  } finally {
    activeCount--;
  }
}
