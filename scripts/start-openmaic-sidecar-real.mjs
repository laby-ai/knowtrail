import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const root = process.cwd();
const openmaicRoot = path.join(root, '.references', 'OpenMAIC');
const envPath = path.join(root, '.env.real.local');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: true });

const standaloneRoot = path.join(openmaicRoot, '.next', 'standalone');
const nestedStandaloneApp = path.join(standaloneRoot, '.references', 'OpenMAIC');
const standaloneApp = fs.existsSync(path.join(nestedStandaloneApp, 'server.js'))
  ? nestedStandaloneApp
  : standaloneRoot;
const serverEntry = path.join(standaloneApp, 'server.js');
if (!fs.existsSync(serverEntry)) {
  throw new Error(`OpenMAIC standalone server is missing: ${serverEntry}`);
}

fs.mkdirSync(path.join(standaloneApp, '.next'), { recursive: true });
fs.cpSync(path.join(openmaicRoot, '.next', 'static'), path.join(standaloneApp, '.next', 'static'), {
  recursive: true,
  force: true,
});
fs.cpSync(path.join(openmaicRoot, 'public'), path.join(standaloneApp, 'public'), {
  recursive: true,
  force: true,
});

const agentPlanKey = process.env.ARK_AGENTPLAN_API_KEY || '';
const agentPlanBase = process.env.ARK_AGENTPLAN_API_BASE || 'https://ark.cn-beijing.volces.com/api/plan/v3';
const agentPlanModel = process.env.ARK_AGENTPLAN_TEXT_MODEL || 'glm-5.2';
if (!agentPlanKey) {
  throw new Error('ARK_AGENTPLAN_API_KEY is required to start the virtual classroom sidecar with the real server provider.');
}

const port = process.env.OPENMAIC_SIDECAR_PORT || '5025';
const host = process.env.OPENMAIC_SIDECAR_HOST || '127.0.0.1';
const frameAncestors = process.env.ALLOWED_FRAME_ANCESTORS || 'http://127.0.0.1:5014';
const defaultModel = process.env.OPENMAIC_DEFAULT_MODEL || `glm:${agentPlanModel}`;
const modelRoutes =
  process.env.MODEL_ROUTES ||
  JSON.stringify({
    'generate-classroom': `glm:${agentPlanModel}`,
    'scene-outlines-stream': `glm:${agentPlanModel}`,
    'scene-content': `glm:${agentPlanModel}`,
    'scene-actions': `glm:${agentPlanModel}`,
    'agent-profiles': `glm:${agentPlanModel}`,
  });

console.log(JSON.stringify({
  service: 'openmaic-sidecar',
  host,
  port,
  frameAncestors,
  defaultModel,
  provider: 'glm',
  model: agentPlanModel,
  videoGeneration: false,
}));

const child = spawn(process.execPath, [serverEntry], {
  cwd: openmaicRoot,
  env: {
    ...process.env,
    PORT: port,
    HOSTNAME: host,
    ALLOWED_FRAME_ANCESTORS: frameAncestors,
    DEFAULT_MODEL: defaultModel,
    GLM_API_KEY: process.env.GLM_API_KEY || agentPlanKey,
    GLM_BASE_URL: process.env.GLM_BASE_URL || agentPlanBase,
    GLM_MODELS: process.env.GLM_MODELS || agentPlanModel,
    MODEL_ROUTES: modelRoutes,
    ENABLE_VIDEO_GENERATION: 'false',
  },
  stdio: 'inherit',
  shell: false,
});

child.on('exit', code => {
  process.exit(code ?? 1);
});
