'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, KeyRound, LoaderCircle, Trash2, X } from 'lucide-react';
import type { AccountAuthSession } from '@/lib/account-auth-client';

type PublicProfile = {
  configured: boolean;
  provider_id: string;
  workspace_id?: string;
  region: string;
  text_model: string;
  image_model: string;
  tts_model: string;
  secret_mask?: string;
};

const EMPTY_PROFILE: PublicProfile = {
  configured: false,
  provider_id: 'aliyun-bailian',
  region: 'cn-beijing',
  text_model: 'qwen3.7-plus',
  image_model: 'wan2.7-image-pro',
  tts_model: 'qwen-audio-3.0-tts-plus',
};

export function BailianProviderButton({ session, compact = false }: { session: AccountAuthSession; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PublicProfile>(EMPTY_PROFILE);
  const [apiKey, setApiKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/account/provider-profile', {
        headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('暂时无法读取百炼配置。');
      const payload = await response.json() as { profile?: PublicProfile };
      const next = payload.profile || EMPTY_PROFILE;
      setProfile(next);
      setWorkspaceId(next.workspace_id || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '暂时无法读取百炼配置。');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function save() {
    if (!apiKey.trim() || !workspaceId.trim()) {
      setMessage('请填写 API Key 和业务空间 ID。');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/account/provider-profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim(), workspace_id: workspaceId.trim(), region: 'cn-beijing' }),
      });
      const payload = await response.json() as { profile?: PublicProfile; error?: string };
      if (!response.ok || !payload.profile) throw new Error(payload.error || '保存失败，请检查 Key 和业务空间 ID。');
      setProfile(payload.profile);
      setApiKey('');
      setMessage('百炼配置已加密保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/account/provider-profile', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) throw new Error('移除失败，请稍后重试。');
      setProfile(EMPTY_PROFILE);
      setWorkspaceId('');
      setApiKey('');
      setMessage('百炼配置已移除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '移除失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact
          ? 'pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-blue)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
          : 'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'}
        aria-label="配置百炼模型"
        title={profile.configured ? `百炼已配置 ${profile.secret_mask || ''}` : '配置百炼 API Key'}
        data-testid="bailian-provider-button"
      >
        {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : profile.configured ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <KeyRound className="h-3.5 w-3.5 text-amber-600" />}
        <span className={compact ? 'hidden xl:inline' : 'hidden sm:inline'}>{profile.configured ? '百炼已配置' : '配置百炼'}</span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          role="presentation"
          onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}
          onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}
        >
          <section className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white text-slate-950 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="bailian-dialog-title" data-testid="bailian-provider-dialog">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="bailian-dialog-title" className="text-base font-semibold">百炼模型配置</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">Key 由账号服务加密保存，灵笔只在生成时按当前登录成员读取。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950" aria-label="关闭百炼配置"><X className="h-4 w-4" /></button>
            </header>

            <div className="space-y-4 px-5 py-4">
              <label className="block text-sm font-medium text-slate-800">
                API Key
                <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" placeholder={profile.configured ? `重新填写以替换 ${profile.secret_mask || '现有 Key'}` : 'sk-...'} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" data-testid="bailian-api-key" />
              </label>
              <label className="block text-sm font-medium text-slate-800">
                业务空间 ID
                <input value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} placeholder="在百炼控制台的业务空间详情中查看" className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" data-testid="bailian-workspace-id" />
              </label>

              <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-xs sm:grid-cols-3">
                <div><span className="text-slate-500">文本</span><strong className="mt-1 block break-all text-slate-800">{profile.text_model}</strong></div>
                <div><span className="text-slate-500">科研绘图</span><strong className="mt-1 block break-all text-slate-800">{profile.image_model}</strong></div>
                <div><span className="text-slate-500">语音</span><strong className="mt-1 block break-all text-slate-800">{profile.tts_model}</strong></div>
              </div>

              {message && <p className="flex items-start gap-2 text-xs leading-5 text-slate-600" role="status"><AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />{message}</p>}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              {profile.configured ? <button type="button" onClick={() => void revoke()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />移除配置</button> : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-md px-3 text-xs font-medium text-slate-600 hover:bg-slate-200">取消</button>
                <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}加密保存</button>
              </div>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
