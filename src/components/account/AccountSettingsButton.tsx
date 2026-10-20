'use client';
import { checkedApiFetch } from '@/lib/api-response';

import { useAppPreferences } from './AppPreferencesProvider';
import { ShortcutSettings } from './ShortcutSettings';
import { AboutSettings } from './AboutSettings';
import { GeneralSettings } from './GeneralSettings';
import { HistorySettings } from './HistorySettings';
import { AccountClosureSettings } from './AccountClosureSettings';
import { MembershipPanel } from './commerce/MembershipPanel';
import { useEffect, useState } from 'react';
import { Settings, UserRound, ShieldCheck, KeyRound, LogOut, Wallet, SlidersHorizontal, History, Info, Keyboard } from 'lucide-react';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BailianProviderSettings } from '@/components/account/BailianProviderSettings';
import { PasswordResetCodeForm } from '@/components/account/PasswordResetCodeForm';

function SecuritySettings({ session, onSignOut }: { session: AccountAuthSession; onSignOut: () => void }) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">密码重置</h3>
        <PasswordResetCodeForm initialEmail={session.member.email} />
      </section>
      <div className="border-t border-[var(--border-subtle)] pt-5">
        <h3 className="mb-3 text-sm font-semibold">登录会话</h3>
        <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-500/10"><LogOut className="h-4 w-4" />退出当前账号</button>
      </div>
    </div>
  );
}

export function AccountSettingsButton({ session, onSignOut }: { session: AccountAuthSession; onSignOut: () => void }) {
  const { preferences } = useAppPreferences();
  const en = preferences.interfaceLanguage === 'en';
  const [open, setOpen] = useState(false);
  const [resolvedSession, setResolvedSession] = useState<AccountAuthSession | null>(null);
  const [profileError, setProfileError] = useState('');
  const [section, setSection] = useState('general');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResolvedSession(null);
    setProfileError('');
    async function loadAccount() {
      try {
        const response = await checkedApiFetch('/api/account/session', {
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
          <Settings className="h-5 w-5" /><span>{en ? 'Settings' : '设置'}</span>
        </button>
      </DialogTrigger>
      <DialogContent data-testid="account-settings-dialog" className="grid max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-5xl sm:p-7" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <DialogHeader className="space-y-3 text-left">
          <DialogTitle>{en ? 'Settings' : '设置'}</DialogTitle>
          <DialogDescription className="leading-6">{en ? 'Manage preferences, account, research history and usage.' : '管理通用偏好、账号安全、研究历史与会员用量。'}</DialogDescription>
        </DialogHeader>
        {profileError ? <div className="mt-5 space-y-3">
          <p role="alert" className="text-sm text-red-600">{profileError}</p>
          <button type="button" onClick={() => setRefresh(value => value + 1)} className="liquid-glass-btn px-3 py-2 text-sm">重新加载</button>
          <button type="button" onClick={() => { setOpen(false); onSignOut(); }} className="ml-3 text-sm text-red-600">退出账号</button>
        </div> : !account ? <p role="status" className="mt-5 text-sm text-[var(--text-secondary)]">正在同步账号信息…</p> : <Tabs value={section} onValueChange={setSection} className="mt-1 min-w-0 gap-6 md:flex-row md:items-start">
          <label className="block text-sm md:hidden">{en ? 'Settings category' : '设置分类'}
            <select aria-label="设置分类" value={section} onChange={event => setSection(event.target.value)} className="liquid-glass-input mt-2 w-full rounded-xl bg-[var(--bg-primary)] px-3 py-3">
              <option value="general">{en ? 'General' : '通用'}</option><option value="account">{en ? 'Account' : '账号管理'}</option><option value="security">{en ? 'Security' : '安全'}</option><option value="history">{en ? 'History & downloads' : '历史与下载'}</option><option value="bailian">{en ? 'Models' : '模型配置'}</option><option value="membership">{en ? 'Membership & usage' : '会员与用量'}</option><option value="shortcuts">{en ? 'Keyboard shortcuts' : '快捷键'}</option><option value="about">{en ? 'About' : '关于'}</option>
            </select>
          </label>
          <TabsList aria-label={en ? 'Settings categories' : '设置分类'} className="hidden h-auto w-full shrink-0 grid-cols-2 gap-1 rounded-xl bg-[var(--glass-subtle)] p-2 sm:grid-cols-4 md:grid md:w-44 md:grid-cols-1 [&>button]:h-auto [&>button]:justify-start [&>button]:whitespace-normal [&>button]:px-3 [&>button]:py-3">
            <TabsTrigger value="general"><SlidersHorizontal className="h-4 w-4" />{en ? 'General' : '通用'}</TabsTrigger>
            <TabsTrigger value="account"><UserRound className="h-4 w-4" />{en ? 'Account' : '账号管理'}</TabsTrigger>
            <TabsTrigger value="security"><ShieldCheck className="h-4 w-4" />{en ? 'Security' : '安全'}</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4" />{en ? 'History & downloads' : '历史与下载'}</TabsTrigger>
            <TabsTrigger value="bailian"><KeyRound className="h-4 w-4" />{en ? 'Models' : '模型配置'}</TabsTrigger>
            <TabsTrigger value="membership"><Wallet className="h-4 w-4" />{en ? 'Membership & usage' : '会员与用量'}</TabsTrigger>
            <TabsTrigger value="shortcuts"><Keyboard className="h-4 w-4" />{en ? 'Shortcuts' : '快捷键'}</TabsTrigger>
            <TabsTrigger value="about"><Info className="h-4 w-4" />{en ? 'About' : '关于'}</TabsTrigger>
          </TabsList>
          <div className="min-w-0 flex-1 md:min-h-[28rem] md:border-l md:border-[var(--border-subtle)] md:pl-6">
          <TabsContent value="general" className="min-w-0"><GeneralSettings /></TabsContent>
          <TabsContent value="history" className="min-w-0"><HistorySettings session={account} /></TabsContent>
          <TabsContent value="shortcuts" className="min-w-0"><ShortcutSettings /></TabsContent>
          <TabsContent value="about" className="min-w-0"><AboutSettings onNavigate={setSection} /></TabsContent>
          <TabsContent value="account" className="min-w-0 pt-5 leading-6">
            <h3 className="mb-4 text-sm font-semibold">{en ? 'Account information' : '账号信息'}</h3>
            <dl className="space-y-5 text-sm">
              <div><dt className="text-[var(--text-secondary)]">{en ? 'Display name' : '显示名称'}</dt><dd className="mt-1 break-words">{account.member.display_name || '未设置'}</dd></div>
              <div><dt className="text-[var(--text-secondary)]">{en ? 'Email' : '邮箱'}</dt><dd className="mt-1 break-all">{account.member.email || '账号系统未提供邮箱'}</dd></div>
              {account.tenant_name && <div><dt className="text-[var(--text-secondary)]">{en ? 'Organization' : '所属组织'}</dt><dd className="mt-1 break-words">{account.tenant_name}</dd></div>}
            </dl>
            <AccountClosureSettings session={account} />
          </TabsContent>
          <TabsContent value="security" className="min-w-0 pt-5 leading-6"><SecuritySettings session={account} onSignOut={() => { setOpen(false); onSignOut(); }} /></TabsContent>
          <TabsContent value="bailian" className="min-w-0 pt-5 leading-6"><BailianProviderSettings session={account} /></TabsContent>
          <TabsContent value="membership" className="min-w-0 pt-5 leading-6"><MembershipPanel memberId={account.member.id} /></TabsContent>
          </div>
        </Tabs>}
      </DialogContent>
    </Dialog>
  );
}
