import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { metricsRoute, serviceMetrics } from './service-metrics';

type LogWriter = (line: string) => void;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function requestIdFromHeader(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

export function observeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  writeLog: LogWriter = line => console.log(line),
) {
  const requestId = requestIdFromHeader(req.headers['x-request-id']);
  const startedAt = process.hrtime.bigint();
  const method = req.method || 'GET';
  const path = requestPath(req);

  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);

  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    serviceMetrics.observeHttp(method, metricsRoute(path), res.statusCode, durationMs / 1000);
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    writeLog(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: 'knowtrail',
      event: 'http_request',
      requestId,
      method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    }));
  });

  return {
    requestId,
    logError(error: unknown) {
      writeLog(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'knowtrail',
        event: 'http_request_error',
        requestId,
        method,
        path,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }));
    },
  };
}
