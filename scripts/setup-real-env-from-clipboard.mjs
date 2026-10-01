import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const target = '.env.real.local';

function readClipboard() {
  const commands = process.platform === 'win32'
    ? [{ command: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-Clipboard -Raw'] }]
    : process.platform === 'darwin'
      ? [{ command: 'pbpaste', args: [] }]
      : [
          { command: 'wl-paste', args: [] },
          { command: 'xclip', args: ['-selection', 'clipboard', '-o'] },
        ];

  for (const item of commands) {
    const result = spawnSync(item.command, item.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const value = result.stdout?.trim();
    if (result.status === 0 && value) return value;
  }
  return '';
}

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    values.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  return values;
}

function serializeEnv(values) {
  const orderedKeys = [
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
  return [
    '# Private local file for real smoke tests. Do not commit.',
    ...orderedKeys.map(key => `${key}=${values.get(key) || ''}`),
    '',
  ].join('\n');
}

const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
const values = parseEnv(existing);
const clipboard = readClipboard();
const arkKey = clipboard.match(/ark-[A-Za-z0-9-]{20,}/)?.[0] || '';
const agentPlanKey = clipboard.match(/\b(?:api-key-[0-9A-Za-z-]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/)?.[0] || '';

if (!arkKey && !values.get('ARK_API_KEY')) {
  console.log(JSON.stringify({
    ok: false,
    wrote: false,
    reason: 'Clipboard does not contain an ark-* key and .env.real.local has no ARK_API_KEY.',
    next: 'Copy the Ark key to clipboard, then run pnpm setup:real-env-from-clipboard.',
  }, null, 2));
  process.exit(1);
}

if (arkKey) {
  values.set('ARK_API_KEY', arkKey);
  values.set('ARK_AGENTPLAN_API_KEY', arkKey);
}

if (agentPlanKey) {
  values.set('AGENTPLAN_TTS_API_KEY', agentPlanKey);
}

if (!values.get('ARK_API_BASE')) values.set('ARK_API_BASE', 'https://ark.cn-beijing.volces.com/api/v3');
if (!values.get('ARK_MODEL')) values.set('ARK_MODEL', 'doubao-seed-1-6-251015');
if (!values.get('ARK_VISION_MODEL')) values.set('ARK_VISION_MODEL', 'doubao-seed-1-6-vision-250815');
if (!values.has('ARK_EMBEDDING_MODEL')) values.set('ARK_EMBEDDING_MODEL', '');
if (!values.get('ARK_AGENTPLAN_API_BASE')) values.set('ARK_AGENTPLAN_API_BASE', 'https://ark.cn-beijing.volces.com/api/plan/v3');
if (!values.get('ARK_AGENTPLAN_TEXT_MODEL')) values.set('ARK_AGENTPLAN_TEXT_MODEL', 'glm-5.2');
if (!values.get('AGENTPLAN_TTS_ENDPOINT')) values.set('AGENTPLAN_TTS_ENDPOINT', 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional');
if (!values.get('AGENTPLAN_TTS_RESOURCE_ID')) values.set('AGENTPLAN_TTS_RESOURCE_ID', 'seed-tts-2.0');
if (!values.get('AGENTPLAN_TTS_FORMAT')) values.set('AGENTPLAN_TTS_FORMAT', 'mp3');
if (!values.get('AGENTPLAN_TTS_SAMPLE_RATE')) values.set('AGENTPLAN_TTS_SAMPLE_RATE', '24000');
if (!values.get('AGENTPLAN_TTS_TIMEOUT_MS')) values.set('AGENTPLAN_TTS_TIMEOUT_MS', '90000');
if (!values.get('REAL_STUDIO_INCLUDE_PPT')) values.set('REAL_STUDIO_INCLUDE_PPT', 'true');

writeFileSync(target, serializeEnv(values), 'utf8');

console.log(JSON.stringify({
  ok: true,
  wrote: target,
  configured: {
    arkApiBase: Boolean(values.get('ARK_API_BASE')),
    arkApiKey: Boolean(values.get('ARK_API_KEY')),
    arkModel: Boolean(values.get('ARK_MODEL')),
    arkVisionModel: Boolean(values.get('ARK_VISION_MODEL')),
    arkEmbeddingModel: Boolean(values.get('ARK_EMBEDDING_MODEL')),
    arkAgentPlanBase: Boolean(values.get('ARK_AGENTPLAN_API_BASE')),
    arkAgentPlanKey: Boolean(values.get('ARK_AGENTPLAN_API_KEY')),
    arkAgentPlanTextModel: Boolean(values.get('ARK_AGENTPLAN_TEXT_MODEL')),
    agentPlanTtsEndpoint: Boolean(values.get('AGENTPLAN_TTS_ENDPOINT')),
    agentPlanTtsResourceId: Boolean(values.get('AGENTPLAN_TTS_RESOURCE_ID')),
    agentPlanTtsKey: Boolean(values.get('AGENTPLAN_TTS_API_KEY')),
    agentPlanTtsSpeaker: Boolean(values.get('AGENTPLAN_TTS_SPEAKER')),
  },
  notes: [
    'Secrets were read from clipboard or existing private env and were not printed.',
    'Ark OpenAI-compatible chat uses https://ark.cn-beijing.volces.com/api/v3. Agent Plan /api/plan/v3 is not used as the chat base.',
    'Podcast smoke now uses Doubao AgentPlan TTS by default. AGENTPLAN_TTS_API_KEY must be the Agent Plan TTS key, not the Ark chat key.',
    'VolcEngine Podcast WebSocket fields are preserved only if already present; this setup command no longer seeds them by default.',
  ],
}, null, 2));
