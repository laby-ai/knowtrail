import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'knowtrail-long-task-'));
  process.env.KNOWTRAIL_LONG_TASK_STORE_PATH = path.join(temp, 'tasks.json');
  process.env.KNOWTRAIL_MEMBER_TASK_CONCURRENCY = '2';

  const {
    LongTaskAdmissionError,
    admitLongTask,
    reloadLongTaskStoreForTest,
    resolveLongTaskIdempotencyKey,
  } = await import('../src/lib/long-task-admission');

  try {
  const first = admitLongTask({ memberId: 'member-a', operation: 'deep-research', idempotencyKey: 'explicit-key-0001' });
  assert.throws(
    () => admitLongTask({ memberId: 'member-a', operation: 'deep-research', idempotencyKey: 'explicit-key-0001' }),
    (error: unknown) => error instanceof LongTaskAdmissionError && error.status === 409 && error.code === 'task_already_running',
  );

  const second = admitLongTask({ memberId: 'member-a', operation: 'academic-writing', idempotencyKey: 'explicit-key-0002' });
  assert.throws(
    () => admitLongTask({ memberId: 'member-a', operation: 'peer-review', idempotencyKey: 'explicit-key-0003' }),
    (error: unknown) => error instanceof LongTaskAdmissionError && error.status === 429 && error.code === 'member_task_concurrency_exceeded',
  );

  const otherMember = admitLongTask({ memberId: 'member-b', operation: 'peer-review', idempotencyKey: 'explicit-key-0003' });
  otherMember.cancel();
  otherMember.cancel();
  first.succeed();
  second.fail();
  assert.throws(
    () => admitLongTask({ memberId: 'member-a', operation: 'deep-research', idempotencyKey: 'explicit-key-0001' }),
    (error: unknown) => error instanceof LongTaskAdmissionError && error.status === 409 && error.code === 'idempotency_replay',
  );

  admitLongTask({ memberId: 'member-a', operation: 'scientific-illustration', idempotencyKey: 'restart-key-0004' });
  reloadLongTaskStoreForTest();
  const persisted = readFileSync(process.env.KNOWTRAIL_LONG_TASK_STORE_PATH, 'utf8');
  assert.match(persisted, /"status":"failed"/);
  assert.doesNotMatch(persisted, /restart-key-0004|explicit-key-0001/);

  const derivedA = resolveLongTaskIdempotencyKey({ memberId: 'member-a', operation: 'chat', content: 'same content' });
  const derivedB = resolveLongTaskIdempotencyKey({ memberId: 'member-a', operation: 'chat', content: 'same content' });
  assert.equal(derivedA, derivedB);
  assert.equal(resolveLongTaskIdempotencyKey({ explicit: 'client-key-1234', memberId: 'member-a', operation: 'chat', content: 'x' }), 'client-key-1234');

  console.log(JSON.stringify({ status: 'pass', idempotency: true, concurrency: 2, restartRecovery: 'failed-safe' }));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

void main();
