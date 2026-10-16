import { createHash, createHmac } from 'node:crypto';

export type AccountReservation = {
  id: string;
  status: string;
  estimated_credits?: number;
};

export type AccountReservationResponse = {
  warning?: string;
  reservation?: AccountReservation;
};

export type AccountEntitlementClientOptions = {
  baseUrl: string;
  bearerToken?: string;
  appKey?: string;
  credentialKey?: string;
  clientSecret?: string;
};

export class AccountServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(status: number, code: string, payload: unknown) {
    super(`${status}: ${code}`);
    this.name = 'AccountServiceError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export class QuotaInsufficientError extends AccountServiceError {
  constructor(code: string, payload: unknown) {
    super(402, code, payload);
    this.name = 'QuotaInsufficientError';
  }
}

function errorCodeFromPayload(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return 'account_service_request_failed';
}

function signApplicationRequest(args: {
  appKey: string;
  credentialKey: string;
  clientSecret: string;
  idempotencyKey: string;
  rawBody: string;
}): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secretHash = createHash('sha256').update(args.clientSecret).digest('hex');
  const signature = createHmac('sha256', secretHash)
    .update(`${timestamp}.${args.idempotencyKey}.${args.rawBody}`)
    .digest('hex');
  return {
    'X-Application-Key': args.appKey,
    'X-Application-Credential-Key': args.credentialKey,
    'X-Application-Timestamp': timestamp,
    'X-Application-Signature': `v1=${signature}`,
  };
}

export class AccountEntitlementClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly appKey: string;
  private readonly credentialKey: string;
  private readonly clientSecret: string;

  constructor(options: AccountEntitlementClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.bearerToken = options.bearerToken || '';
    this.appKey = options.appKey || '';
    this.credentialKey = options.credentialKey || '';
    this.clientSecret = options.clientSecret || '';
  }

  private async post(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<unknown> {
    const rawBody = JSON.stringify(body);
    const signedHeaders = this.appKey && this.credentialKey && this.clientSecret
      ? signApplicationRequest({
          appKey: this.appKey,
          credentialKey: this.credentialKey,
          clientSecret: this.clientSecret,
          idempotencyKey,
          rawBody,
        })
      : {};

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...signedHeaders,
        ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
      },
      body: rawBody,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AccountServiceError(response.status, errorCodeFromPayload(payload), payload);
    }
    return payload;
  }

  async reserve(args: {
    tenantId: string;
    memberId: string;
    requestId: string;
    productArea: string;
    modelName: string;
    units: number;
    expiresAt?: string;
  }): Promise<AccountReservationResponse> {
    const payload = await this.post(
      `/v1/tenants/${encodeURIComponent(args.tenantId)}/members/${encodeURIComponent(args.memberId)}/usage-reservations`,
      {
        product_area: args.productArea,
        model_name: args.modelName,
        units: args.units,
        request_ref: args.requestId,
        expires_at: args.expiresAt,
      },
      `${args.requestId}:reserve`,
    ) as AccountReservationResponse;
    if (payload.warning || !payload.reservation) {
      throw new QuotaInsufficientError(payload.warning || 'quota_reservation_failed', payload);
    }
    return payload;
  }

  async settle(args: {
    tenantId: string;
    reservationId: string;
    requestId: string;
    actualUnits: number;
  }): Promise<unknown> {
    return this.post(
      `/v1/tenants/${encodeURIComponent(args.tenantId)}/usage-reservations/${encodeURIComponent(args.reservationId)}/settle`,
      { actual_units: args.actualUnits },
      `${args.requestId}:settle`,
    );
  }

  async release(args: {
    tenantId: string;
    reservationId: string;
    requestId: string;
  }): Promise<unknown> {
    return this.post(
      `/v1/tenants/${encodeURIComponent(args.tenantId)}/usage-reservations/${encodeURIComponent(args.reservationId)}/release`,
      {},
      `${args.requestId}:release`,
    );
  }
}

export function estimateTextUnits(input: string, minUnits = 1_000, maxUnits = 100_000): number {
  return Math.min(Math.max(input.length * 8, minUnits), maxUnits);
}
