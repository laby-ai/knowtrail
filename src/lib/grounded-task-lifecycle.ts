import type { AIUsageReservation } from '@/lib/account-ai-billing';

export type GroundedBillingResult =
  | { status: 'settled' }
  | { status: 'settle_failed'; code: string };

type GroundedSseContext = {
  emit: (payload: unknown) => void;
  signal: AbortSignal;
};

type GroundedSseOptions = {
  requestSignal: AbortSignal;
  timeoutMs: number;
  timeoutReason: string;
  cancelReason: string;
  run: (context: GroundedSseContext) => Promise<void>;
  onError?: (error: unknown, context: GroundedSseContext) => Promise<void> | void;
};

function settlementErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[a-z0-9_.-]{1,80}$/.test(code)) return code;
  }
  return 'account_settle_failed';
}

export function createUsageReservationFinalizer(reservation: AIUsageReservation | null) {
  let finalized = false;

  return {
    async settle(actualUsage: string | number): Promise<GroundedBillingResult | undefined> {
      if (!reservation) return undefined;
      if (finalized) throw new Error('usage_reservation_already_finalized');
      finalized = true;
      try {
        await reservation.settle(actualUsage);
        return { status: 'settled' };
      } catch (error) {
        return { status: 'settle_failed', code: settlementErrorCode(error) };
      }
    },

    async finalizeFailure(partialUsage: string | number | undefined): Promise<void> {
      if (!reservation || finalized) return;
      finalized = true;
      if (typeof partialUsage === 'number' ? partialUsage > 0 : Boolean(partialUsage)) {
        await reservation.settle(partialUsage as string | number).catch(() => undefined);
        return;
      }
      await reservation.release().catch(() => undefined);
    },
  };
}

export function createGroundedSseResponse(options: GroundedSseOptions): Response {
  const taskController = new AbortController();
  const abortFromRequest = () => taskController.abort(options.requestSignal.reason);
  if (options.requestSignal.aborted) abortFromRequest();
  else options.requestSignal.addEventListener('abort', abortFromRequest, { once: true });

  const encoder = new TextEncoder();
  let streamClosed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const timeoutId = setTimeout(
        () => taskController.abort(new Error(options.timeoutReason)),
        options.timeoutMs,
      );
      const context: GroundedSseContext = {
        signal: taskController.signal,
        emit(payload) {
          if (streamClosed) return;
          try {
            const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            streamClosed = true;
          }
        },
      };

      try {
        await options.run(context);
      } catch (error) {
        await options.onError?.(error, context);
      } finally {
        clearTimeout(timeoutId);
        options.requestSignal.removeEventListener('abort', abortFromRequest);
        if (!streamClosed) {
          streamClosed = true;
          try {
            controller.close();
          } catch {
            // A cancelled reader may already have closed the controller.
          }
        }
      }
    },
    cancel() {
      taskController.abort(new Error(options.cancelReason));
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
