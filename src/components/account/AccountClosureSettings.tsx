'use client';
import { useEffect, useState } from 'react';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import { checkedApiFetch } from '@/lib/api-response';
import { useAppPreferences } from './AppPreferencesProvider';
type Closure = { id: string; status: string; createdAt: string };
export function AccountClosureSettings({ session }: { session: AccountAuthSession }) {
  const [request, setRequest] = useState<Closure | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { preferences } = useAppPreferences();
  const en = preferences.interfaceLanguage === 'en';
  useEffect(() => {
    const controller = new AbortController();
    void checkedApiFetch('/api/account/closure', { headers: { Authorization: `Bearer ${session.token}` }, signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted) setRequest(data.request); }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '读取失败'); });
    return () => controller.abort();
  }, [session.token]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await checkedApiFetch('/api/account/closure', { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password, confirmation }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setRequest(data.request); setPassword(''); setConfirmation(''); setExpanded(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '提交失败'); }
    finally { setBusy(false); }
  }
  return <section className="mt-7 space-y-3 border-t border-[var(--border-subtle)] pt-5">
    <h3 className="text-sm font-semibold text-red-600">{en ? 'Close account' : '注销账号'}</h3>
    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{en ? 'Submit a closure request to the account service for review. Export your research first. Team ownership, subscriptions, outstanding tasks and refunds must be resolved before closure. Submission does not immediately delete your data or close your account.' : '先下载所需资料，再向账号系统提交注销申请。课题组归属、订阅、未完成任务和退款需先核对处理。申请提交后等待审核，不会立即注销账号或删除资料。'}</p>
    {request ? <div role="status" className="break-all rounded-xl border border-[var(--border-subtle)] p-4 text-sm">{en ? 'Closure request submitted · Awaiting review' : '注销申请已提交 · 等待审核'}<p className="mt-2 text-xs text-[var(--text-secondary)]">{request.id}</p></div> : expanded ? <form onSubmit={event => void submit(event)} className="space-y-3">
      <label className="block text-sm">{en ? 'Current password' : '当前账号密码'}<input type="password" required autoComplete="current-password" maxLength={512} value={password} onChange={event => setPassword(event.target.value)} className="liquid-glass-input mt-2 w-full rounded-xl px-3 py-3" /></label>
      <label className="block text-sm">{en ? 'Type 注销账号 to confirm' : '输入“注销账号”确认'}<input required value={confirmation} onChange={event => setConfirmation(event.target.value)} className="liquid-glass-input mt-2 w-full rounded-xl px-3 py-3" /></label>
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || confirmation !== '注销账号' || !password} className="rounded-xl bg-red-600 px-4 py-3 text-sm text-white disabled:opacity-50">{busy ? (en ? 'Submitting…' : '正在提交…') : (en ? 'Submit closure request' : '确认提交注销申请')}</button><button type="button" disabled={busy} onClick={() => { setExpanded(false); setPassword(''); setConfirmation(''); }} className="liquid-glass-btn rounded-xl px-4 py-3 text-sm">{en ? 'Cancel' : '取消'}</button></div>
    </form> : <button type="button" onClick={() => setExpanded(true)} className="rounded-xl border border-red-500/40 px-4 py-3 text-sm text-red-600">{en ? 'Request account closure' : '申请注销账号'}</button>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>;
}
