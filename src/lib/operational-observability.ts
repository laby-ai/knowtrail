import { createHmac, randomUUID } from 'node:crypto';

import { serviceMetrics } from './service-metrics';

type LogWriter = (line: string) => void;

type ObservationOptions = {
  hashKey?: string;
  requestId?: string | null;
  tenantId?: string;
  memberId?: string;
  taskType: string;
  writeLog?: LogWriter;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_CODE_PATTERN = /^[a-z0-9_.-]{1,80}$/;

function configuredHashKey(override?: string): string {
  return typeof override === 'string'
    ? override.trim()
    : process.env.KNOWTRAIL_OBSERVABILITY_HASH_KEY?.trim() || '';
}

export function operationalObservabilityStatus(options: { hashKey?: string } = {}) {
  const ready = configuredHashKey(options.hashKey).length >= 32;
  return {
    ready,
    blockers: ready ? [] : ['observability_identity_hash_unavailable'],
  };
}

function safeRef(prefix: 'tn' | 'mb' | 'tk', namespace: string, value: string, hashKey: string): string {
  const digest = createHmac('sha256', hashKey)
    .update(`${namespace}\0${value}`)
    .digest('hex')
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function safeCode(value: string, fallback: string): string {
  return SAFE_CODE_PATTERN.test(value) ? value : fallback;
}

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : 'UnknownError';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'UnknownError';
}

export function createGroundedTaskObservation(options: ObservationOptions) {
  const hashKey = configuredHashKey(options.hashKey);
  if (hashKey.length < 32) throw new Error('operational_observability_unavailable');

  const requestId = options.requestId && REQUEST_ID_PATTERN.test(options.requestId)
    ? options.requestId
    : `background:${randomUUID()}`;
  const taskType = safeCode(options.taskType, 'grounded-research');
  const tenantId = options.tenantId || 'unbound-tenant';
  const memberId = options.memberId || 'unbound-member';
  const tenantRef = safeRef('tn', 'tenant', tenantId, hashKey);
  const memberRef = safeRef('mb', 'member', `${tenantId}\0${memberId}`, hashKey);
  const taskRef = safeRef('tk', 'task', `${taskType}\0${requestId}`, hashKey);
  const writeLog = options.writeLog || (line => console.log(line));

  const emit = (payload: Record<string, unknown>) => {
    writeLog(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: payload.state === 'failed' ? 'error' : payload.state === 'cancelled' ? 'warn' : 'info',
      service: 'knowtrail',
      requestId,
      tenantRef,
      memberRef,
      taskRef,
      taskType,
      ...payload,
    }));
    const state = typeof payload.state === 'string' ? payload.state : 'unknown';
    const operation = payload.event === 'provider_call' ? 'model_provider' : 'grounded_task';
    const durationSeconds = typeof payload.durationMs === 'number' ? payload.durationMs / 1000 : undefined;
    serviceMetrics.observeOperation(operation, state, durationSeconds);
  };

  return {
    running() {
      emit({ event: 'task_lifecycle', state: 'running' });
    },
    succeeded() {
      emit({ event: 'task_lifecycle', state: 'succeeded' });
    },
    failed(errorCode: string, error: unknown) {
      emit({
        event: 'task_lifecycle',
        state: 'failed',
        errorCode: safeCode(errorCode, 'task_failed'),
        errorType: safeErrorType(error),
      });
    },
    cancelled(errorCode = 'task_cancelled') {
      emit({ event: 'task_lifecycle', state: 'cancelled', errorCode: safeCode(errorCode, 'task_cancelled') });
    },
    async *observeProvider<T>(stream: AsyncIterable<T>, provider = 'openai-compatible'): AsyncGenerator<T, void, unknown> {
      const startedAt = process.hrtime.bigint();
      const safeProvider = safeCode(provider, 'model-provider');
      emit({ event: 'provider_call', state: 'started', provider: safeProvider });
      try {
        for await (const chunk of stream) yield chunk;
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        emit({
          event: 'provider_call',
          state: 'succeeded',
          provider: safeProvider,
          durationMs: Math.round(durationMs * 100) / 100,
        });
      } catch (error) {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        emit({
          event: 'provider_call',
          state: 'failed',
          provider: safeProvider,
          durationMs: Math.round(durationMs * 100) / 100,
          errorCode: 'provider_call_failed',
          errorType: safeErrorType(error),
        });
        throw error;
      }
    },
  };
}
