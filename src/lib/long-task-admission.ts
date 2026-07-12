import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AccountServiceError } from './account-entitlement-client';

type LongTaskStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

type LongTaskRecord = {
  id: string;
  memberId: string;
  operation: string;
  idempotencyHash: string;
  status: LongTaskStatus;
  createdAt: string;
  updatedAt: string;
};

type LongTaskStore = { version: 1; tasks: LongTaskRecord[] };

const records = new Map<string, LongTaskRecord>();
let loadedPath = '';

function storePath() {
  const explicit = process.env.KNOWTRAIL_LONG_TASK_STORE_PATH?.trim();
  if (explicit) return path.resolve(process.cwd(), explicit);
  const studioStore = process.env.STUDIO_JOB_STORE_PATH?.trim();
  if (studioStore) return path.join(path.dirname(path.resolve(process.cwd(), studioStore)), 'long-tasks.json');
  return path.resolve(process.cwd(), '.data/long-tasks/tasks.json');
}

function nowIso() {
  return new Date().toISOString();
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function writeStore() {
  const target = storePath();
  mkdirSync(path.dirname(target), { recursive: true });
  const payload: LongTaskStore = { version: 1, tasks: [...records.values()] };
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, target);
}

function loadStore() {
  const target = storePath();
  if (loadedPath === target) return;
  records.clear();
  if (existsSync(target)) {
    try {
      const payload = JSON.parse(readFileSync(target, 'utf8')) as LongTaskStore;
      for (const task of payload.tasks || []) records.set(task.id, task);
    } catch {
      // Corrupt admission state fails closed as an empty store; the next mutation rewrites it.
    }
  }
  loadedPath = target;

  const timestamp = nowIso();
  let recovered = false;
  for (const task of records.values()) {
    if (task.status === 'running') {
      task.status = 'failed';
      task.updatedAt = timestamp;
      recovered = true;
    }
  }
  if (recovered) writeStore();
}

function prune() {
  const cutoff = Date.now() - Number(process.env.KNOWTRAIL_LONG_TASK_TTL_MS || 24 * 60 * 60 * 1000);
  let changed = false;
  for (const [id, task] of records) {
    if (Date.parse(task.updatedAt) < cutoff) {
      records.delete(id);
      changed = true;
    }
  }
  if (changed) writeStore();
}

export class LongTaskAdmissionError extends AccountServiceError {
  constructor(status: 409 | 429, code: string, taskId?: string) {
    super(status, code, { error: code, taskId });
    this.name = 'LongTaskAdmissionError';
  }
}

export function resolveLongTaskIdempotencyKey(input: {
  explicit?: string | null;
  memberId: string;
  operation: string;
  content: string;
}) {
  const explicit = input.explicit?.trim();
  if (explicit && /^[A-Za-z0-9._:-]{8,128}$/.test(explicit)) return explicit;
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  return hash(`${input.memberId}|${input.operation}|${input.content}|${bucket}`);
}

export function admitLongTask(input: { memberId: string; operation: string; idempotencyKey: string }) {
  loadStore();
  prune();
  const idempotencyHash = hash(`${input.memberId}|${input.operation}|${input.idempotencyKey}`);
  const existing = [...records.values()].find(task => task.idempotencyHash === idempotencyHash);
  if (existing) {
    throw new LongTaskAdmissionError(409, existing.status === 'running' ? 'task_already_running' : 'idempotency_replay', existing.id);
  }

  const maxActive = Math.max(1, Number(process.env.KNOWTRAIL_MEMBER_TASK_CONCURRENCY || 2));
  const active = [...records.values()].filter(task => task.memberId === input.memberId && task.status === 'running').length;
  if (active >= maxActive) throw new LongTaskAdmissionError(429, 'member_task_concurrency_exceeded');

  const timestamp = nowIso();
  const task: LongTaskRecord = {
    id: `kt-${randomUUID()}`,
    memberId: input.memberId,
    operation: input.operation,
    idempotencyHash,
    status: 'running',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  records.set(task.id, task);
  writeStore();

  const finish = (status: Exclude<LongTaskStatus, 'running'>) => {
    const current = records.get(task.id);
    if (!current || current.status !== 'running') return;
    current.status = status;
    current.updatedAt = nowIso();
    writeStore();
  };
  return {
    taskId: task.id,
    succeed: () => finish('succeeded'),
    fail: () => finish('failed'),
    cancel: () => finish('cancelled'),
  };
}

export function reloadLongTaskStoreForTest() {
  loadedPath = '';
  loadStore();
}
