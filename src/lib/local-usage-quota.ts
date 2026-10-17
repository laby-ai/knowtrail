import { createHmac } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { QuotaInsufficientError } from '@/lib/account-entitlement-client';
import type { BillingProductArea } from '@/lib/account-ai-billing';

type UsageStore = { date: string; usage: Record<string, Partial<Record<BillingProductArea, number>>> };

let writeQueue: Promise<void> = Promise.resolve();

function quotaPath(): string { return process.env.LOCAL_USAGE_QUOTA_PATH?.trim() || ''; }
export function localUsageQuotaConfigured(): boolean { return Boolean(quotaPath()); }

function dailyLimit(area: BillingProductArea): number {
  const names: Record<BillingProductArea, string> = {
    'ai.text': 'LOCAL_USAGE_QUOTA_TEXT_DAILY',
    'ai.image': 'LOCAL_USAGE_QUOTA_IMAGE_DAILY',
    'ai.video': 'LOCAL_USAGE_QUOTA_VIDEO_DAILY',
    'ai.agent': 'LOCAL_USAGE_QUOTA_AGENT_DAILY',
  };
  const defaults: Record<BillingProductArea, number> = { 'ai.text': 10, 'ai.image': 2, 'ai.video': 1, 'ai.agent': 3 };
  const value = Number(process.env[names[area]] || defaults[area]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaults[area];
}

function memberKey(memberId: string): string {
  const key = process.env.KNOWTRAIL_OBSERVABILITY_HASH_KEY?.trim() || 'knowtrail-local-quota';
  return createHmac('sha256', key).update(memberId).digest('hex');
}

async function updateStore<T>(operation: (store: UsageStore) => T | Promise<T>): Promise<T> {
  const target = quotaPath();
  if (!target) throw new Error('LOCAL_USAGE_QUOTA_PATH is not configured');
  let resolveResult!: (value: T) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  writeQueue = writeQueue.then(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const parsed = JSON.parse(await readFile(target, 'utf8').catch(() => '{"date":"","usage":{}}')) as UsageStore;
      const store: UsageStore = parsed.date === today && parsed.usage ? parsed : { date: today, usage: {} };
      const value = await operation(store);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.tmp`;
      await writeFile(temporary, `${JSON.stringify(store)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, target);
      resolveResult(value);
    } catch (error) { rejectResult(error); }
  });
  await writeQueue;
  return result;
}

export async function reserveLocalUsage(input: { memberId: string; productArea: BillingProductArea; units?: number }) {
  const key = memberKey(input.memberId);
  const area = input.productArea;
  const limit = dailyLimit(area);
  await updateStore(store => {
    const member = store.usage[key] || {};
    const used = member[area] || 0;
    if (used >= limit) throw new QuotaInsufficientError('local_daily_quota_exhausted', { productArea: area });
    member[area] = used + 1;
    store.usage[key] = member;
  });
  let finalized = false;
  return {
    settle: async () => { finalized = true; },
    release: async () => {
      if (finalized) return;
      finalized = true;
      await updateStore(store => {
        const member = store.usage[key] || {};
        member[area] = Math.max(0, (member[area] || 0) - 1);
        store.usage[key] = member;
      });
    },
  };
}
