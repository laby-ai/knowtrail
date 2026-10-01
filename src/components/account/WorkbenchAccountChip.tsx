'use client';

import { useEffect, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { readStoredAccountSession } from '@/lib/account-session-browser';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import { BailianProviderButton } from '@/components/account/BailianProviderButton';

export function WorkbenchAccountChip({
  accountSession,
  onSignOut,
}: {
  accountSession: AccountAuthSession | null;
  onSignOut: () => void;
}) {
  const [storedSession, setStoredSession] = useState<AccountAuthSession | null>(null);

  useEffect(() => {
    if (accountSession) setStoredSession(accountSession);
  }, [accountSession]);

  useEffect(() => {
    let cancelled = false;

    async function refreshSession() {
      const stored = readStoredAccountSession();
      if (!stored) {
        if (!cancelled) setStoredSession(null);
        return;
      }
      if (!cancelled) setStoredSession(stored);

      try {
        const response = await fetch('/api/account/session', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${stored.token}` },
        });
        if (!response.ok) return;
        const context = await response.json() as Partial<AccountAuthSession>;
        if (!cancelled && context.member?.id) {
          setStoredSession({ ...stored, ...context, token: stored.token, expires_at: stored.expires_at });
        }
      } catch {
        // Keep the locally stored account visible; protected API routes still enforce the token.
      }
    }

    void refreshSession();
    window.addEventListener('knowtrail-account-session-changed', refreshSession);
    return () => {
      cancelled = true;
      window.removeEventListener('knowtrail-account-session-changed', refreshSession);
    };
  }, []);

  const session = accountSession || storedSession;
  if (!session) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/92 px-3 py-2 text-[var(--text-primary)] shadow-[0_18px_42px_rgba(15,23,42,0.16)] backdrop-blur-xl"
      data-testid="workbench-account-chip"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--accent-blue)]/12 text-[var(--accent-blue)]">
        <UserRound className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="max-w-44 truncate text-xs font-semibold" data-testid="workbench-account-chip-name">
          {session.member.display_name}
        </p>
        <p className="max-w-44 truncate text-[10px] text-[var(--text-tertiary)]" data-testid="workbench-account-chip-email">
          {session.member.email}
        </p>
      </div>
      <BailianProviderButton session={session} compact />
      <button
        type="button"
        onClick={onSignOut}
        className="pointer-events-auto ml-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] transition hover:border-[var(--accent-blue)] hover:text-[var(--text-primary)]"
        aria-label="退出当前账号"
        title="退出当前账号"
        data-testid="workbench-account-chip-sign-out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
