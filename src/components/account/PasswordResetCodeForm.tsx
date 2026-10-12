'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientApiRequest, detectClientBasePath } from '@/lib/client-api';
import { clearAccountSession } from '@/lib/account-session-browser';

const CHALLENGE_KEY = 'knowtrail:password-reset-code-challenge';

export function PasswordResetCodeForm({ initialEmail = '' }: { initialEmail?: string }) {
  const id = useId();
  const [email, setEmail] = useState(initialEmail);
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loginHref, setLoginHref] = useState('/account');

  useEffect(() => {
    setLoginHref(`${detectClientBasePath()}/account`);
    try {
      const saved = JSON.parse(sessionStorage.getItem(CHALLENGE_KEY) || 'null') as { email?: string; challengeId?: string; requestedAt?: number } | null;
      if (!saved || typeof saved.email !== 'string' || typeof saved.requestedAt !== 'number' || typeof saved.challengeId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.challengeId)) return;
      const age = Math.floor((Date.now() - saved.requestedAt) / 1000);
      if (age < 0 || age >= 600) { sessionStorage.removeItem(CHALLENGE_KEY); return; }
      if (initialEmail && initialEmail.trim().toLowerCase() !== saved.email) return;
      setEmail(saved.email); setChallengeId(saved.challengeId); setCooldown(Math.max(0, 60 - age));
      setMessage('请在当前页面输入邮箱中的验证码和新密码。验证码 10 分钟内有效。');
    } catch { /* Recovery remains available when browser storage is unavailable. */ }
  }, [initialEmail]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    if (busy || cooldown) return;
    setError(''); setMessage('');
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError('请输入有效的注册邮箱。'); return; }
    setBusy(true);
    try {
      const response = await clientApiRequest('/api/account/password-reset/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, mode: 'email_code' }), skipAuth: true, redirectOnUnauthorized: false, timeoutMs: 40_000,
      });
      const result = await response.json() as { error?: string; message?: string; mode?: string; challengeId?: string };
      if (!response.ok) throw new Error(result.error || '验证码暂时无法发送，请稍后重试。');
      if (result.mode !== 'email_code' || !result.challengeId || !/^[A-Za-z0-9_-]{43}$/.test(result.challengeId)) throw new Error('验证码服务暂未就绪，请稍后重试。');
      setEmail(address); setChallengeId(result.challengeId); setCode(''); setCooldown(60);
      setMessage(result.message || '如果此邮箱已注册，验证码将发送到邮箱，10 分钟内有效。');
      try { sessionStorage.setItem(CHALLENGE_KEY, JSON.stringify({ email: address, challengeId: result.challengeId, requestedAt: Date.now() })); } catch { /* The current page still works without storage. */ }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '验证码发送失败。'); }
    finally { setBusy(false); }
  }

  async function resetPassword() {
    if (busy) return;
    setError('');
    if (!challengeId) { setError('请先发送邮箱验证码。'); return; }
    if (!/^[0-9]{6}$/.test(code)) { setError('请输入 6 位邮箱验证码。'); return; }
    if (password.length < 8 || password.length > 128) { setError('新密码需要 8–128 位。'); return; }
    if (password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    setBusy(true);
    try {
      const response = await clientApiRequest('/api/account/password-reset/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, code, password }), skipAuth: true, redirectOnUnauthorized: false,
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '密码重置失败，请稍后重试。');
      setPassword(''); setConfirmation(''); setCode(''); setChallengeId(''); setDone(true);
      try { sessionStorage.removeItem(CHALLENGE_KEY); } catch { /* No password or code was persisted. */ }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '密码重置失败。'); }
    finally { setBusy(false); }
  }

  if (done) return <div className="space-y-4" data-testid="password-reset-code-form"><p role="status" className="text-sm leading-6 text-emerald-600">密码已重置，旧登录会话已失效。请使用新密码重新登录。</p><a href={loginHref} onClick={() => clearAccountSession()} className="inline-flex min-h-11 items-center text-sm text-blue-600 underline underline-offset-4">重新登录</a></div>;

  return <div className="space-y-4" data-testid="password-reset-code-form" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!busy) void (challengeId ? resetPassword() : sendCode()); } }}>
    <p className="text-sm leading-6 text-[var(--text-secondary)]">接收 6 位邮箱验证码后，在当前页面直接设置新密码。验证码 10 分钟内有效，重新发送后旧验证码失效。</p>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <div><label htmlFor={`${id}-email`} className="text-sm">注册邮箱</label><Input id={`${id}-email`} className="mt-2 min-h-11" type="email" autoComplete="email" maxLength={160} value={email} onChange={event => { setEmail(event.target.value); setChallengeId(''); setCode(''); setCooldown(0); setMessage(''); try { sessionStorage.removeItem(CHALLENGE_KEY); } catch { /* Optional storage. */ } }} /></div>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy || cooldown > 0} onClick={() => void sendCode()}>{busy ? '正在处理…' : cooldown > 0 ? `${cooldown} 秒后可重发` : challengeId ? '重新发送验证码' : '发送验证码'}</Button>
      {message && <p role="status" className="text-sm leading-6 text-emerald-600">{message}</p>}
      {challengeId && <>
        <div><label htmlFor={`${id}-code`} className="text-sm">邮箱验证码</label><Input id={`${id}-code`} className="mt-2 min-h-11" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></div>
        <div><label htmlFor={`${id}-password`} className="text-sm">新密码</label><Input id={`${id}-password`} className="mt-2 min-h-11" type="password" autoComplete="new-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></div>
        <div><label htmlFor={`${id}-confirmation`} className="text-sm">确认新密码</label><Input id={`${id}-confirmation`} className="mt-2 min-h-11" type="password" autoComplete="new-password" maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div>
        <Button type="button" className="min-h-11 w-full" disabled={busy} onClick={() => void resetPassword()}>确认重置密码</Button>
      </>}
    </fieldset>
    {error && <p role="alert" className="text-sm leading-6 text-rose-600">{error}</p>}
  </div>;
}
