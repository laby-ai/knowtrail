import { AsyncLocalStorage } from 'node:async_hooks';
import { llmInvoke } from '@/lib/ai-service';
import type { RuntimeAIConfig } from '@/types';

export type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmCallLog = {
  stage: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  success: boolean;
  timedOut: boolean;
  durationMs: number;
  jsonParsedOk: boolean;
  fallbackTriggered: boolean;
  fallbackReason: string;
  rawPreview: string;
  errorPreview: string;
};

export const llmCallLogs: LlmCallLog[] = [];
const requestLlmCallLogs = new AsyncLocalStorage<LlmCallLog[]>();

export function getLlmCallLogs(): LlmCallLog[] {
  return requestLlmCallLogs.getStore() || llmCallLogs;
}

export function withLlmCallLogs<T>(callback: () => T): T {
  return requestLlmCallLogs.run([], callback);
}

export function resetLlmCallLogs(): void {
  getLlmCallLogs().length = 0;
}

export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export async function llmInvokeObserved(
  stage: string,
  messages: Message[],
  options?: {
    model?: string;
    temperature?: number;
    thinking?: 'enabled' | 'disabled';
    timeoutMs?: number;
    maxTokens?: number;
    runtimeConfig?: Partial<RuntimeAIConfig>;
  },
): Promise<{ raw: string; log: LlmCallLog }> {
  const logs = getLlmCallLogs();
  const log: LlmCallLog = {
    stage,
    model: options?.runtimeConfig?.model?.trim() || options?.model || 'doubao-seed-2-0-pro-260215',
    temperature: options?.temperature ?? 0.4,
    timeoutMs: options?.timeoutMs || 30000,
    success: false,
    timedOut: false,
    durationMs: 0,
    jsonParsedOk: false,
    fallbackTriggered: false,
    fallbackReason: '',
    rawPreview: '',
    errorPreview: '',
  };
  const t0 = Date.now();
  try {
    const raw = await llmInvokeWithTimeout(messages, options);
    log.durationMs = Date.now() - t0;
    log.success = true;
    log.rawPreview = raw.slice(0, 500);
    logs.push(log);
    console.log(`[PPT-V2] ✓ ${stage} | model=${log.model} | ${log.durationMs}ms | raw=${log.rawPreview.slice(0, 80)}...`);
    return { raw, log };
  } catch (err) {
    log.durationMs = Date.now() - t0;
    log.success = false;
    log.timedOut = err instanceof Error && err.name === 'AbortError';
    log.errorPreview = String(err instanceof Error ? err.message : err).slice(0, 200);
    logs.push(log);
    console.error(`[PPT-V2] ✗ ${stage} | model=${log.model} | ${log.durationMs}ms | timedOut=${log.timedOut} | err=${log.errorPreview}`);
    throw err;
  }
}

export function markJsonParsed(stage: string, ok: boolean): void {
  const log = [...getLlmCallLogs()].reverse().find(item => item.stage === stage);
  if (log) log.jsonParsedOk = ok;
}

export function markFallback(stage: string, reason: string): void {
  const log = [...getLlmCallLogs()].reverse().find(item => item.stage === stage);
  if (log) {
    log.fallbackTriggered = true;
    log.fallbackReason = reason;
  }
  console.warn(`[PPT-V2] ⚠ ${stage} FALLBACK: ${reason}`);
}

async function llmInvokeWithTimeout(
  messages: Message[],
  options?: {
    model?: string;
    temperature?: number;
    thinking?: 'enabled' | 'disabled';
    timeoutMs?: number;
    maxTokens?: number;
    runtimeConfig?: Partial<RuntimeAIConfig>;
  },
): Promise<string> {
  const timeoutMs = options?.timeoutMs || 30000;
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error(`LLM call timed out after ${timeoutMs}ms`);
      error.name = 'AbortError';
      reject(error);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      llmInvoke(messages, {
        model: options?.model,
        temperature: options?.temperature,
        thinking: options?.thinking,
        maxTokens: options?.maxTokens,
        signal: controller.signal,
      }, undefined, options?.runtimeConfig),
      timeout,
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    return result;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      console.log(`[PPT-V2] LLM call timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}
