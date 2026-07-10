'use client';

import { useCallback, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { DiscoverSourcesModal } from '@/components/library/DiscoverSourcesModal';
import { useApp } from '@/contexts/AppContext';
import { uploadDiscoveredSourceFiles } from '@/lib/discovered-source-upload';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';

type UploadSummary = {
  added: number;
  errors: string[];
};

export function PaperSearchPanel() {
  const {
    activeFolderId,
    addFolder,
    addPaper,
    setActiveFolder,
    storageScopeKey,
    togglePaperSelection,
  } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);

  const ingestFiles = useCallback(async (files: File[]) => {
    setUploadSummary(null);
    const outcome = await uploadDiscoveredSourceFiles({ files, notebookId });
    if (outcome.papers.length === 0) {
      throw new Error(outcome.errors[0] || '来源入库失败，请重试。');
    }

    const targetFolderId = activeFolderId || addFolder('论文检索');
    setActiveFolder(targetFolderId);
    outcome.papers.forEach(paper => {
      addPaper(targetFolderId, paper);
      window.setTimeout(() => togglePaperSelection(paper.id), 0);
    });
    setUploadSummary({ added: outcome.papers.length, errors: outcome.errors });
    return outcome.papers.length;
  }, [activeFolderId, addFolder, addPaper, notebookId, setActiveFolder, togglePaperSelection]);

  return (
    <div className="space-y-3" data-testid="paper-search-panel">
      {uploadSummary && (
        <div
          className={uploadSummary.errors.length > 0
            ? 'flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2'
            : 'flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2'}
          data-testid="paper-search-upload-summary"
        >
          {uploadSummary.errors.length > 0
            ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />}
          <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
            已加入 {uploadSummary.added} 个来源
            {uploadSummary.errors.length > 0 ? `；${uploadSummary.errors.length} 个来源入库失败。` : '，并自动选中用于后续问答。'}
          </p>
        </div>
      )}
      <DiscoverSourcesModal
        variant="embedded"
        initialScope="scholar"
        notebookId={notebookId}
        onClose={() => undefined}
        onIngestFiles={ingestFiles}
      />
    </div>
  );
}
