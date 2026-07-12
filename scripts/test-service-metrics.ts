import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ServiceMetrics, metricsRoute, trustedMetricsRequest } from '../src/lib/service-metrics';

async function main() {
const metrics = new ServiceMetrics('knowtrail');
await Promise.all(Array.from({ length: 100 }, async (_, index) => {
  metrics.observeHttp('GET', '/api/health', index < 95 ? 200 : 503, 0.01);
}));
metrics.observeOperation('grounded_task', 'running');
metrics.observeOperation('grounded_task', 'failed', 0.5);
metrics.observeOperation('model_provider', 'started');
metrics.observeOperation('model_provider', 'succeeded', 0.25);

const body = metrics.render();
assert.match(body, /stoneai_http_requests_total\{method="GET",route="\/api\/health",service="knowtrail",status_class="2xx"\} 95/);
assert.match(body, /status_class="5xx"\} 5/);
assert.match(body, /stoneai_http_request_duration_seconds_(count|sum)/);
assert.match(body, /operation="grounded_task"/);
assert.match(body, /operation="model_provider"/);
assert.match(body, /stoneai_operation_duration_seconds_(count|sum)/);
assert.equal(metricsRoute('/api/ai/deep-research?member=raw'), '/api/ai');
assert.equal(metricsRoute('/uploads/private-id/file.png'), '/runtime-file');
assert.equal(metricsRoute('/attacker/raw-id'), '/unmatched');
assert.equal(trustedMetricsRequest('127.0.0.1', undefined, undefined), true);
assert.equal(trustedMetricsRequest('127.0.0.1', '203.0.113.5', undefined), false);
assert.equal(trustedMetricsRequest('203.0.113.5', undefined, undefined), false);
for (const forbidden of ['requestId', 'tenantRef', 'memberRef', 'taskRef', 'raw-id', 'prompt', 'url=', 'providerKey']) {
  assert.equal(body.includes(forbidden), false, forbidden);
}
const serverSource = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
assert.match(serverSource, /\/api\/metrics/);
assert.match(serverSource, /trustedMetricsRequest/);
console.log(JSON.stringify({ status: 'pass', service: 'knowtrail', requests: 100, errors: 5 }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
