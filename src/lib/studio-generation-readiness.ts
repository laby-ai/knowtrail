export type StudioGenerationProduct = 'researchChat' | 'imagePpt' | 'htmlPpt' | 'structuredPpt' | 'scientificIllustration';

export type StudioGenerationEnvironment = Record<string, string | undefined>;

export type StudioGenerationState = {
  ready: boolean;
  message: string;
};

export type StudioGenerationReadiness = Record<StudioGenerationProduct, StudioGenerationState>;

export type MemberGenerationProfile = {
  provider_id?: string;
  workspace_id?: string;
  configured?: boolean;
  text_model?: string;
  image_model?: string;
};

function envFirst(env: StudioGenerationEnvironment, ...names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function hasAll(values: string[]): boolean {
  return values.every(Boolean);
}

function state(ready: boolean, unavailableMessage: string): StudioGenerationState {
  return {
    ready,
    message: ready ? '生成服务已就绪。' : unavailableMessage,
  };
}

export function resolveStudioGenerationReadiness(
  env: StudioGenerationEnvironment = process.env,
): StudioGenerationReadiness {
  const modelBase = envFirst(env, 'OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE', 'DASHSCOPE_API_BASE');
  const modelKey = envFirst(env, 'OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY');
  const textModel = envFirst(env, 'OPENAI_COMPAT_MODEL', 'ARK_MODEL', 'DASHSCOPE_MODEL');
  const textReady = hasAll([modelBase, modelKey, textModel]);

  const sitianReady = hasAll([
    envFirst(env, 'SITIAN_API_BASE'),
    envFirst(env, 'SITIAN_API_TOKEN'),
  ]);
  const compatibleImageReady = hasAll([
    envFirst(env, 'OPENAI_COMPAT_IMAGE_API_BASE', 'ARK_IMAGE_API_BASE', 'OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE', 'DASHSCOPE_API_BASE'),
    envFirst(env, 'OPENAI_COMPAT_IMAGE_API_KEY', 'ARK_IMAGE_API_KEY', 'OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY'),
    envFirst(env, 'OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL', 'DASHSCOPE_IMAGE_MODEL'),
  ]);
  const imageReady = sitianReady || compatibleImageReady;

  const textUnavailable = '演示文稿生成服务正在配置中，当前不会提交生成任务，请稍后重试。';
  const chatUnavailable = '文献问答服务正在配置中，当前不会提交问答任务，请稍后重试。';
  const imageUnavailable = '科研图像生成服务正在配置中，当前不会提交生成任务，请稍后重试。';
  const imagePptUnavailable = textReady
    ? imageUnavailable
    : '演示文稿的文本与图像服务正在配置中，当前不会提交生成任务，请稍后重试。';

  return {
    researchChat: state(textReady, chatUnavailable),
    imagePpt: state(textReady && imageReady, imagePptUnavailable),
    htmlPpt: state(textReady, textUnavailable),
    structuredPpt: state(textReady, textUnavailable),
    scientificIllustration: state(imageReady, imageUnavailable),
  };
}

export function resolveMemberAwareGenerationReadiness(
  product: StudioGenerationProduct,
  globalState: StudioGenerationState,
  profile?: MemberGenerationProfile,
  requireMemberProfile = false,
): StudioGenerationState {
  const profileRequiredState: StudioGenerationState = {
    ready: false,
    message: '请先在设置的“模型配置”中选择服务并保存 API Key。',
  };
  if (!requireMemberProfile && globalState.ready) return globalState;
  if (!profile?.configured) return requireMemberProfile ? profileRequiredState : globalState;
  const textReady = Boolean(profile.text_model?.trim());
  const imageReady = Boolean(profile.image_model?.trim());
  if ((['moonshot', 'deepseek'].includes(profile.provider_id || '') || (profile.provider_id === 'aliyun-bailian' && !profile.workspace_id)) && (product === 'imagePpt' || product === 'scientificIllustration')) return { ready: false, message: '当前自带密钥配置暂不能生成图片。百炼请补充业务空间 ID，其他服务请确认是否支持绘图。' };
  const memberReady = product === 'scientificIllustration'
    ? imageReady
    : product === 'imagePpt'
      ? textReady && imageReady
      : textReady;
  return memberReady
    ? { ready: true, message: '当前账号的模型服务已就绪。' }
    : requireMemberProfile ? profileRequiredState : globalState;
}

export function studioGenerationUnavailablePayload(stateValue: StudioGenerationState) {
  return {
    code: 503,
    errorType: 'studio_generation_unavailable',
    error: stateValue.message,
    message: stateValue.message,
    retryable: true,
  };
}
