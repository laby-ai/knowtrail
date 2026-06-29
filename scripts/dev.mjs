import process from 'node:process';
import { spawnPnpm } from './lib/pnpm-runner.mjs';
import './lib/load-real-env.mjs';

const workspace = process.env.APP_WORKSPACE_PATH || process.cwd();
const port = process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000';
const runtimeEnv = process.env.APP_RUNTIME_ENV || process.env.NODE_ENV || 'development';

console.log(`Starting HTTP service on port ${port} for dev (${runtimeEnv})...`);

const child = spawnPnpm(['tsx', 'watch', 'src/server.ts'], {
  cwd: workspace,
  env: {
    ...process.env,
    APP_RUNTIME_ENV: runtimeEnv,
    NODE_ENV: runtimeEnv,
    PORT: port,
    DEPLOY_RUN_PORT: port,
  },
});

child.once('error', error => {
  console.error(error.message);
  process.exit(1);
});

child.once('exit', code => {
  process.exit(code ?? 1);
});
