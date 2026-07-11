import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function tail(value, limit = 6000) {
  return value.length <= limit ? value : value.slice(-limit);
}

export async function runMatrixStep(step, options = {}) {
  const timeoutMs = step.timeoutMs || options.timeoutMs || 180_000;
  const startedAt = Date.now();
  return new Promise(resolve => {
    const output = [];
    let timedOut = false;
    const child = spawn(step.command, step.args || [], {
      cwd: step.cwd || options.cwd || process.cwd(),
      env: { ...process.env, ...options.env, ...step.env },
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      resolve({
        id: step.id,
        status: 'FAIL',
        durationMs: Date.now() - startedAt,
        exitCode: null,
        timedOut,
        summary: error.message,
        outputTail: tail(output.join('')),
      });
    });
    child.once('exit', code => {
      clearTimeout(timer);
      const text = output.join('');
      resolve({
        id: step.id,
        status: code === 0 && !timedOut ? 'PASS' : 'FAIL',
        durationMs: Date.now() - startedAt,
        exitCode: code,
        timedOut,
        summary: timedOut ? `Timed out after ${timeoutMs}ms` : code === 0 ? 'Passed' : `Exited with code ${code}`,
        outputTail: tail(text),
      });
    });
  });
}

async function runProduct(task, options) {
  const startedAt = Date.now();
  if (task.skipReason) {
    return {
      id: task.id,
      name: task.name,
      category: task.category,
      status: 'SKIP',
      durationMs: 0,
      summary: task.skipReason,
      steps: [],
    };
  }
  const steps = [];
  for (const step of task.steps) {
    const result = await runMatrixStep(step, options);
    steps.push(result);
    if (result.status === 'FAIL') {
      return {
        id: task.id,
        name: task.name,
        category: task.category,
        status: 'FAIL',
        durationMs: Date.now() - startedAt,
        summary: `${step.id}: ${result.summary}`,
        steps,
      };
    }
  }
  return {
    id: task.id,
    name: task.name,
    category: task.category,
    status: 'PASS',
    durationMs: Date.now() - startedAt,
    summary: `${steps.length} checks passed`,
    steps,
  };
}

export async function runQualityMatrix(tasks, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || 2);
  const startedAt = new Date();
  const results = new Array(tasks.length);
  let cursor = 0;
  let active = 0;
  let maxConcurrencyObserved = 0;
  const resourceTails = new Map();

  async function withExclusiveResource(resource, callback) {
    if (!resource) return callback();
    const previous = resourceTails.get(resource) || Promise.resolve();
    let release;
    const current = new Promise(resolve => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    resourceTails.set(resource, queued);
    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (resourceTails.get(resource) === queued) resourceTails.delete(resource);
    }
  }

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      active += 1;
      maxConcurrencyObserved = Math.max(maxConcurrencyObserved, active);
      try {
        results[index] = await withExclusiveResource(
          tasks[index].exclusiveResource,
          () => runProduct(tasks[index], options),
        );
      } finally {
        active -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  const counts = results.reduce((acc, result) => {
    acc[result.status] += 1;
    return acc;
  }, { PASS: 0, FAIL: 0, SKIP: 0 });
  return {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    concurrency,
    maxConcurrencyObserved,
    counts,
    ok: counts.FAIL === 0,
    results,
  };
}
