'use client';
import { toast } from 'sonner';

export function operationErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (/request_timeout|timed?\s*out|timeout/i.test(message)) return '等待超时，请先检查操作结果，避免重复提交。';
  if (/failed to fetch|network_error|networkerror|load failed/i.test(message)) return '网络连接失败，请检查网络后重试。';
  if (/request_cancelled/i.test(message)) return '操作已取消。';
  return message || fallback;
}
export const notifySuccess = (message: string) => toast.success(message);
export const notifyWarning = (message: string) => toast.warning(message, { duration: 7000 });
export function notifyFailure(error: unknown, fallback: string): string {
  const message = operationErrorMessage(error, fallback);
  toast.error(message, { duration: 8000 });
  return message;
}
