import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';

import { observeRequest } from '../src/lib/request-observability';

type ProbeResult = { logs: string[]; requestId: string; status: number };

async function runProbe(options: { fail?: boolean; requestId?: string } = {}): Promise<ProbeResult> {
  const logs: string[] = [];
  const server = createServer((req, res) => {
    const observation = observeRequest(req, res, line => logs.push(line));
    if (options.fail) {
      observation.logError(new Error('provider-key-secret'));
      res.statusCode = 500;
    } else {
      res.statusCode = 204;
    }
    res.end();
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');

  try {
    const response = await new Promise<{ requestId: string; status: number }>((resolve, reject) => {
      const probe = request({
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path: '/api/ai/deep-research?token=query-secret',
        headers: {
          authorization: 'Bearer header-secret',
          cookie: 'session=cookie-secret',
          'content-type': 'application/json',
          ...(options.requestId ? { 'x-request-id': options.requestId } : {}),
        },
      }, incoming => {
        incoming.resume();
        incoming.on('end', () => resolve({
          requestId: String(incoming.headers['x-request-id'] || ''),
          status: incoming.statusCode || 0,
        }));
      });
      probe.on('error', reject);
      probe.end(JSON.stringify({ password: 'body-secret' }));
    });
    await new Promise(resolve => setImmediate(resolve));
    return { ...response, logs };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function main() {
  const trusted = await runProbe({ requestId: 'knowtrail-request-123' });
  assert.equal(trusted.status, 204);
  assert.equal(trusted.requestId, 'knowtrail-request-123');
  assert.equal(trusted.logs.length, 1);
  const completion = JSON.parse(trusted.logs[0]);
  assert.deepEqual(Object.keys(completion).sort(), [
    'durationMs', 'event', 'level', 'method', 'path', 'requestId', 'service', 'status', 'timestamp',
  ].sort());
  assert.equal(completion.event, 'http_request');
  assert.equal(completion.service, 'knowtrail');
  assert.equal(completion.path, '/api/ai/deep-research');
  assert.equal(completion.status, 204);

  const invalid = await runProbe({ requestId: 'bad request id forged' });
  assert.match(invalid.requestId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(invalid.requestId, 'bad request id forged');

  const failed = await runProbe({ fail: true, requestId: 'knowtrail-failure-123' });
  assert.equal(failed.status, 500);
  assert.equal(failed.logs.length, 2);
  const failure = JSON.parse(failed.logs.find(line => line.includes('http_request_error')) || '{}');
  assert.deepEqual(failure, {
    timestamp: failure.timestamp,
    level: 'error',
    service: 'knowtrail',
    event: 'http_request_error',
    requestId: 'knowtrail-failure-123',
    method: 'POST',
    path: '/api/ai/deep-research',
    errorType: 'Error',
  });

  const serialized = [...trusted.logs, ...invalid.logs, ...failed.logs].join('\n');
  for (const secret of [
    'query-secret', 'header-secret', 'cookie-secret', 'body-secret', 'provider-key-secret',
    'authorization', 'cookie', 'password',
  ]) {
    assert.equal(serialized.includes(secret), false, `structured log leaked ${secret}`);
  }

  console.log('KnowTrail request observability contract passed');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
