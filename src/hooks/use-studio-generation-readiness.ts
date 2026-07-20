'use client';

import { useEffect, useState } from 'react';
import { clientApiRequest, hasStoredAccountToken } from '@/lib/client-api';
import type {
  MemberGenerationProfile,
  StudioGenerationProduct,
  StudioGenerationState,
} from '@/lib/studio-generation-readiness';
import { resolveMemberAwareGenerationReadiness } from '@/lib/studio-generation-readiness';

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
    accountCenter?: { authRequired?: boolean };
    generationReadiness?: Partial<Record<StudioGenerationProduct, StudioGenerationState>>;
  };
};

type ProviderProfilePayload = {
  profile?: MemberGenerationProfile;
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
        const requireMemberProfile = payload.capabilities?.accountCenter?.authRequired === true;
        if (!requireMemberProfile && next.ready) {
          if (active) setReadiness(next);
          return;
        }
        if (!hasStoredAccountToken()) {
          if (active) {
            setReadiness(resolveMemberAwareGenerationReadiness(product, next, undefined, requireMemberProfile));
          }
          return;
        }
        let profileResponse: Response;
        try {
          profileResponse = await clientApiRequest('/api/account/provider-profile', {
            cache: 'no-store',
            redirectOnUnauthorized: false,
          });
        } catch {
          if (active) {
            setReadiness(resolveMemberAwareGenerationReadiness(product, next, undefined, requireMemberProfile));
          }
          return;
        }
        if (!profileResponse.ok) {
          if (active) {
            setReadiness(resolveMemberAwareGenerationReadiness(product, next, undefined, requireMemberProfile));
          }
          return;
        }
        const profilePayload = await profileResponse.json() as ProviderProfilePayload;
        if (active) {
          setReadiness(resolveMemberAwareGenerationReadiness(
            product,
            next,
            profilePayload.profile,
            requireMemberProfile,
          ));
        }
      })
      .catch(() => {
        if (active) setReadiness(UNAVAILABLE);
      });
    return () => { active = false; };
  }, [product]);

  return readiness;
}
