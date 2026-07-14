import { NextResponse } from 'next/server';
import { resolveInternalAppOrigin } from '@/lib/internal-origin';
import { isObjectStorageConfigured, isUsingObjectStorage } from '@/lib/storage';
import { vectorStoreStatus } from '@/lib/vector-store';
import { sourceStoreStatus } from '@/lib/ingestion-store';
import { mineruJobHealth } from '@/lib/mineru-job';
import { studioJobStoreStatus } from '@/lib/studio-job';
import { getAccountCenterStatus } from '@/lib/account-center';
import { allowRequestRuntimeAIConfig } from '@/lib/runtime-ai-config';
import { internalClassroomOrigin, publicClassroomOrigin } from '@/lib/virtual-classroom/runtime-config';
import { scientificIllustrationStoreStatus } from '@/lib/scientific-illustration-store';
import { resolveExplainerVideoProviderConfig } from '@/lib/explainer-video-provider';
import { operationalObservabilityStatus } from '@/lib/operational-observability';

export const dynamic = 'force-dynamic';

function hasAll(values: Array<string | undefined>): boolean {
  return values.every(value => Boolean(value?.trim()));
}

function hasServerFallbackModel(): boolean {
  return hasAll([
    process.env.OPENAI_COMPAT_API_BASE || process.env.ARK_API_BASE || process.env.OPENAI_API_BASE,
    process.env.OPENAI_COMPAT_API_KEY || process.env.ARK_API_KEY || process.env.OPENAI_API_KEY,
    process.env.OPENAI_COMPAT_MODEL || process.env.ARK_MODEL,
  ]);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export async function GET() {
  const maxUploadBytes = readPositiveIntEnv('MAX_UPLOAD_BYTES', 25 * 1024 * 1024);
  const maxUploadFiles = readPositiveIntEnv('MAX_UPLOAD_FILES', 5);
  let internalAppOriginValid = true;
  let internalAppOriginError: string | undefined;
  const scientificIllustrationStore = await scientificIllustrationStoreStatus();

  try {
    resolveInternalAppOrigin();
  } catch (error) {
    internalAppOriginValid = false;
    internalAppOriginError = error instanceof Error ? error.message : 'INTERNAL_APP_ORIGIN 配置不正确';
  }

  return NextResponse.json({
    ok: internalAppOriginValid,
    service: 'lingbi-studio',
    time: new Date().toISOString(),
    runtime: process.env.NODE_ENV || 'development',
    capabilities: {
      userProvidedOpenAICompatibleConfig: allowRequestRuntimeAIConfig(),
      accountBoundModelConfig: true,
      serverFallbackModelConfigured: hasServerFallbackModel(),
      sitianImageProviderConfigured: hasAll([
        process.env.SITIAN_API_BASE,
        process.env.SITIAN_API_TOKEN,
      ]),
      sitianImageProviderRequired: process.env.SITIAN_IMAGE_PROVIDER_REQUIRED === 'true',
      fileStorageAdapter: isUsingObjectStorage() ? 's3' : 'local',
      objectStorageConfigured: isObjectStorageConfigured(),
      mineruConfigured: Boolean(process.env.MINERU_API_TOKEN?.trim()),
      mineruJob: mineruJobHealth(),
      vectorStore: vectorStoreStatus(),
      sourceStore: sourceStoreStatus(),
      studioJobStore: studioJobStoreStatus(),
      scientificIllustrationStore,
      explainerVideoProvider: resolveExplainerVideoProviderConfig().publicStatus,
      accountCenter: getAccountCenterStatus(),
      virtualClassroom: {
        publicOrigin: publicClassroomOrigin() || null,
        internalOriginConfigured: Boolean(internalClassroomOrigin()),
        proxyEnabled: publicClassroomOrigin() === '/classroom-runtime',
      },
      operationalObservability: operationalObservabilityStatus(),
    },
    deployment: {
      internalAppOriginConfigured: Boolean(process.env.INTERNAL_APP_ORIGIN?.trim()),
      internalAppOriginValid,
      internalAppOriginError,
      allowInsecureApiBase: process.env.ALLOW_INSECURE_API_BASE === 'true',
      allowPrivateApiBase: process.env.ALLOW_PRIVATE_API_BASE === 'true',
    },
    limits: {
      maxUploadBytes,
      maxUploadFiles,
    },
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
