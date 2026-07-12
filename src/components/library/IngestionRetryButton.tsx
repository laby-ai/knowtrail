'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { clientApiFetch } from '@/lib/client-api';
import type { Paper } from '@/types';

type RetriedSource = {
  status: Paper['ingestionStatus'];
  stages?: Paper['ingestionStages'];
  chunkCount: number;
  vectorIndex?: Paper['vectorIndex'];
};

export function IngestionRetryButton({
  paperId,
  notebookId,
  onRetried,
}: {
  paperId: string;
  notebookId?: string;
  onRetried: (source: RetriedSource) => Promise<void> | void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  const retry = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    setError('');
    try {
      const payload = await clientApiFetch<{ source: RetriedSource }>('/api/ingestion/sources', {
        method: 'POST',
        body: JSON.stringify({ sourceId: paperId, notebookId }),
      });
      await onRetried(payload.source);
      setStatus('idle');
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : '重新处理失败，请稍后再试。');
      setStatus('error');
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid={`retry-ingestion-${paperId}`}
        disabled={status === 'loading'}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-blue-400/25 bg-blue-500/10 px-2.5 text-[11px] font-medium text-blue-300 transition-colors hover:bg-blue-500/15 disabled:cursor-wait disabled:opacity-60"
        onClick={(event) => {
          event.stopPropagation();
          void retry();
        }}
      >
        {status === 'loading' && <Loader2 className="h-3 w-3 animate-spin" />}
        {status === 'loading' ? '处理中' : '继续处理'}
      </button>
      {error && <span className="text-[10px] leading-relaxed text-red-300">{error}</span>}
    </div>
  );
}
