import { modelProviderPreset } from '@/lib/model-provider-presets';
import { readAppPreferences } from '@/lib/app-preferences-store';
import { requestedModelSource, registerProvider } from '@/lib/commerce/context';
import { commerceAccount } from '@/lib/commerce/account-client';
import type { NextRequest } from 'next/server';
import { getAccountApiBase } from '@/lib/account-auth-client';
import {
  AccountEntitlementClient,
  AccountServiceError,
  type MemberProviderProfile,
} from '@/lib/account-entitlement-client';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { serverRuntimeAIConfigFromEnv } from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';

export const BAILIAN_TEXT_MODEL = 'qwen3.7-plus';
export const BAILIAN_IMAGE_MODEL = 'wan2.7-image-pro';
export const BAILIAN_TTS_MODEL = 'qwen-audio-3.0-tts-plus';
export const BAILIAN_REGION = 'cn-beijing';

export class BailianProfileRequiredError extends Error {
  readonly status = 428;
  readonly code = 'bailian_profile_required';

  constructor() {
    super('请先在设置的“模型配置”中选择服务并保存 API Key，再使用模型能力。');
    this.name = 'BailianProfileRequiredError';
  }
}

function envValue(name: string): string {
  return process.env[name]?.trim() || '';
}

function accountClient(): AccountEntitlementClient | null {
  const baseUrl = getAccountApiBase();
  const appKey = envValue('ACCOUNT_CENTER_APP_KEY');
  const credentialKey = envValue('ACCOUNT_CENTER_CREDENTIAL_KEY');
  const clientSecret = envValue('ACCOUNT_CENTER_CLIENT_SECRET');
  if (!baseUrl || !appKey || !credentialKey || !clientSecret) return null;
  return new AccountEntitlementClient({ baseUrl, appKey, credentialKey, clientSecret });
}

export async function resolveMemberBailianProfile(request: NextRequest | Request): Promise<MemberProviderProfile> {
  const session = await resolveAccountSessionFromRequest(request);
  if (!session) throw new BailianProfileRequiredError();
  if (process.env.LINGBI_COMMERCE_MODE) {
    try { return await commerceAccount<MemberProviderProfile>('internal/provider', { internal: true, body: { tenantId: session.tenant_id, memberId: session.member.id } }); }
    catch { throw new BailianProfileRequiredError(); }
  }
  const client = accountClient();
  if (!client) throw new BailianProfileRequiredError();
  try {
    return await client.resolveMemberProviderProfile({
      tenantId: session.tenant_id,
      memberId: session.member.id,
      requestId: request.headers.get('x-request-id') || crypto.randomUUID(),
    });
  } catch (error) {
    if (error instanceof AccountServiceError && error.status === 404) {
      throw new BailianProfileRequiredError();
    }
    throw error;
  }
}

async function resolveProviderRuntimeAIConfig(
  request: NextRequest | Request,
  fallbackInput?: Partial<RuntimeAIConfig>,
): Promise<Partial<RuntimeAIConfig>> {
  const requested = requestedModelSource();
  if (requested === 'platform') {
    const config = serverRuntimeAIConfigFromEnv();
    registerProvider(config.apiKey || '', 'platform');
    return config;
  }
  try {
    const profile = await resolveMemberBailianProfile(request);
    const preset = modelProviderPreset(profile.provider_id);
    registerProvider(profile.api_key, 'byok');
    return {
      apiBase: preset.apiBase, apiKey: profile.api_key, model: profile.text_model,
      visionModel: ['aliyun-bailian', 'moonshot', 'volcengine', 'minimax'].includes(profile.provider_id) ? profile.text_model : '',
      embeddingModel: '', ttsSpeaker: 'longanhuan_v3.6', providerId: profile.provider_id,
      workspaceId: profile.workspace_id, region: profile.region,
      imageModel: profile.image_model, ttsModel: profile.tts_model,
    };
  } catch (error) {
    if (error instanceof BailianProfileRequiredError && !accountAuthRequired()) {
      return Object.keys(fallbackInput || {}).length > 0 ? fallbackInput! : serverRuntimeAIConfigFromEnv();
    }
    throw error;
  }
}

export async function resolveRequestRuntimeAIConfig(request: NextRequest | Request, fallbackInput?: Partial<RuntimeAIConfig>): Promise<Partial<RuntimeAIConfig>> {
  const config = await resolveProviderRuntimeAIConfig(request, fallbackInput);
  const session = await resolveAccountSessionFromRequest(request);
  const preferences = session ? await readAppPreferences(session.member.id) : null;
  return { ...config, outputLanguage: preferences?.outputLanguage || 'auto' };
}

export function bailianProfileFromRuntimeConfig(config: Partial<RuntimeAIConfig>): MemberProviderProfile | null {
  if (config.providerId !== 'aliyun-bailian' || !config.workspaceId || !config.apiKey) return null;
  return {
    tenant_id: '',
    member_id: '',
    provider_id: 'aliyun-bailian',
    workspace_id: config.workspaceId || '',
    region: 'cn-beijing',
    text_model: config.model || BAILIAN_TEXT_MODEL,
    image_model: config.imageModel || BAILIAN_IMAGE_MODEL,
    tts_model: config.ttsModel || BAILIAN_TTS_MODEL,
    api_key: config.apiKey,
  };
}

export function bailianProfileErrorResponse(error: unknown): Response | null {
  if (!(error instanceof BailianProfileRequiredError)) return null;
  return Response.json({
    code: error.status,
    msg: error.message,
    error: error.message,
    errorType: error.code,
  }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
}

export async function resolveRequestRuntimeAIConfigResult(
  request: NextRequest | Request,
  fallbackInput?: Partial<RuntimeAIConfig>,
): Promise<Partial<RuntimeAIConfig> | Response> {
  try {
    return await resolveRequestRuntimeAIConfig(request, fallbackInput);
  } catch (error) {
    const response = bailianProfileErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
