'use client';

import { readZhiqiPortalAuthHeaders } from '@/lib/zhiqi-portal-auth';

const ACCOUNT_TOKEN_KEYS = ["knowtrail-account-session","account_entitlement_token"];
const DEFAULT_TIMEOUT_MS = 20_000;
const FALLBACK_LOGIN_URL = '/account-login.html?next=%2Flingbi';

export type ClientRequestErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'http_error'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'invalid_payload'
  | 'download_error';

export class ClientRequestError extends Error {
  constructor(
    message: string,
    public readonly code: ClientRequestErrorCode,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ClientRequestError';
  }
}
export type ClientApiOptions = RequestInit & {
  timeoutMs?: number;
  redirectOnUnauthorized?: boolean;
  skipAuth?: boolean;
};

export function detectClientBasePath(): string {
  const configured = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/lingbi')) return '/lingbi';
  return '';
}

export function clientApiPath(path: string): string {
  const basePath = detectClientBasePath();
  if (!basePath || !path.startsWith('/api') || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}

export function getStoredAccountToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of ACCOUNT_TOKEN_KEYS) {
        const value = storage.getItem(key)?.trim();
        if (!value) continue;
        if (key.endsWith('-account-session')) {
          try {
            const token = (JSON.parse(value) as { token?: string }).token?.trim();
            if (token) return token;
          } catch {
            continue;
          }
        } else {
          return value;
        }
      }
    }
  } catch {
    return '';
  }
  return '';
}

export function hasStoredAccountToken(): boolean {
  return Boolean(getStoredAccountToken());
}

export function accountAuthHeaders(): Record<string, string> {
  const portalHeaders = readZhiqiPortalAuthHeaders();
  if (portalHeaders.Authorization) return portalHeaders;
  const token = getStoredAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function clearStoredAccountTokens(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of ACCOUNT_TOKEN_KEYS) storage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable or blocked.
  }
}

export function accountLoginUrl(): string {
  if (typeof window === 'undefined') return FALLBACK_LOGIN_URL;
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/lingbi';
  return `/account-login.html?next=${encodeURIComponent(next)}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json().catch(() => null);
  return response.text().catch(() => '');
}

function messageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as { error?: unknown; msg?: unknown; message?: unknown };
  return String(value.error || value.msg || value.message || fallback);
}

function httpError(response: Response, payload: unknown, codeOverride?: ClientRequestErrorCode): ClientRequestError {
  const code = codeOverride || (response.status === 401
    ? 'unauthorized'
    : response.status === 403
      ? 'forbidden'
      : response.status === 429
        ? 'rate_limited'
        : 'http_error');
  return new ClientRequestError(
    messageFromPayload(payload, `request_failed_${response.status}`),
    code,
    response.status,
    payload,
  );
}

async function executeFetch(path: string, options: ClientApiOptions): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    redirectOnUnauthorized = true,
    skipAuth = false,
    headers,
    signal: callerSignal,
    ...init
  } = options;
  const requestHeaders = new Headers(headers);
  const portalHeaders = skipAuth ? {} : readZhiqiPortalAuthHeaders();
  Object.entries(portalHeaders).forEach(([name, value]) => {
    if (!requestHeaders.has(name)) requestHeaders.set(name, value);
  });
  const token = skipAuth ? '' : getStoredAccountToken();
  if (token && !requestHeaders.has('Authorization')) requestHeaders.set('Authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string' && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  try {
    const response = await fetch(clientApiPath(path), {
      ...init,
      credentials: init.credentials ?? 'same-origin',
      cache: init.cache ?? 'no-store',
      headers: requestHeaders,
      signal: controller.signal,
    });
    if (response.status === 401) {
      const payload = await parseResponseBody(response);
      clearStoredAccountTokens();
      if (redirectOnUnauthorized && typeof window !== 'undefined') window.location.replace(accountLoginUrl());
      throw httpError(response, payload);
    }
    return response;
  } catch (error) {
    if (error instanceof ClientRequestError) throw error;
    if (timedOut) throw new ClientRequestError('request_timeout', 'timeout');
    if (callerSignal?.aborted) throw new ClientRequestError('request_cancelled', 'cancelled');
    throw new ClientRequestError(
      error instanceof Error ? error.message : 'network_error',
      'network',
      undefined,
      error,
    );
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function clientApiRequest(path: string, options: ClientApiOptions = {}): Promise<Response> {
  return executeFetch(path, options);
}

export async function clientApiFetch<T>(path: string, options: ClientApiOptions = {}): Promise<T> {
  const response = await executeFetch(path, options);
  const payload = await parseResponseBody(response);
  if (!response.ok) throw httpError(response, payload);
  if (payload === null || payload === '') {
    throw new ClientRequestError('invalid_response_payload', 'invalid_payload', response.status);
  }
  return payload as T;
}

export async function clientApiDownloadBlob(path: string, options: ClientApiOptions = {}): Promise<Blob> {
  const response = await executeFetch(path, options);
  if (!response.ok) throw httpError(response, await parseResponseBody(response), 'download_error');
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    throw httpError(response, await parseResponseBody(response), 'download_error');
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new ClientRequestError('empty_download', 'download_error', response.status);
  return blob;
}
