const MAX_REFERENCE_IMAGE_BYTES = 12_000_000;

export interface SlideReferenceImage {
  base64: string;
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface PublicSlideRevisionError {
  status: number;
  code: 'reference_image_invalid' | 'image_provider_busy' | 'image_provider_timeout' | 'image_provider_unavailable' | 'image_provider_failed';
  message: string;
  retryable: boolean;
}

export class SlideImageProviderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SlideImageProviderError';
  }
}

function detectImageMime(bytes: Buffer): SlideReferenceImage['mimeType'] | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
}

export function parseSlideReferenceImage(input: unknown): SlideReferenceImage {
  const value = typeof input === 'string' ? input.trim() : '';
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i);
  const base64 = (match?.[2] || value).replace(/\s/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('参考图片格式无效，请重新打开该页后重试。');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(bytes.length ? '参考图片过大，请缩小后重试。' : '参考图片格式无效，请重新打开该页后重试。');
  }
  const mimeType = detectImageMime(bytes);
  if (!mimeType) throw new Error('参考图片格式无效，请重新打开该页后重试。');
  if (match?.[1] && match[1].toLowerCase() !== mimeType) {
    throw new Error('参考图片格式与内容不一致，请重新打开该页后重试。');
  }
  return { base64, mimeType, dataUrl: `data:${mimeType};base64,${base64}` };
}

export function buildReferenceImageInput(
  image: SlideReferenceImage,
  endpoint: string,
  model: string,
): string | string[] {
  const arkOrSeedream = /volces\.com|volcengine|\/api\/v3(?:\/|$)/i.test(endpoint) || /seedream|seededit/i.test(model);
  return arkOrSeedream ? [image.dataUrl] : image.dataUrl;
}

export function publicSlideRevisionError(error: unknown): PublicSlideRevisionError {
  const status = error instanceof SlideImageProviderError ? error.status : 0;
  const message = error instanceof Error ? error.message : '';
  const combined = `${status} ${message}`;

  if (/invalid\s*(?:url|image)|reference image|image.*not valid|InvalidParameter/i.test(combined)) {
    return {
      status: 422,
      code: 'reference_image_invalid',
      message: '参考图片无法被图片模型读取，请重新打开该页后重试。',
      retryable: true,
    };
  }
  if (status === 429 || /HTTP\s*429|rate.?limit|too many requests/i.test(combined)) {
    return {
      status: 429,
      code: 'image_provider_busy',
      message: '图片服务当前较忙，请稍后重试。',
      retryable: true,
    };
  }
  if (/timeout|timed out|AbortError/i.test(combined)) {
    return {
      status: 504,
      code: 'image_provider_timeout',
      message: '图片生成等待超时，请重试。',
      retryable: true,
    };
  }
  if (/尚未配置|not configured|missing.*provider/i.test(combined)) {
    return {
      status: 503,
      code: 'image_provider_unavailable',
      message: '图片编辑服务尚未配置，请联系管理员。',
      retryable: false,
    };
  }
  return {
    status: 502,
    code: 'image_provider_failed',
    message: '图片修改失败，请稍后重试。',
    retryable: true,
  };
}
