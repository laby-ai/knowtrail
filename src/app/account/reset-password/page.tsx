'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientApiRequest, detectClientBasePath } from '@/lib/client-api';
import { clearAccountSession } from '@/lib/account-session-browser';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loginHref, setLoginHref] = useState('/account');
  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
    // Do not keep the recovery secret in the address bar or browser history.
    window.history.replaceState(null, '', window.location.pathname);
    setLoginHref(`${detectClientBasePath()}/account`);
    setReady(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    setBusy(true);
    try {
      const response = await clientApiRequest('/api/account/password-reset/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }), skipAuth: true, redirectOnUnauthorized: false,
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '密码重置失败，请重试。');
      clearAccountSession();
      setPassword(''); setConfirmation(''); setToken(''); setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '密码重置失败，请重试。');
    } finally { setBusy(false); }
  }

  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--bg-primary)] px-4 py-10 text-[var(--text-primary)]">
      <section className="w-full max-w-md space-y-6 rounded-2xl border border-[var(--border-subtle)] p-6 sm:p-8">
        <BrandMark compact />
        <div className="space-y-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><KeyRound className="h-5 w-5" />设置新密码</h1>
          <p className="text-sm leading-6 text-[var(--text-secondary)]">重置链接有效期 15 分钟，仅可使用一次。成功后，其他设备上的旧登录会话将退出。</p>
        </div>
        {!ready ? <p role="status">正在读取重置链接…</p> : done ? <p role="status" className="text-sm leading-6 text-emerald-600">密码已重置，请使用新密码重新登录。</p> : !validToken ? <p role="alert" className="text-sm leading-6">链接缺少有效凭证。请返回登录页重新申请找回密码，再打开最新邮件中的链接。</p> : (
          <form onSubmit={event => void submit(event)} className="space-y-5">
            <label className="block space-y-2 text-sm">新密码<Input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
            <label className="block space-y-2 text-sm">确认新密码<Input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></label>
            {error && <p role="alert" className="text-sm leading-6 text-rose-600">{error}</p>}
            <Button type="submit" disabled={busy} className="min-h-11 w-full">{busy ? '正在重置…' : '确认重置密码'}</Button>
          </form>
        )}
        <Link href={loginHref} className="block text-sm text-blue-600 underline underline-offset-4">返回登录页</Link>
      </section>
    </main>
  );
}
