'use client';

export function SavedToolStatus({ saved, guest }: {
  saved: { loading: boolean; saving: boolean; error: string | null; conflict: boolean; unsaved: boolean; readFailed: boolean; retry: () => void; retryRead: () => void; reload: () => void };
  guest: boolean;
}) {
  return <>
    {guest && <p className="text-xs text-[var(--text-tertiary)]">访客内容仅保存在当前浏览器。</p>}
    {saved.loading && <p className="text-xs" role="status">正在读取已保存内容…</p>}
    {saved.saving && <p className="text-xs" role="status">正在保存…</p>}
    {saved.error && <div className="rounded-xl border p-3 text-xs" role="alert"><p>{saved.error}</p><button type="button" className="mt-2 underline" onClick={saved.conflict ? saved.reload : saved.readFailed ? saved.retryRead : saved.retry}>{saved.conflict ? '读取已保存内容（将替换当前草稿）' : saved.readFailed ? '重试读取' : '重试保存'}</button></div>}
    {saved.unsaved && !saved.saving && !saved.error && <button type="button" className="text-xs underline" onClick={saved.retry}>内容尚未保存，重试保存</button>}
  </>;
}
