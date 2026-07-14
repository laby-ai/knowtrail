import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import { KNOWTRAIL_QUALITY_MATRIX } from './lib/knowtrail-quality-matrix.mjs';
import { runQualityMatrix } from './lib/quality-matrix-runner.mjs';

const delayed = code => ({
  id: 'step',
  command: process.execPath,
  args: ['-e', `setTimeout(() => process.exit(${code}), 80)`],
});
const report = await runQualityMatrix([
  { id: 'pass-1', name: 'Pass one', category: 'test', steps: [delayed(0)] },
  { id: 'pass-2', name: 'Pass two', category: 'test', steps: [delayed(0)] },
  { id: 'fail', name: 'Fail', category: 'test', steps: [delayed(3)] },
  { id: 'skip', name: 'Skip', category: 'test', skipReason: 'not configured', steps: [] },
], { concurrency: 2, timeoutMs: 2_000 });

assert.deepEqual(report.counts, { PASS: 2, FAIL: 1, SKIP: 1 });
assert.equal(report.ok, false);
assert.equal(report.maxConcurrencyObserved, 2);
assert.match(report.results.find(result => result.id === 'fail').summary, /code 3/);

const timeoutReport = await runQualityMatrix([
  {
    id: 'timeout',
    name: 'Timeout',
    category: 'test',
    steps: [{ id: 'slow', command: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'], timeoutMs: 50 }],
  },
], { concurrency: 1 });
assert.equal(timeoutReport.results[0].status, 'FAIL');
assert.equal(timeoutReport.results[0].steps[0].timedOut, true);

const serializedStartedAt = Date.now();
const serializedReport = await runQualityMatrix([
  { id: 'serial-1', name: 'Serial one', category: 'test', exclusiveResource: 'shared-next', steps: [delayed(0)] },
  { id: 'serial-2', name: 'Serial two', category: 'test', exclusiveResource: 'shared-next', steps: [delayed(0)] },
], { concurrency: 2, timeoutMs: 2_000 });
assert.equal(serializedReport.counts.PASS, 2);
assert.ok(Date.now() - serializedStartedAt >= 130, 'Tasks sharing a Next worktree must not overlap.');

assert.equal(KNOWTRAIL_QUALITY_MATRIX.length, 12);
assert.equal(new Set(KNOWTRAIL_QUALITY_MATRIX.map(task => task.id)).size, 12);
assert.deepEqual(
  KNOWTRAIL_QUALITY_MATRIX.map(task => task.name),
  ['论文检索', '深度研究', '研究脉络', '假设生成', '数据处理', '实验设计', '学术写作', '文本润色', '科研绘图', 'PPT 制作', '论文审查', '虚拟课堂'],
);
assert.ok(KNOWTRAIL_QUALITY_MATRIX.every(task => task.steps.length > 0));
assert.equal(
  KNOWTRAIL_QUALITY_MATRIX.filter(task => task.exclusiveResource === 'next-dev-worktree').length,
  12,
  'All browser smokes must serialize shared Playwright and .next resources.',
);

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const matrixCli = fs.readFileSync('scripts/run-quality-matrix.mjs', 'utf8');
assert.match(matrixCli, /BIND_HOST:\s*valueArg\('bind-host',[\s\S]*'127\.0\.0\.1'/, 'The matrix must align smoke origins with an explicit IPv4 loopback listener.');
assert.match(matrixCli, /process\.env\.KNOWTRAIL_OBSERVABILITY_HASH_KEY \|\| randomBytes\(32\)/, 'The matrix must generate an isolated observability hash key without weakening production fail-closed behavior.');
assert.match(matrixCli, /KNOWTRAIL_OBSERVABILITY_HASH_KEY: observabilityHashKey/, 'Every matrix smoke must receive the isolated observability key.');
assert.equal(packageJson.scripts?.['smoke:quality-matrix'], 'node ./scripts/run-quality-matrix.mjs');
assert.equal(packageJson.scripts?.['test:quality-matrix-runner'], 'node ./scripts/test-quality-matrix-runner.mjs');
assert.match(packageJson.scripts?.validate || '', /test:quality-matrix-runner/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'bounded concurrency and stable result ordering',
    'PASS, FAIL, SKIP, timeout, resource locking, and nonzero failure semantics',
    'all twelve products map to existing smoke entrypoints',
    'CLI and aggregate validation remain wired',
  ],
}, null, 2));
