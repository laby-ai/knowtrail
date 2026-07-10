import assert from 'node:assert/strict';
import { resolveOpenMaicBridgeConfig } from './lib/openmaic-sidecar-config.mjs';

const standard = resolveOpenMaicBridgeConfig({
  ARK_API_KEY: 'standard-key',
  ARK_API_BASE: 'https://standard.example/v3',
  ARK_MODEL: 'standard-model',
  ARK_AGENTPLAN_API_KEY: 'agent-key',
  ARK_AGENTPLAN_API_BASE: 'https://agent.example/v3',
  ARK_AGENTPLAN_TEXT_MODEL: 'agent-model',
});
assert.equal(standard.source, 'standard-ark');
assert.equal(standard.apiKey, 'standard-key');
assert.equal(standard.baseUrl, 'https://standard.example/v3');
assert.equal(standard.model, 'standard-model');

const explicit = resolveOpenMaicBridgeConfig({
  OPENMAIC_API_KEY: 'explicit-key',
  OPENMAIC_API_BASE: 'https://explicit.example/v3',
  OPENMAIC_TEXT_MODEL: 'explicit-model',
  ARK_API_KEY: 'standard-key',
  ARK_API_BASE: 'https://standard.example/v3',
  ARK_MODEL: 'standard-model',
});
assert.equal(explicit.source, 'openmaic-explicit');
assert.equal(explicit.model, 'explicit-model');

const fallback = resolveOpenMaicBridgeConfig({
  ARK_API_KEY: 'incomplete-standard-key',
  ARK_API_BASE: 'https://standard.example/v3',
  ARK_AGENTPLAN_API_KEY: 'agent-key',
  ARK_AGENTPLAN_API_BASE: 'https://agent.example/v3',
  ARK_AGENTPLAN_TEXT_MODEL: 'agent-model',
});
assert.equal(fallback.source, 'agent-plan');
assert.equal(fallback.model, 'agent-model');

assert.equal(standard.defaultModel, 'glm:standard-model');
assert.deepEqual(Object.keys(standard.modelRoutes).sort(), [
  'agent-profiles',
  'generate-classroom',
  'scene-actions',
  'scene-content',
  'scene-outlines-stream',
]);
assert(Object.values(standard.modelRoutes).every(value => value === 'glm:standard-model'));

assert.throws(
  () => resolveOpenMaicBridgeConfig({ ARK_API_KEY: 'partial-only' }),
  error => error instanceof Error
    && error.message.includes('OPENMAIC_API_BASE')
    && error.message.includes('GLM_BASE_URL')
    && !error.message.includes('partial-only'),
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'complete standard Ark configuration wins over AgentPlan fallback',
    'explicit OpenMAIC configuration wins over standard Ark',
    'incomplete standard Ark configuration falls back as a cohesive profile',
    'all classroom generation routes use the selected model',
    'missing configuration reports variable names without secret values',
  ],
}, null, 2));
