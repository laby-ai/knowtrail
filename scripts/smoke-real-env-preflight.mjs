import './lib/load-real-env.mjs';

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return { name: '', value: '' };
}

function present(name, value) {
  return {
    name,
    configured: Boolean(value?.trim()),
  };
}

function visible(name, value) {
  return {
    name,
    configured: Boolean(value?.trim()),
    value: value?.trim() || '',
  };
}

function secret(name, value) {
  return {
    name,
    configured: Boolean(value?.trim()),
    value: value?.trim() ? '[REDACTED]' : '',
  };
}

function collect() {
  const apiBase = envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE');
  const apiKey = envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY');
  const model = envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL');
  const visionModel = envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL');
  const imageBase = envFirst('OPENAI_COMPAT_IMAGE_API_BASE', 'ARK_IMAGE_API_BASE', 'ARK_API_BASE');
  const imageKey = envFirst('OPENAI_COMPAT_IMAGE_API_KEY', 'ARK_IMAGE_API_KEY', 'ARK_AGENTPLAN_API_KEY', 'ARK_API_KEY');
  const imageModel = envFirst('OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL');
  const resolvedImageModel = imageModel.value
    ? imageModel
    : { name: 'default ARK_IMAGE_MODEL', value: 'doubao-seedream-5-0-lite-260128' };
  const embeddingModel = envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL');
  const ttsKey = envFirst('AGENTPLAN_TTS_API_KEY', 'DOUBAO_TTS_API_KEY', 'AGENTPLAN_TTS_API_KEY', 'ARK_AGENTPLAN_API_KEY');
  const ttsSpeaker = envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'AGENTPLAN_TTS_SPEAKER', 'ARK_TTS_SPEAKER');
  const useExperimentalPodcast = process.env.PODCAST_AUDIO_PROVIDER?.trim() === 'volcengine-podcast';

  const modelService = [
    visible(apiBase.name || 'OPENAI_COMPAT_API_BASE or ARK_API_BASE', apiBase.value),
    secret(apiKey.name || 'OPENAI_COMPAT_API_KEY or ARK_API_KEY', apiKey.value),
    visible(model.name || 'OPENAI_COMPAT_MODEL or ARK_MODEL', model.value),
    visible(visionModel.name || 'OPENAI_COMPAT_VISION_MODEL or ARK_VISION_MODEL', visionModel.value),
    visible(embeddingModel.name || 'OPENAI_COMPAT_EMBEDDING_MODEL or ARK_EMBEDDING_MODEL', embeddingModel.value),
  ];

  const doubaoTts = [
    visible('AGENTPLAN_TTS_ENDPOINT', process.env.AGENTPLAN_TTS_ENDPOINT || process.env.DOUBAO_TTS_ENDPOINT || process.env.AGENTPLAN_TTS_ENDPOINT || 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional'),
    visible('AGENTPLAN_TTS_RESOURCE_ID', process.env.AGENTPLAN_TTS_RESOURCE_ID || process.env.DOUBAO_TTS_RESOURCE_ID || process.env.AGENTPLAN_TTS_RESOURCE_ID || 'seed-tts-2.0'),
    secret(ttsKey.name || 'AGENTPLAN_TTS_API_KEY', ttsKey.value),
    present(ttsSpeaker.name || 'AGENTPLAN_TTS_SPEAKER or DOUBAO_TTS_SPEAKER', ttsSpeaker.value),
    visible('AGENTPLAN_TTS_FORMAT', process.env.AGENTPLAN_TTS_FORMAT || process.env.DOUBAO_TTS_FORMAT || process.env.AGENTPLAN_TTS_FORMAT || 'mp3'),
    visible('AGENTPLAN_TTS_SAMPLE_RATE', process.env.AGENTPLAN_TTS_SAMPLE_RATE || process.env.DOUBAO_TTS_SAMPLE_RATE || process.env.AGENTPLAN_TTS_SAMPLE_RATE || '24000'),
  ];
  const imageService = [
    visible(imageBase.name || 'OPENAI_COMPAT_IMAGE_API_BASE, ARK_IMAGE_API_BASE, or ARK_API_BASE', imageBase.value),
    secret(imageKey.name || 'OPENAI_COMPAT_IMAGE_API_KEY, ARK_IMAGE_API_KEY, ARK_AGENTPLAN_API_KEY, or ARK_API_KEY', imageKey.value),
    visible(resolvedImageModel.name, resolvedImageModel.value),
  ];
  const experimentalProviders = {
    volcenginePodcast: useExperimentalPodcast
      ? [
          visible('VOLCENGINE_PODCAST_WS_ENDPOINT', process.env.VOLCENGINE_PODCAST_WS_ENDPOINT),
          visible('VOLCENGINE_PODCAST_APP_ID', process.env.VOLCENGINE_PODCAST_APP_ID),
          secret('VOLCENGINE_PODCAST_ACCESS_KEY', process.env.VOLCENGINE_PODCAST_ACCESS_KEY),
          visible('VOLCENGINE_PODCAST_RESOURCE_ID', process.env.VOLCENGINE_PODCAST_RESOURCE_ID),
          visible('VOLCENGINE_PODCAST_APP_KEY', process.env.VOLCENGINE_PODCAST_APP_KEY),
          visible('VOLCENGINE_PODCAST_SPEAKERS', process.env.VOLCENGINE_PODCAST_SPEAKERS),
        ]
      : 'disabled',
  };

  const required = [
    ...modelService.slice(0, 3),
    ...doubaoTts.slice(0, 4),
  ];
  const missingRequired = required
    .filter(item => !item.configured)
    .map(item => item.name);

  return {
    ok: missingRequired.length === 0,
    readyForRealModelSmoke: modelService.slice(0, 3).every(item => item.configured),
    readyForRealImagePptSmoke: imageService.every(item => item.configured),
    readyForRealPodcastAudioSmoke: doubaoTts.slice(0, 4).every(item => item.configured),
    modelService,
    imageService,
    doubaoTts,
    experimentalProviders,
    missingRequired,
    notes: [
      'Keys are never printed; configured secrets are shown only as [REDACTED].',
      'Put real values in process env or private .env.real.local; do not commit .env.real.local.',
      'Doubao AgentPlan TTS is the default podcast audio path. Use AGENTPLAN_TTS_* for new local configs.',
      'Image PPT uses image-specific keys first: OPENAI_COMPAT_IMAGE_API_KEY, ARK_IMAGE_API_KEY, then ARK_AGENTPLAN_API_KEY.',
      'VolcEngine Podcast WebSocket is experimental and checked only when PODCAST_AUDIO_PROVIDER=volcengine-podcast.',
    ],
  };
}

const result = collect();
console.log(JSON.stringify(result, null, 2));

if (!result.ok && process.env.REAL_ENV_PREFLIGHT_STRICT === 'true') {
  process.exit(1);
}
