import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createGroundedSseResponse,
  createUsageReservationFinalizer,
} from '../src/lib/grounded-task-lifecycle';

async function readSse(response: Response) {
  return await response.text();
}

async function testSseContract() {
  const response = createGroundedSseResponse({
    requestSignal: new AbortController().signal,
    timeoutMs: 1_000,
    timeoutReason: 'test timed out',
    cancelReason: 'test cancelled',
    async run({ emit, signal }) {
      assert.equal(signal.aborted, false);
      emit({ stage: 'running' });
      emit('[DONE]');
    },
  });

  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-store');
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.equal(
    await readSse(response),
    'data: {"stage":"running"}\n\ndata: [DONE]\n\n',
  );
}

async function testAbortAndErrorContract() {
  const request = new AbortController();
  let observedAbort = false;
  const response = createGroundedSseResponse({
    requestSignal: request.signal,
    timeoutMs: 1_000,
    timeoutReason: 'test timed out',
    cancelReason: 'test cancelled',
    async run({ signal }) {
      request.abort(new Error('request cancelled'));
      await new Promise(resolve => setTimeout(resolve, 0));
      observedAbort = signal.aborted;
      throw new Error('provider stopped');
    },
    async onError(error, { emit, signal }) {
      assert.equal(signal.aborted, true);
      assert.equal((error as Error).message, 'provider stopped');
      emit({ errorType: 'interrupted' });
    },
  });

  assert.equal(await readSse(response), 'data: {"errorType":"interrupted"}\n\n');
  assert.equal(observedAbort, true);
}

async function testReservationContract() {
  const calls: string[] = [];
  const finalizer = createUsageReservationFinalizer({
    requestId: 'reservation-1',
    estimatedUnits: 4,
    async settle(actualUsage) { calls.push(`settle:${actualUsage}`); },
    async release() { calls.push('release'); },
  });

  assert.deepEqual(await finalizer.settle('draft'), { status: 'settled' });
  await finalizer.finalizeFailure('partial');
  assert.deepEqual(calls, ['settle:draft']);

  const releaseCalls: string[] = [];
  const releaseFinalizer = createUsageReservationFinalizer({
    requestId: 'reservation-2',
    estimatedUnits: 3,
    async settle(actualUsage) { releaseCalls.push(`settle:${actualUsage}`); },
    async release() { releaseCalls.push('release'); },
  });
  await releaseFinalizer.finalizeFailure('');
  await releaseFinalizer.finalizeFailure('ignored');
  assert.deepEqual(releaseCalls, ['release']);

  const settleFailure = createUsageReservationFinalizer({
    requestId: 'reservation-3',
    estimatedUnits: 2,
    async settle() { throw Object.assign(new Error('hidden detail'), { code: 'account_settle_rejected' }); },
    async release() { throw new Error('must not release twice'); },
  });
  assert.deepEqual(await settleFailure.settle('draft'), {
    status: 'settle_failed',
    code: 'account_settle_rejected',
  });
  await settleFailure.finalizeFailure('ignored');
}

async function testRouteOwnership() {
  const root = process.cwd();
  const routeNames = [
    'deep-research',
    'hypothesis-generation',
    'experiment-design',
    'academic-writing',
    'peer-review',
  ];
  for (const routeName of routeNames) {
    const file = path.join(root, 'src', 'app', 'api', 'ai', routeName, 'route.ts');
    const source = await readFile(file, 'utf8');
    assert.match(source, /createGroundedSseResponse/);
    assert.match(source, /createUsageReservationFinalizer/);
    assert.doesNotMatch(source, /new ReadableStream/);
    assert.doesNotMatch(source, /reservationFinalized/);
  }

  const owner = await readFile(path.join(root, 'src', 'lib', 'grounded-task-lifecycle.ts'), 'utf8');
  assert.doesNotMatch(owner, /deep-research|hypothesis-generation|experiment-design|academic-writing|peer-review/);
}

async function main() {
  await testSseContract();
  await testAbortAndErrorContract();
  await testReservationContract();
  await testRouteOwnership();
  console.log('grounded task lifecycle contract passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
