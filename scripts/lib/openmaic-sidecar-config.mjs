function readProfile(env, source, keyName, baseName, modelName) {
  const apiKey = String(env[keyName] || '').trim();
  const baseUrl = String(env[baseName] || '').trim();
  const model = String(env[modelName] || '').split(',')[0].trim();
  if (!apiKey || !baseUrl || !model) return null;
  return { source, apiKey, baseUrl, model };
}

export function resolveOpenMaicBridgeConfig(env = process.env) {
  const selected = [
    readProfile(env, 'openmaic-explicit', 'OPENMAIC_API_KEY', 'OPENMAIC_API_BASE', 'OPENMAIC_TEXT_MODEL'),
    readProfile(env, 'glm-explicit', 'GLM_API_KEY', 'GLM_BASE_URL', 'GLM_MODELS'),
    readProfile(env, 'standard-ark', 'ARK_API_KEY', 'ARK_API_BASE', 'ARK_MODEL'),
    readProfile(env, 'agent-plan', 'ARK_AGENTPLAN_API_KEY', 'ARK_AGENTPLAN_API_BASE', 'ARK_AGENTPLAN_TEXT_MODEL'),
  ].find(Boolean);

  if (!selected) {
    throw new Error(
      'OpenMAIC sidecar needs one complete provider profile: '
      + 'OPENMAIC_API_KEY + OPENMAIC_API_BASE + OPENMAIC_TEXT_MODEL, '
      + 'GLM_API_KEY + GLM_BASE_URL + GLM_MODELS, '
      + 'ARK_API_KEY + ARK_API_BASE + ARK_MODEL, or '
      + 'ARK_AGENTPLAN_API_KEY + ARK_AGENTPLAN_API_BASE + ARK_AGENTPLAN_TEXT_MODEL.',
    );
  }

  const routedModel = `glm:${selected.model}`;
  return {
    ...selected,
    defaultModel: routedModel,
    modelRoutes: {
      'generate-classroom': routedModel,
      'scene-outlines-stream': routedModel,
      'scene-content': routedModel,
      'scene-actions': routedModel,
      'agent-profiles': routedModel,
    },
  };
}
