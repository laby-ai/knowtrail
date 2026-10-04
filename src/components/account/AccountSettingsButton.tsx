'use client';

import { useEffect, useState } from 'react';
import { Settings, UserRound, ShieldCheck, KeyRound, LogOut } from 'lucide-react';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BailianProviderSettings } from '@/components/account/BailianProviderSettings';

function SecuritySettings({ session, onSignOut }: { session: AccountAuthSession; onSignOut: () => void }) {
  const [email, setEmail] = useState(session.member.email || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function requestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/account/password-reset/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || '暂时无法提交重置请求。');
      setMessage(result.message || '重置请求已提交，请查看邮箱。');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '暂时无法提交重置请求。');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={event => void requestReset(event)} className="space-y-3">
        <h3 className="text-sm font-semibold">密码重置</h3>
        <p className="text-sm text-[var(--text-secondary)]">通过注册邮箱接收重置指引，设置新的登录密码。</p>
        <label className="block text-sm">注册邮箱
          <input type="email" required maxLength={160} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className="liquid-glass-input mt-2 h-10 w-full rounded-lg px-3" />
        </label>
        <button type="submit" disabled={busy} className="liquid-glass-btn px-4 py-2 text-sm disabled:opacity-50">{busy ? '正在提交…' : '发送重置指引'}</button>
        {message && <p role="status" className="text-sm text-emerald-600">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
      <div className="border-t border-[var(--border-subtle)] pt-5">
        <h3 className="mb-3 text-sm font-semibold">登录会话</h3>
        <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-500/10"><LogOut className="h-4 w-4" />退出当前账号</button>
      </div>
    </div>
  );
}

export function AccountSettingsButton({ session, onSignOut }: { session: AccountAuthSession; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [resolvedSession, setResolvedSession] = useState<AccountAuthSession | null>(null);
  const [profileError, setProfileError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResolvedSession(null);
    setProfileError('');
    async function loadAccount() {
      try {
        const response = await fetch('/api/account/session', {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401
          ? '登录状态已失效，请退出后重新登录。' : '暂时无法读取账号系统信息，请重试。');
        const profile = await response.json() as Partial<AccountAuthSession>;
        if (!profile.member?.id || typeof profile.member.display_name !== 'string' || typeof profile.member.email !== 'string') {
          throw new Error('账号系统返回的信息不完整，请重试。');
        }
        if (!controller.signal.aborted) setResolvedSession({
          token: session.token, expires_at: profile.expires_at || '',
          member: profile.member, tenant_id: profile.tenant_id || '', tenant_name: profile.tenant_name || '',
        });
      } catch (failure) {
        if (!controller.signal.aborted) setProfileError(failure instanceof Error ? failure.message : '暂时无法读取账号信息。');
      }
    }
    void loadAccount();
    return () => controller.abort();
  }, [open, session.token, refresh]);
  const account = resolvedSession?.token === session.token ? resolvedSession : null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" aria-label="设置" data-testid="account-settings-button" className="liquid-glass-btn pointer-events-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium text-[var(--text-primary)]">
          <Settings className="h-5 w-5" /><span>设置</span>
        </button>
      </DialogTrigger>
      <DialogContent data-testid="account-settings-dialog" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>管理账号、安全和百炼模型配置。</DialogDescription>
        </DialogHeader>
        {profileError ? <div className="mt-5 space-y-3">
          <p role="alert" className="text-sm text-red-600">{profileError}</p>
          <button type="button" onClick={() => setRefresh(value => value + 1)} className="liquid-glass-btn px-3 py-2 text-sm">重新加载</button>
          <button type="button" onClick={() => { setOpen(false); onSignOut(); }} className="ml-3 text-sm text-red-600">退出账号</button>
        </div> : !account ? <p role="status" className="mt-5 text-sm text-[var(--text-secondary)]">正在同步账号信息…</p> : <Tabs defaultValue="account" className="mt-5">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="account"><UserRound className="h-4 w-4" />账号</TabsTrigger>
            <TabsTrigger value="security"><ShieldCheck className="h-4 w-4" />安全</TabsTrigger>
            <TabsTrigger value="bailian"><KeyRound className="h-4 w-4" />百炼</TabsTrigger>
          </TabsList>
          <TabsContent value="account" className="pt-4">
            <h3 className="mb-4 text-sm font-semibold">账号信息</h3>
            <dl className="space-y-4 text-sm">
              <div><dt className="text-[var(--text-secondary)]">显示名称</dt><dd className="mt-1 break-words">{account.member.display_name || '未设置'}</dd></div>
              <div><dt className="text-[var(--text-secondary)]">邮箱</dt><dd className="mt-1 break-all">{account.member.email || '账号系统未提供邮箱'}</dd></div>
              {account.tenant_name && <div><dt className="text-[var(--text-secondary)]">所属组织</dt><dd className="mt-1 break-words">{account.tenant_name}</dd></div>}
            </dl>
          </TabsContent>
          <TabsContent value="security" className="pt-4"><SecuritySettings session={account} onSignOut={() => { setOpen(false); onSignOut(); }} /></TabsContent>
          <TabsContent value="bailian" className="pt-4"><BailianProviderSettings session={account} /></TabsContent>
        </Tabs>}
      </DialogContent>
    </Dialog>
  );
}
