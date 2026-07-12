import { AccountEntitlementClient, AccountServiceError, estimateTextUnits } from '@/lib/account-entitlement-client';
import { admitLongTask, resolveLongTaskIdempotencyKey } from '@/lib/long-task-admission';

export type BillingProductArea = 'ai.text' | 'ai.image' | 'ai.video' | 'ai.agent';

type AIUsageReservationOptions = {
  route: string;
  productArea?: BillingProductArea;
  modelName: string;
  units?: number;
  inputText?: string;
  promptContext?: string;
  memberId?: string;
  idempotencyKey?: string;
};

export type AIUsageReservation = {
  requestId: string;
  estimatedUnits: number;
  settle: (actualUsage: string | number) => Promise<void>;
  release: () => Promise<void>;
};

function envValue(name: string): string {
  return process.env[name]?.trim() || '';
}

function createAccountClient(): AccountEntitlementClient | null {
  const baseUrl = envValue('ACCOUNT_CENTER_API_BASE');
  const appKey = envValue('ACCOUNT_CENTER_APP_KEY');
  const credentialKey = envValue('ACCOUNT_CENTER_CREDENTIAL_KEY');
  const clientSecret = envValue('ACCOUNT_CENTER_CLIENT_SECRET');
  if (!baseUrl || !appKey || !credentialKey || !clientSecret) return null;
  return new AccountEntitlementClient({
    baseUrl,
    appKey,
    credentialKey,
    clientSecret,
  });
}

export function isAccountBillingConfigured(memberId?: string): boolean {
  return Boolean(
    envValue('ACCOUNT_CENTER_API_BASE') &&
    envValue('ACCOUNT_CENTER_TENANT_ID') &&
    (memberId || envValue('ACCOUNT_CENTER_DEFAULT_MEMBER_ID')) &&
    envValue('ACCOUNT_CENTER_APP_KEY') &&
    envValue('ACCOUNT_CENTER_CREDENTIAL_KEY') &&
    envValue('ACCOUNT_CENTER_CLIENT_SECRET')
  );
}

export function accountUsageErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AccountServiceError && error.status === 429) {
    return '当前运行中的科研任务较多，请等待一个任务完成后再试。';
  }
  if (error instanceof AccountServiceError && error.status === 409) {
    return '相同请求已经提交，请勿重复操作。';
  }
  return fallback;
}

export async function reserveAIUsage(options: AIUsageReservationOptions): Promise<AIUsageReservation | null> {
  if (!isAccountBillingConfigured(options.memberId)) return null;

  const client = createAccountClient();
  const tenantId = envValue('ACCOUNT_CENTER_TENANT_ID');
  const memberId = options.memberId || envValue('ACCOUNT_CENTER_DEFAULT_MEMBER_ID');
  if (!client || !tenantId || !memberId) return null;

  const idempotencyKey = resolveLongTaskIdempotencyKey({
    explicit: options.idempotencyKey,
    memberId,
    operation: options.route,
    content: `${options.inputText || ''}\n${options.promptContext || ''}`,
  });
  const admission = admitLongTask({ memberId, operation: options.route, idempotencyKey });
  const requestId = `knowtrail:${options.route}:${admission.taskId}`;
  const estimatedUnits = typeof options.units === 'number' && options.units > 0
    ? Math.floor(options.units)
    : estimateTextUnits(`${options.inputText || ''}\n\n${options.promptContext || ''}`);
  let response;
  try {
    response = await client.reserve({
      tenantId,
      memberId,
      requestId,
      productArea: options.productArea || envValue('ACCOUNT_CENTER_PRODUCT_AREA') || 'ai.text',
      modelName: options.modelName,
      units: estimatedUnits,
      expiresAt: new Date(Date.now() + Math.max(300, Number(process.env.ACCOUNT_RESERVATION_TTL_SECONDS || 3600)) * 1000).toISOString(),
    });
  } catch (error) {
    admission.fail();
    throw error;
  }
  const reservationId = response.reservation?.id;
  if (!reservationId) {
    admission.fail();
    return null;
  }

  return {
    requestId,
    estimatedUnits,
    settle: async (actualUsage: string | number) => {
      const actualUnits = Math.min(
        typeof actualUsage === 'number' && actualUsage > 0
          ? Math.floor(actualUsage)
          : estimateTextUnits(String(actualUsage), 1_000, estimatedUnits),
        estimatedUnits,
      );
      try {
        await client.settle({ tenantId, reservationId, requestId, actualUnits });
        admission.succeed();
      } catch (error) {
        await client.release({ tenantId, reservationId, requestId }).catch(() => undefined);
        admission.fail();
        throw error;
      }
    },
    release: async () => {
      await client.release({ tenantId, reservationId, requestId });
      admission.cancel();
    },
  };
}
