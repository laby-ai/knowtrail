import process from 'node:process';
import { validateReleaseHealth } from './lib/release-env-gate.mjs';

const origin = (process.argv[2] || process.env.RELEASE_HEALTH_ORIGIN || '').replace(/\/$/, '');
const sharedRoot = process.argv[3] || process.env.RELEASE_SHARED_ROOT || '/opt/knowtrail/shared';
if (!origin) {
  console.error('Usage: node scripts/verify-release-health.mjs <origin> [shared-root]');
  process.exit(2);
}

try {
  const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
  console.log(JSON.stringify(validateReleaseHealth(body, { sharedRoot }), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
