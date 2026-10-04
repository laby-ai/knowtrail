'use client';

import { useState } from 'react';
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
        <Tabs defaultValue="account" className="mt-5">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="account"><UserRound className="h-4 w-4" />账号</TabsTrigger>
            <TabsTrigger value="security"><ShieldCheck className="h-4 w-4" />安全</TabsTrigger>
            <TabsTrigger value="bailian"><KeyRound className="h-4 w-4" />百炼</TabsTrigger>
          </TabsList>
          <TabsContent value="account" className="pt-4">
            <h3 className="mb-4 text-sm font-semibold">账号信息</h3>
            <dl className="space-y-4 text-sm">
              <div><dt className="text-[var(--text-secondary)]">显示名称</dt><dd className="mt-1 break-words">{session.member.display_name || '当前账号'}</dd></div>
              <div><dt className="text-[var(--text-secondary)]">邮箱</dt><dd className="mt-1 break-all">{session.member.email || '暂未获取邮箱信息'}</dd></div>
              {session.tenant_name && <div><dt className="text-[var(--text-secondary)]">所属组织</dt><dd className="mt-1 break-words">{session.tenant_name}</dd></div>}
            </dl>
          </TabsContent>
          <TabsContent value="security" className="pt-4"><SecuritySettings session={session} onSignOut={() => { setOpen(false); onSignOut(); }} /></TabsContent>
          <TabsContent value="bailian" className="pt-4"><BailianProviderSettings session={session} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}