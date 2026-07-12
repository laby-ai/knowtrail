import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createGroundedTaskObservation,
  operationalObservabilityStatus,
} from '../src/lib/operational-observability';

async function* successfulProvider() {
  yield 'first';
  yield 'second';
}

async function* failedProvider() {
  yield 'partial';
  throw new TypeError('provider-secret-response');
}

async function main() {
  const hashKey = 'test-only-observability-key-that-is-longer-than-thirty-two-bytes';
  const tenantId = 'tenant-raw-secret';
  const memberId = 'member-raw-secret';
  const requestId = 'knowtrail-grounded-123';
  const logs: string[] = [];

  assert.deepEqual(operationalObservabilityStatus({ hashKey: '' }), {
    ready: false,
    blockers: ['observability_identity_hash_unavailable'],
  });
  assert.deepEqual(operationalObservabilityStatus({ hashKey }), { ready: true, blockers: [] });

  const observation = createGroundedTaskObservation({
    hashKey,
    requestId,
    tenantId,
    memberId,
    taskType: 'deep-research',
    writeLog: line => logs.push(line),
  });
  observation.running();
  const chunks: string[] = [];
  for await (const chunk of observation.observeProvider(successfulProvider())) chunks.push(chunk);
  observation.succeeded();
  assert.deepEqual(chunks, ['first', 'second']);

  const parsed = logs.map(line => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(parsed.map(entry => [entry.event, entry.state]), [
    ['task_lifecycle', 'running'],
    ['provider_call', 'started'],
    ['provider_call', 'succeeded'],
    ['task_lifecycle', 'succeeded'],
  ]);
  for (const entry of parsed) {
    assert.equal(entry.requestId, requestId);
    assert.match(String(entry.tenantRef), /^tn_[0-9a-f]{24}$/);
    assert.match(String(entry.memberRef), /^mb_[0-9a-f]{24}$/);
    assert.match(String(entry.taskRef), /^tk_[0-9a-f]{24}$/);
    assert.equal(entry.taskType, 'deep-research');
  }
  assert.equal(typeof parsed[2].durationMs, 'number');

  const failureLogs: string[] = [];
  const failed = createGroundedTaskObservation({
    hashKey,
    requestId: 'knowtrail-grounded-failure-123',
    tenantId,
    memberId,
    taskType: 'hypothesis-generation',
    writeLog: line => failureLogs.push(line),
  });
  await assert.rejects(async () => {
    for await (const _chunk of failed.observeProvider(failedProvider())) void _chunk;
  }, TypeError);
  failed.failed('hypothesis_generation_failed', new TypeError('route-secret-message'));
  const failureEntries = failureLogs.map(line => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(failureEntries.map(entry => [entry.event, entry.state]), [
    ['provider_call', 'started'],
    ['provider_call', 'failed'],
    ['task_lifecycle', 'failed'],
  ]);
  assert.equal(failureEntries[1].errorType, 'TypeError');
  assert.equal(failureEntries[2].errorCode, 'hypothesis_generation_failed');

  const serialized = [...logs, ...failureLogs].join('\n');
  for (const forbidden of [
    tenantId,
    memberId,
    hashKey,
    'provider-secret-response',
    'route-secret-message',
    'prompt',
    'sourceUrl',
    'providerKey',
    'responseBody',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `structured event leaked ${forbidden}`);
  }

  const routeNames = [
    'deep-research',
    'hypothesis-generation',
    'experiment-design',
    'academic-writing',
    'peer-review',
  ];
  for (const routeName of routeNames) {
    const source = await readFile(path.join(process.cwd(), 'src', 'app', 'api', 'ai', routeName, 'route.ts'), 'utf8');
    assert.match(source, /createGroundedTaskObservation/, `${routeName} must create a trusted task observation`);
    assert.match(source, /observeProvider\(/, `${routeName} must instrument its real provider stream`);
    assert.match(source, /taskObservation\.(running|succeeded|failed|cancelled)/, `${routeName} must log real lifecycle states`);
  }

  const serverSource = await readFile(path.join(process.cwd(), 'src', 'server.ts'), 'utf8');
  assert.match(serverSource, /operationalObservabilityStatus/);
  assert.match(serverSource, /exitCode: 78/);

  for (const relativePath of ['src/lib/runtime-ai-http.ts', 'src/lib/ai-service.ts']) {
    const providerSource = await readFile(path.join(process.cwd(), relativePath), 'utf8');
    assert.doesNotMatch(
      providerSource,
      /console\.(?:warn|error)\([^\n]*(?:error\.message|String\(error)/,
      `${relativePath} must not log raw provider errors`,
    );
  }

  console.log('KnowTrail grounded operational observability contract passed');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
