import type { MemberProviderProfile } from '@/lib/account-entitlement-client';

type WanImageResponse = {
  output?: {
    choices?: Array<{ message?: { content?: Array<{ image?: string; type?: string }> } }>;
  };
  code?: string;
};

function endpoint(profile: MemberProviderProfile): string {
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(profile.workspace_id)) throw new Error('百炼业务空间 ID 格式无效。');
  if (profile.region !== 'cn-beijing') throw new Error('当前仅支持百炼华北 2（北京）业务空间。');
  return `https://${profile.workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
}

function sizeForAspectRatio(aspectRatio?: string): string {
  if (aspectRatio === '4:3') return '1792*1344';
  if (aspectRatio === '1:1') return '2048*2048';
  return '2048*1152';
}

export async function generateBailianWanImage(
  prompt: string,
  profile: MemberProviderProfile,
  options?: { aspectRatio?: string; signal?: AbortSignal },
): Promise<Buffer> {
  const timeout = AbortSignal.timeout(Math.max(30_000, Number(process.env.BAILIAN_IMAGE_TIMEOUT_MS || 180_000)));
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(endpoint(profile), {
    method: 'POST',
    headers: { Authorization: `Bearer ${profile.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: profile.image_model,
      input: { messages: [{ role: 'user', content: [{ text: prompt.slice(0, 5000) }] }] },
      parameters: {
        size: sizeForAspectRatio(options?.aspectRatio),
        n: 1,
        watermark: false,
        thinking_mode: true,
      },
    }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as WanImageResponse;
  if (!response.ok) throw new Error(`百炼图片生成失败（HTTP ${response.status}${payload.code ? `，${payload.code}` : ''}）。`);
  const imageUrl = payload.output?.choices?.[0]?.message?.content?.find(item => item.type === 'image' || item.image)?.image;
  if (!imageUrl) throw new Error('百炼图片模型未返回图片。');
  const imageResponse = await fetch(imageUrl, { signal });
  if (!imageResponse.ok) throw new Error(`百炼图片下载失败（HTTP ${imageResponse.status}）。`);
  const contentType = imageResponse.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error('百炼图片响应类型无效。');
  return Buffer.from(await imageResponse.arrayBuffer());
}
