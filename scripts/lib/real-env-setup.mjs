const ORDERED_KEYS = [
  'OPENAI_COMPAT_API_BASE',
  'OPENAI_COMPAT_API_KEY',
  'OPENAI_COMPAT_MODEL',
  'SITIAN_API_BASE',
  'SITIAN_API_TOKEN',
  'SITIAN_IMAGE_PROVIDER_REQUIRED',
  'ARK_API_BASE',
  'ARK_API_KEY',
  'ARK_MODEL',
  'ARK_VISION_MODEL',
  'ARK_EMBEDDING_MODEL',
  'ARK_AGENTPLAN_API_BASE',
  'ARK_AGENTPLAN_API_KEY',
  'ARK_AGENTPLAN_TEXT_MODEL',
  'VOLCENGINE_PODCAST_WS_ENDPOINT',
  'VOLCENGINE_PODCAST_APP_ID',
  'VOLCENGINE_PODCAST_ACCESS_KEY',
  'VOLCENGINE_PODCAST_RESOURCE_ID',
  'VOLCENGINE_PODCAST_APP_KEY',
  'VOLCENGINE_PODCAST_SPEAKERS',
  'VOLCENGINE_PODCAST_FORMAT',
  'VOLCENGINE_PODCAST_SAMPLE_RATE',
  'VOLCENGINE_PODCAST_TIMEOUT_MS',
  'AGENTPLAN_TTS_ENDPOINT',
  'AGENTPLAN_TTS_RESOURCE_ID',
  'AGENTPLAN_TTS_API_KEY',
  'AGENTPLAN_TTS_SPEAKER',
  'AGENTPLAN_TTS_FORMAT',
  'AGENTPLAN_TTS_SAMPLE_RATE',
  'AGENTPLAN_TTS_TIMEOUT_MS',
  'REAL_STUDIO_INCLUDE_PPT',
];

export function applyClipboardModelSecrets(values, clipboard) {
  const bailianKey = clipboard.match(/\bsk-[A-Za-z0-9_-]{20,}\b/)?.[0] || '';
  const sitianToken = clipboard.match(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/)?.[0] || '';

  if (bailianKey) {
    values.set('OPENAI_COMPAT_API_BASE', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    values.set('OPENAI_COMPAT_API_KEY', bailianKey);
    values.set('OPENAI_COMPAT_MODEL', 'qwen3.7-plus');
  }
  if (sitianToken) {
    values.set('SITIAN_API_BASE', 'https://images.sitianai.com');
    values.set('SITIAN_API_TOKEN', sitianToken);
    values.set('SITIAN_IMAGE_PROVIDER_REQUIRED', 'true');
  }

  return {
    bailianConfigured: Boolean(bailianKey || values.get('OPENAI_COMPAT_API_KEY')),
    sitianConfigured: Boolean(sitianToken || values.get('SITIAN_API_TOKEN')),
  };
}

export function serializePrivateEnv(values) {
  return [
    '# Private local file for real smoke tests. Do not commit.',
    ...ORDERED_KEYS.map(key => `${key}=${values.get(key) || ''}`),
    '',
  ].join('\n');
}
