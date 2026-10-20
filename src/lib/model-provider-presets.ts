import type { RuntimeAIConfig } from '@/types';

export const MODEL_PROVIDER_PRESETS = [
  { id: 'aliyun-bailian', label: '百炼', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash', image: 'qwen-image-3.0-pro', tts: 'qwen-audio-3.0-tts-plus' },
  { id: 'moonshot', label: 'Kimi', apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', image: '', tts: '' },
  { id: 'deepseek', label: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1', model: 'deepseek-flash', image: '', tts: '' },
  { id: 'zhipu', label: '智谱 GLM', apiBase: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', image: '', tts: '' },
  { id: 'siliconflow', label: '硅基流动', apiBase: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3.6-27B', image: '', tts: '' },
  { id: 'volcengine', label: '豆包 / 火山方舟', apiBase: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-1-pro-260915', image: '', tts: '' },
  { id: 'minimax', label: 'MiniMax', apiBase: 'https://api.minimax.cn/v1', model: 'MiniMax-M3.1-Flash', image: '', tts: '' },
] as const;
export type ModelProviderId = typeof MODEL_PROVIDER_PRESETS[number]['id'];
export function modelProviderPreset(id: string) {
  const preset = MODEL_PROVIDER_PRESETS.find(item => item.id === id);
  if (!preset) throw new Error('不支持的模型服务。');
  return preset;
}
export function providerCapabilityUnavailable(config: Partial<RuntimeAIConfig>, operation: string): boolean {
  const preset = MODEL_PROVIDER_PRESETS.find(item => item.id === config.providerId);
  return Boolean(preset && (preset.id !== 'aliyun-bailian' || !config.workspaceId)) && ['ppt', 'ppt-slide-revise', 'scientific-illustration', 'tts', 'podcast'].includes(operation);
}
