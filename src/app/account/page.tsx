'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, FileText, Loader2, LogIn, Mail, Quote, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { BrandMark } from '@/components/brand/BrandMark';
import { clearAccountSession, readStoredAccountSession, saveAccountSession } from '@/lib/account-session-browser';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import type { LucideIcon } from 'lucide-react';

type AuthMode = 'login' | 'register';
type SessionGateState = 'checking' | 'guest' | 'signed-in';

const NOTEBOOK_HOME_HREF = '/?view=notebooks';
const ACCOUNT_HIGHLIGHTS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: BookOpen, title: '工作本', body: '上次打开的内容会继续保留。' },
  { icon: FileText, title: '资料', body: '上传过的文件和网页还能接着用。' },
  { icon: Quote, title: '引用', body: '回答旁边保留可回看的来源线索。' },
];

function safeInternalHref(value: string | null): string {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return NOTEBOOK_HOME_HREF;
  return candidate;
}

function nextHref(): string {
  if (typeof window === 'undefined') return NOTEBOOK_HOME_HREF;
  const params = new URLSearchParams(window.location.search);
  return safeInternalHref(params.get('next'));
}

function isOrdinaryUser(session: AccountAuthSession): boolean {
  return session.member.role_key !== 'tenant_admin';
}

function userFacingError(message: string): string {
  const map: Record<string, string> = {
    invalid_email_or_password: '邮箱或密码不正确。',
    email_already_registered: '这个邮箱已经注册，请直接登录。',
    account_api_not_configured: '暂时无法登录，请稍后再试。',
    display_name_required: '请填写昵称。',
    admin_account_not_allowed: '当前邮箱暂不能进入个人工作本，请换一个邮箱。',
    invalid_or_expired_session: '登录状态已过期，请重新登录。',
  };
  return map[message] || '暂时无法登录，请稍后再试。';
}

export default function AccountPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionGate, setSessionGate] = useState<SessionGateState>('checking');
  const [existingSession, setExistingSession] = useState<AccountAuthSession | null>(null);
  const [target, setTarget] = useState(NOTEBOOK_HOME_HREF);
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);
  const redirectTimerRef = useRef<number | null>(null);

  const cancelRedirect = () => {
    if (redirectTimerRef.current) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const nextTarget = nextHref();
    setTarget(nextTarget);
    setHydrated(true);

    async function resumeExistingSession() {
      const stored = readStoredAccountSession();
      if (!stored) {
        if (!cancelled) setSessionGate('guest');
        return;
      }
      try {
        const response = await fetch('/api/account/session', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${stored.token}` },
        });
        if (!response.ok) {
          if (!cancelled) clearAccountSession();
          throw new Error('invalid_or_expired_session');
        }
        const context = await response.json() as Partial<AccountAuthSession>;
        const merged = { ...stored, ...context, token: stored.token, expires_at: stored.expires_at } as AccountAuthSession;
        if (!isOrdinaryUser(merged)) {
          if (!cancelled) clearAccountSession();
          throw new Error('admin_account_not_allowed');
        }
        saveAccountSession(merged);
        if (!cancelled) {
          setExistingSession(merged);
          setSessionGate('signed-in');
          redirectTimerRef.current = window.setTimeout(() => {
            window.location.replace(nextTarget);
          }, 550);
        }
      } catch (err) {
        if (cancelled) return;
        setExistingSession(null);
        setSessionGate('guest');
        setError(userFacingError(err instanceof Error ? err.message : 'invalid_or_expired_session'));
      }
    }

    void resumeExistingSession();
    return () => {
      cancelled = true;
      cancelRedirect();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !hydrated || sessionGate === 'checking') return;
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/account/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, email, password, displayName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.error || 'account_auth_failed'));
      const session = payload as AccountAuthSession;
      if (!isOrdinaryUser(session)) throw new Error('admin_account_not_allowed');
      saveAccountSession(session);
      window.location.replace(target);
    } catch (err) {
      setError(userFacingError(err instanceof Error ? err.message : 'account_auth_failed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitPasswordReset() {
    if (isResetSubmitting || !hydrated || sessionGate === 'checking') return;
    setResetError('');
    setResetMessage('');
    setIsResetSubmitting(true);
    try {
      const response = await fetch('/api/account/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail || email }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.error || '暂时无法提交找回请求，请稍后再试。'));
      setResetMessage(String(payload.message || '如果这个邮箱已注册，重置指引会发送到邮箱。'));
    } catch (err) {
      setResetError(err instanceof Error ? err.message : '暂时无法提交找回请求，请稍后再试。');
    } finally {
      setIsResetSubmitting(false);
    }
  }

  const switchToGuestLogin = () => {
    cancelRedirect();
    clearAccountSession();
    setExistingSession(null);
    setSessionGate('guest');
    setError('');
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setResetOpen(false);
    setResetError('');
    setResetMessage('');
  };

  const openPasswordReset = () => {
    setResetEmail((current) => current || email);
    setResetOpen(true);
    setResetError('');
    setResetMessage('');
  };

  return (
    <main className="min-h-screen bg-[#eef4ff] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5">
        <header className="flex items-center justify-between rounded-full bg-white/74 px-4 py-3 shadow-[0_14px_40px_rgba(37,99,235,0.08)] backdrop-blur-xl">
          <Link href="/" className="inline-flex items-center gap-3">
            <BrandMark compact />
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight">KnowTrail</span>
          </Link>
          <Link href="/" className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-950">
            返回首页
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-8 py-8 md:grid-cols-[0.92fr_1.08fr] lg:gap-12">
          <div className="max-w-xl">
            <h1 className="text-5xl font-normal leading-[1.06] tracking-[-0.03em] text-[#303134] md:text-6xl">
              继续上次的工作本
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              登录后，资料、问答和整理结果都会回到这里。
            </p>
            <div className="mt-8 space-y-3">
              {ACCOUNT_HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-white/70 px-4 py-3 shadow-[0_12px_34px_rgba(37,99,235,0.07)] backdrop-blur">
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="font-semibold text-slate-900">{title}</div>
                    <p className="mt-0.5 text-sm leading-6 text-slate-600">{body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 hidden rounded-[30px] border border-blue-100 bg-white/70 p-4 shadow-[0_24px_70px_rgba(37,99,235,0.09)] backdrop-blur xl:block">
              <div className="relative min-h-52 overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_76%_28%,rgba(191,219,254,0.78),transparent_34%),radial-gradient(circle_at_22%_76%,rgba(209,250,229,0.75),transparent_34%),#ffffff] p-6">
                <div className="absolute left-7 top-7 rounded-2xl border border-emerald-100 bg-emerald-50/88 px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <FileText className="h-4 w-4" />
                    资料已就绪
                  </div>
                  <div className="mt-3 h-2 w-36 rounded-full bg-emerald-200/80" />
                  <div className="mt-2 h-2 w-24 rounded-full bg-emerald-100" />
                </div>
                <div className="absolute right-7 top-14 rounded-2xl border border-blue-100 bg-blue-50/90 px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                    <Quote className="h-4 w-4" />
                    回答带来源
                  </div>
                  <div className="mt-3 h-2 w-40 rounded-full bg-blue-200/85" />
                  <div className="mt-2 h-2 w-28 rounded-full bg-blue-100" />
                </div>
                <div className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-blue-100 bg-white/90 px-5 py-3 shadow-[0_18px_46px_rgba(37,99,235,0.13)]">
                  <BrandMark compact className="h-10 w-10 border-blue-100 shadow-none" />
                  <div>
                    <div className="text-sm font-semibold text-slate-950">KnowTrail</div>
                    <div className="text-xs text-slate-500">资料、回答和笔记会保留在同一个工作本里。</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-blue-100 bg-white/94 p-3 shadow-[0_28px_80px_rgba(37,99,235,0.14)] backdrop-blur">
            <div className="rounded-[26px] bg-[#f8fbff] p-6 sm:p-8">
              {sessionGate === 'signed-in' && existingSession ? (
                <div className="py-6" data-testid="account-existing-session">
                  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                    <Sparkles size={22} />
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-950">已为你登录</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {existingSession.member.display_name} · {existingSession.member.email}
                  </p>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href={target}
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_12px_26px_rgba(37,99,235,0.20)] transition hover:bg-blue-700"
                      data-testid="account-continue"
                    >
                      打开工作本
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={switchToGuestLogin}
                      className="inline-flex h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                    >
                      使用其他邮箱
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-7">
                    <div>
                      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                        {sessionGate === 'checking' ? <Loader2 size={22} className="animate-spin" /> : <LogIn size={22} />}
                      </div>
                      <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
                        {mode === 'login' ? '欢迎回来' : '开始新的工作本'}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {mode === 'login' ? '用邮箱继续上次的工作。' : '几秒钟后就可以开始第一个工作本。'}
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 grid grid-cols-2 rounded-full bg-[#eaf2ff] p-1 text-sm font-semibold">
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      disabled={!hydrated || sessionGate === 'checking'}
                      aria-pressed={mode === 'login'}
                      data-testid="account-mode-login"
                      className={`rounded-full px-4 py-3 transition disabled:cursor-not-allowed disabled:opacity-60 ${mode === 'login' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      登录
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      disabled={!hydrated || sessionGate === 'checking'}
                      aria-pressed={mode === 'register'}
                      data-testid="account-mode-register"
                      className={`rounded-full px-4 py-3 transition disabled:cursor-not-allowed disabled:opacity-60 ${mode === 'register' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      注册
                    </button>
                  </div>

                  <form className="space-y-4" onSubmit={submit}>
                    {mode === 'register' && (
                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">昵称</span>
                        <input
                          value={displayName}
                          onChange={(event) => setDisplayName(event.target.value)}
                          className="mt-2 h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                          placeholder="例如：小林"
                          autoComplete="name"
                          data-testid="account-display-name"
                        />
                      </label>
                    )}
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">邮箱</span>
                      <input
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="mt-2 h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                        placeholder="请输入邮箱"
                        type="email"
                        autoComplete="email"
                        data-testid="account-email"
                      />
                    </label>
                    <label className="block">
                      <span className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
                        <span>密码</span>
                        {mode === 'login' && (
                          <button
                            type="button"
                            onClick={openPasswordReset}
                            className="text-sm font-semibold text-blue-600 transition hover:text-blue-700"
                            data-testid="account-forgot-password"
                          >
                            忘记密码？
                          </button>
                        )}
                      </span>
                      <input
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="mt-2 h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                        placeholder="至少 8 位"
                        type="password"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        data-testid="account-password"
                      />
                    </label>

                    {mode === 'login' && resetOpen && (
                      <div className="rounded-3xl border border-blue-100 bg-white px-4 py-4 shadow-[0_14px_34px_rgba(37,99,235,0.08)]" data-testid="account-password-reset-panel">
                        <div className="flex items-start gap-3">
                          <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                            <Mail className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-950">找回密码</div>
                            <p className="mt-1 text-sm leading-6 text-slate-500">输入注册邮箱，我们会提交找回请求。</p>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                              <input
                                value={resetEmail}
                                onChange={(event) => setResetEmail(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void submitPasswordReset();
                                  }
                                }}
                                className="h-11 min-w-0 flex-1 rounded-full border border-slate-200 bg-[#f8fbff] px-4 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                                placeholder="你的邮箱"
                                type="email"
                                autoComplete="email"
                                data-testid="account-reset-email"
                              />
                              <button
                                type="button"
                                onClick={submitPasswordReset}
                                disabled={isResetSubmitting}
                                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                                data-testid="account-reset-submit"
                              >
                                {isResetSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                提交
                              </button>
                            </div>
                            {resetMessage && <p className="mt-3 text-sm leading-6 text-emerald-700">{resetMessage}</p>}
                            {resetError && <p className="mt-3 text-sm leading-6 text-rose-700">{resetError}</p>}
                          </div>
                        </div>
                      </div>
                    )}

                    {error && (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || !hydrated || sessionGate === 'checking'}
                      data-testid="account-submit"
                      className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-5 py-4 text-base font-semibold text-white shadow-[0_14px_30px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting || !hydrated || sessionGate === 'checking' ? <Loader2 size={20} className="animate-spin" /> : null}
                      {sessionGate === 'checking' ? '正在准备' : mode === 'login' ? '进入工作本' : '创建并进入'}
                      {!isSubmitting && hydrated && sessionGate !== 'checking' && <ArrowRight size={18} />}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
