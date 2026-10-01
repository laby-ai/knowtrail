import assert from 'node:assert/strict';
import {
  resolveMemberAwareGenerationReadiness,
  resolveStudioGenerationReadiness,
  type StudioGenerationEnvironment,
} from '../src/lib/studio-generation-readiness';

function readiness(env: StudioGenerationEnvironment = {}) {
  return resolveStudioGenerationReadiness(env);
}

const unavailable = readiness();
assert.equal(unavailable.researchChat.ready, false);
assert.equal(unavailable.imagePpt.ready, false);
assert.equal(unavailable.htmlPpt.ready, false);
assert.equal(unavailable.structuredPpt.ready, false);
assert.equal(unavailable.scientificIllustration.ready, false);
assert.match(unavailable.imagePpt.message, /不会提交生成任务/);
assert.match(unavailable.researchChat.message, /不会提交问答任务/);
assert.match(unavailable.scientificIllustration.message, /服务正在配置/);

const textOnly = readiness({
  OPENAI_COMPAT_API_BASE: 'https://models.example.com/v1',
  OPENAI_COMPAT_API_KEY: 'test-key',
  OPENAI_COMPAT_MODEL: 'text-model',
});
assert.equal(textOnly.researchChat.ready, true);
assert.equal(textOnly.htmlPpt.ready, true);
assert.equal(textOnly.structuredPpt.ready, true);
assert.equal(textOnly.imagePpt.ready, false);
assert.equal(textOnly.scientificIllustration.ready, false);

const imageOnly = readiness({
  SITIAN_API_BASE: 'https://images.example.com',
  SITIAN_API_TOKEN: 'test-token',
});
assert.equal(imageOnly.researchChat.ready, false);
assert.equal(imageOnly.scientificIllustration.ready, true);
assert.equal(imageOnly.imagePpt.ready, false);
assert.equal(imageOnly.structuredPpt.ready, false);

const fullyReady = readiness({
  OPENAI_COMPAT_API_BASE: 'https://models.example.com/v1',
  OPENAI_COMPAT_API_KEY: 'test-key',
  OPENAI_COMPAT_MODEL: 'text-model',
  SITIAN_API_BASE: 'https://images.example.com',
  SITIAN_API_TOKEN: 'test-token',
});
assert.equal(fullyReady.researchChat.ready, true);
assert.equal(fullyReady.imagePpt.ready, true);
assert.equal(fullyReady.htmlPpt.ready, true);
assert.equal(fullyReady.structuredPpt.ready, true);
assert.equal(fullyReady.scientificIllustration.ready, true);

const compatibleImage = readiness({
  ARK_API_BASE: 'https://ark.example.com/api/v3',
  ARK_API_KEY: 'test-key',
  ARK_MODEL: 'text-model',
  ARK_IMAGE_MODEL: 'image-model',
});
assert.equal(compatibleImage.imagePpt.ready, true);
assert.equal(compatibleImage.scientificIllustration.ready, true);

const visionOnly = readiness({
  OPENAI_COMPAT_API_BASE: 'https://models.example.com/v1',
  OPENAI_COMPAT_API_KEY: 'test-key',
  OPENAI_COMPAT_MODEL: 'text-model',
  OPENAI_COMPAT_VISION_MODEL: 'vision-understanding-model',
});
assert.equal(visionOnly.imagePpt.ready, false);
assert.equal(visionOnly.scientificIllustration.ready, false);

const partialProvider = readiness({
  OPENAI_COMPAT_API_BASE: 'https://models.example.com/v1',
  OPENAI_COMPAT_MODEL: 'text-model',
  SITIAN_API_TOKEN: 'token-without-base',
});
assert.equal(partialProvider.imagePpt.ready, false);
assert.equal(partialProvider.structuredPpt.ready, false);
assert.equal(partialProvider.scientificIllustration.ready, false);

const memberProfile = {
  configured: true,
  text_model: 'qwen3.7-plus',
  image_model: 'wan2.7-image-pro',
};
for (const product of ['researchChat', 'imagePpt', 'htmlPpt', 'structuredPpt', 'scientificIllustration'] as const) {
  const memberReady = resolveMemberAwareGenerationReadiness(product, unavailable[product], memberProfile);
  assert.equal(memberReady.ready, true, `${product} should become ready for a configured member profile`);
  assert.match(memberReady.message, /百炼/);
}

assert.equal(
  resolveMemberAwareGenerationReadiness('scientificIllustration', unavailable.scientificIllustration, {
    configured: true,
    text_model: 'qwen3.7-plus',
  }).ready,
  false,
  'an image product must not become ready without an image model',
);
assert.equal(
  resolveMemberAwareGenerationReadiness('researchChat', unavailable.researchChat, {
    configured: false,
    text_model: 'qwen3.7-plus',
    image_model: 'wan2.7-image-pro',
  }).ready,
  false,
  'an unconfigured member profile must remain fail closed',
);
assert.equal(
  resolveMemberAwareGenerationReadiness('imagePpt', fullyReady.imagePpt, undefined).ready,
  true,
  'global readiness remains sufficient without a member profile',
);
const requiredProfile = resolveMemberAwareGenerationReadiness(
  'scientificIllustration',
  fullyReady.scientificIllustration,
  undefined,
  true,
);
assert.equal(requiredProfile.ready, false, 'account-required mode must not bypass the member profile with a global key');
assert.match(requiredProfile.message, /右上角配置百炼/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'missing providers fail closed',
    'ordinary research chat readiness',
    'text-only PPT readiness',
    'image-only scientific illustration readiness',
    'combined image PPT readiness',
    'OpenAI-compatible image fallback readiness',
    'vision-understanding models do not imply image-generation readiness',
    'partial provider configuration rejection',
    'configured member Bailian profile upgrades product readiness',
    'member profile remains fail closed when required models are missing',
    'account-required mode cannot bypass member BYOK with a global provider',
  ],
}, null, 2));
