export class PaperHostSessionError extends Error {
  constructor(public readonly status: 401 | 503, message: string) { super(message); }
}

export function paperHostSessionVerificationConfigured(): boolean {
  return Boolean(process.env.PAPER_HOST_SESSION_VERIFY_URL?.trim());
}

export async function verifiedPaperHostWorkspace(headers: Headers): Promise<string> {
  const url = process.env.PAPER_HOST_SESSION_VERIFY_URL?.trim();
  if (!url) throw new PaperHostSessionError(503, '账号服务暂不可用，请稍后重试。');
  const cookie = headers.get('cookie') || '';
  const hasHeaders = headers.has('userId') || headers.has('token');
  const hasCookies = /(?:^|;)\s*(?:userId|token)=/.test(cookie);
  if (!hasHeaders && !hasCookies) throw new PaperHostSessionError(401, '请先使用手机验证码登录。');
  const identity = new Headers({ device: 'web' });
  if (hasHeaders) {
    const userId = headers.get('userId');
    const token = headers.get('token');
    if (!userId || !token) throw new PaperHostSessionError(401, '登录已失效，请重新登录。');
    identity.set('userId', userId);
    identity.set('token', token);
  } else {
    identity.set('cookie', cookie);
  }
  try {
    const response = await fetch(url, { headers: identity, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (response.status === 401) throw new PaperHostSessionError(401, '登录已失效，请重新登录。');
    if (!response.ok) throw new PaperHostSessionError(503, '账号服务暂不可用，请稍后重试。');
    const payload = await response.json() as { data?: { authenticated?: boolean; provider?: string; workspaceKey?: string; capabilities?: unknown } };
    const data = payload?.data;
    if (data?.authenticated !== true || data.provider !== 'knowtrail' ||
        typeof data.workspaceKey !== 'string' || !/^paper-user-[a-f0-9]{32}$/.test(data.workspaceKey) ||
        !Array.isArray(data.capabilities) || !data.capabilities.includes('verified-sms-session')) {
      throw new PaperHostSessionError(503, '账号服务暂不可用，请稍后重试。');
    }
    return data.workspaceKey;
  } catch (error) {
    if (error instanceof PaperHostSessionError) throw error;
    throw new PaperHostSessionError(503, '账号服务暂不可用，请稍后重试。');
  }
}
