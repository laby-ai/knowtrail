import { randomUUID } from 'node:crypto';
import { AccountEntitlementClient, estimateTextUnits } from '@/lib/account-entitlement-client';

export type BillingProductArea = 'ai.text' | 'ai.image' | 'ai.video' | 'ai.agent';

type AIUsageReservationOptions = {
  route: string;
  productArea?: BillingProductArea;
  modelName: string;
  units?: number;
  inputText?: string;
  promptContext?: string;
  memberId?: string;
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

export async function reserveAIUsage(options: AIUsageReservationOptions): Promise<AIUsageReservation | null> {
  if (!isAccountBillingConfigured(options.memberId)) return null;

  const client = createAccountClient();
  const tenantId = envValue('ACCOUNT_CENTER_TENANT_ID');
  const memberId = options.memberId || envValue('ACCOUNT_CENTER_DEFAULT_MEMBER_ID');
  if (!client || !tenantId || !memberId) return null;

  const requestId = `knowtrail:${options.route}:${randomUUID()}`;
  const estimatedUnits = typeof options.units === 'number' && options.units > 0
    ? Math.floor(options.units)
    : estimateTextUnits(`${options.inputText || ''}\n\n${options.promptContext || ''}`);
  const response = await client.reserve({
    tenantId,
    memberId,
    requestId,
    productArea: options.productArea || envValue('ACCOUNT_CENTER_PRODUCT_AREA') || 'ai.text',
    modelName: options.modelName,
    units: estimatedUnits,
  });
  const reservationId = response.reservation?.id;
  if (!reservationId) return null;

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
      await client.settle({ tenantId, reservationId, requestId, actualUnits });
    },
    release: async () => {
      await client.release({ tenantId, reservationId, requestId });
    },
  };
}
