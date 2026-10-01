export interface PulseSchedulerOptions {
  intervalMs?: number;
  minBatchSize?: number;
  emit?: (text: string) => void;
}

export interface PulseScheduler {
  push(content: string): void;
  finish(): void;
}

export function createPulseScheduler(_options: PulseSchedulerOptions = {}): PulseScheduler {
  return {
    push(_content: string) {},
    finish() {},
  };
}
