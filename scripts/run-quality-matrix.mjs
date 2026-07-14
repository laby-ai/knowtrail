import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { KNOWTRAIL_QUALITY_MATRIX } from './lib/knowtrail-quality-matrix.mjs';
import { runQualityMatrix } from './lib/quality-matrix-runner.mjs';

function valueArg(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const selectedIds = valueArg('products', '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const tasks = selectedIds.length
  ? KNOWTRAIL_QUALITY_MATRIX.filter(task => selectedIds.includes(task.id))
  : KNOWTRAIL_QUALITY_MATRIX;
const unknownIds = selectedIds.filter(id => !tasks.some(task => task.id === id));
if (unknownIds.length) {
  console.error(`Unknown products: ${unknownIds.join(', ')}`);
  process.exit(2);
}

const outputPath = path.resolve(valueArg('output', 'output/quality-matrix/latest.json'));
const observabilityHashKey = process.env.KNOWTRAIL_OBSERVABILITY_HASH_KEY || randomBytes(32).toString('hex');
const report = await runQualityMatrix(tasks, {
  concurrency: Number(valueArg('concurrency', process.env.KNOWTRAIL_MATRIX_CONCURRENCY || '2')),
  timeoutMs: Number(valueArg('timeout-ms', process.env.KNOWTRAIL_MATRIX_TIMEOUT_MS || '240000')),
  cwd: process.cwd(),
  env: {
    BIND_HOST: valueArg('bind-host', process.env.KNOWTRAIL_MATRIX_BIND_HOST || '127.0.0.1'),
    KNOWTRAIL_OBSERVABILITY_HASH_KEY: observabilityHashKey,
  },
});

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

console.log('');
console.log('KnowTrail quality matrix');
console.log('STATUS  DURATION  CATEGORY  PRODUCT');
for (const result of report.results) {
  console.log(`${result.status.padEnd(6)}  ${String(Math.round(result.durationMs / 1000)).padStart(6)}s  ${result.category.padEnd(8)}  ${result.name}`);
  if (result.status === 'FAIL') console.log(`        ${result.summary}`);
}
console.log('');
console.log(JSON.stringify({
  ok: report.ok,
  counts: report.counts,
  durationMs: report.durationMs,
  concurrency: report.concurrency,
  outputPath,
}, null, 2));

if (!report.ok) process.exit(1);
