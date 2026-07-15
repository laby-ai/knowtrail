import assert from 'node:assert/strict';
import {
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

const partialProvider = readiness({
  OPENAI_COMPAT_API_BASE: 'https://models.example.com/v1',
  OPENAI_COMPAT_MODEL: 'text-model',
  SITIAN_API_TOKEN: 'token-without-base',
});
assert.equal(partialProvider.imagePpt.ready, false);
assert.equal(partialProvider.structuredPpt.ready, false);
assert.equal(partialProvider.scientificIllustration.ready, false);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'missing providers fail closed',
    'ordinary research chat readiness',
    'text-only PPT readiness',
    'image-only scientific illustration readiness',
    'combined image PPT readiness',
    'OpenAI-compatible image fallback readiness',
    'partial provider configuration rejection',
  ],
}, null, 2));
