import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commerceAccount } from './account-client';

const directory = () => path.resolve(process.env.LINGBI_COMMERCE_OUTBOX_PATH || '.data/commerce-outbox');
type Job = { route: 'usage' | 'finalize'; body: Record<string, unknown> };
export async function enqueueCommerce(job: Job) {
  const root = directory();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const id = String(job.body.requestId || job.body.quoteId);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error('invalid_outbox_id');
  const target = path.join(root, `${job.route}-${id}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
  await rename(temporary, target);
  try { await deliver(target); } catch { /* Durable retry on subsequent requests and worker. */ }
}
async function deliver(file: string) {
  const job = JSON.parse(await readFile(file, 'utf8')) as Job;
  await commerceAccount(`internal/${job.route}`, { body: job.body, internal: true });
  await unlink(file).catch(() => undefined);
}
let draining = false;
export async function drainCommerceOutbox() {
  if (draining) return;
  draining = true;
  try {
    const root = directory();
    for (const name of (await readdir(root).catch(() => [])).filter(name => /^(usage|finalize)-[A-Za-z0-9_-]+\.json$/.test(name)).slice(0, 100)) {
      try { await deliver(path.join(root, name)); } catch { /* Keep job for next attempt. */ }
    }
  } finally { draining = false; }
}
