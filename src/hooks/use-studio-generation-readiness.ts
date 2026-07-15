'use client';

import { useEffect, useState } from 'react';
import { clientApiRequest } from '@/lib/client-api';
import type {
  StudioGenerationProduct,
  StudioGenerationState,
} from '@/lib/studio-generation-readiness';

const CHECKING: StudioGenerationState = {
  ready: false,
  message: '正在检查生成服务，请稍候。',
};
const UNAVAILABLE: StudioGenerationState = {
  ready: false,
  message: '暂时无法确认生成服务状态，当前不会提交生成任务，请稍后重试。',
};

type HealthPayload = {
  capabilities?: {
    generationReadiness?: Partial<Record<StudioGenerationProduct, StudioGenerationState>>;
  };
};

export function useStudioGenerationReadiness(product: StudioGenerationProduct) {
  const [readiness, setReadiness] = useState<StudioGenerationState>(CHECKING);

  useEffect(() => {
    let active = true;
    setReadiness(CHECKING);
    clientApiRequest('/api/health', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as HealthPayload;
        const next = payload.capabilities?.generationReadiness?.[product];
        if (!next || typeof next.ready !== 'boolean' || typeof next.message !== 'string') {
          throw new Error('generation readiness missing');
        }
        if (active) setReadiness(next);
      })
      .catch(() => {
        if (active) setReadiness(UNAVAILABLE);
      });
    return () => { active = false; };
  }, [product]);

  return readiness;
}
