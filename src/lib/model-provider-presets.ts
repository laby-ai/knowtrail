import type { RuntimeAIConfig } from '@/types';

export const MODEL_PROVIDER_PRESETS = [
  { id: 'aliyun-bailian', label: '百炼', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash', image: 'qwen-image-3.0-pro', tts: 'qwen-audio-3.0-tts-plus' },
  { id: 'moonshot', label: 'Kimi', apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', image: '', tts: '' },
  { id: 'deepseek', label: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1', model: 'deepseek-flash', image: '', tts: '' },
] as const;
export type ModelProviderId = typeof MODEL_PROVIDER_PRESETS[number]['id'];
export function modelProviderPreset(id: string) {
  const preset = MODEL_PROVIDER_PRESETS.find(item => item.id === id);
  if (!preset) throw new Error('不支持的模型服务。');
  return preset;
}
export function providerCapabilityUnavailable(config: Partial<RuntimeAIConfig>, operation: string): boolean {
  return (config.providerId === 'moonshot' || config.providerId === 'deepseek' || (config.providerId === 'aliyun-bailian' && !config.workspaceId)) && ['ppt', 'ppt-slide-revise', 'scientific-illustration', 'tts', 'podcast'].includes(operation);
}
