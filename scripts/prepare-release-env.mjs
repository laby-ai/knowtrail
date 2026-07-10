import process from 'node:process';
import { prepareReleaseEnvironment } from './lib/release-env-gate.mjs';

const sourcePath = process.argv[2] || process.env.RELEASE_ENV_SOURCE;
const targetPath = process.argv[3] || process.env.RELEASE_ENV_TARGET;
if (!sourcePath || !targetPath) {
  console.error('Usage: node scripts/prepare-release-env.mjs <stable-env-file> <target-env-file>');
  process.exit(2);
}

try {
  console.log(JSON.stringify(await prepareReleaseEnvironment({ sourcePath, targetPath }), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
