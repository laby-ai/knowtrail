'use client';

export function SavedVersionNotice({ saved, testId }: {
  saved: { savedVersionNotice: boolean; canReadSavedVersion: boolean; readSelectedVersion: () => void };
  testId: string;
}) {
  if (!saved.savedVersionNotice) return null;
  return <div role="status" data-testid={testId} className="space-y-2 rounded-xl border border-amber-400/25 p-3 text-xs text-[var(--text-secondary)]">
    <p>当前草稿或任务已保留。处理完成后，可读取刚才选择的保存版本。</p>
    <button type="button" disabled={!saved.canReadSavedVersion} onClick={saved.readSelectedVersion} className="underline disabled:opacity-45">读取所选保存版本</button>
  </div>;
}

export function SavedToolStatus({ saved, guest, conflictLabel = '读取已保存内容（将替换当前草稿）' }: {
  saved: { loading: boolean; saving: boolean; error: string | null; conflict: boolean; unsaved: boolean; readFailed: boolean; retry: () => void; retryRead: () => void; reload: () => void };
  guest: boolean;
  conflictLabel?: string;
}) {
  return <>
    {guest && <p className="text-xs text-[var(--text-tertiary)]">访客内容仅保存在当前浏览器。</p>}
    {saved.loading && <p className="text-xs" role="status">正在读取已保存内容…</p>}
    {saved.saving && <p className="text-xs" role="status">正在保存…</p>}
    {saved.error && <div className="rounded-xl border p-3 text-xs" role="alert"><p>{saved.error}</p><button type="button" className="mt-2 underline" onClick={saved.conflict ? saved.reload : saved.readFailed ? saved.retryRead : saved.retry}>{saved.conflict ? conflictLabel : saved.readFailed ? '重试读取' : '重试保存'}</button></div>}
    {saved.unsaved && !saved.saving && !saved.error && <button type="button" className="text-xs underline" onClick={saved.retry}>内容尚未保存，重试保存</button>}
  </>;
}
