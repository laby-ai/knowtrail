'use client';
import { MODEL_PROVIDER_PRESETS, modelProviderPreset, type ModelProviderId } from '@/lib/model-provider-presets';
import { checkedApiFetch } from '@/lib/api-response';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, LoaderCircle, Trash2 } from 'lucide-react';
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
  text_model: MODEL_PROVIDER_PRESETS[0].model,
  image_model: MODEL_PROVIDER_PRESETS[0].image,
  tts_model: 'qwen-audio-3.0-tts-plus',
};

export function BailianProviderSettings({ session }: { session: AccountAuthSession }) {
  const [profile, setProfile] = useState<PublicProfile>(EMPTY_PROFILE);
  const [providerId, setProviderId] = useState<ModelProviderId>('aliyun-bailian');
  const preset = modelProviderPreset(providerId);
  const preview = profile.configured && profile.provider_id === providerId ? { model: profile.text_model, image: profile.image_model, tts: profile.tts_model } : preset;
  const [apiKey, setApiKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await checkedApiFetch('/api/account/provider-profile', {
        headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('暂时无法读取模型配置。');
      const payload = await response.json() as { profile?: PublicProfile };
      const next = payload.profile || EMPTY_PROFILE;
      setProfile(next);
      setProviderId(modelProviderPreset(next.provider_id).id);
      setWorkspaceId(next.workspace_id || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '暂时无法读取模型配置。');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function save() {
    if (!apiKey.trim()) {
      setMessage('请粘贴所选服务的 API Key。');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const response = await checkedApiFetch('/api/account/provider-profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: providerId, api_key: apiKey.trim(), workspace_id: providerId === 'aliyun-bailian' ? workspaceId.trim() : '', region: 'cn-beijing' }),
      });
      const payload = await response.json() as { profile?: PublicProfile; error?: string };
      if (!response.ok || !payload.profile) throw new Error(payload.error || '保存失败，请检查所选服务和 API Key。');
      setProfile(payload.profile);
      setApiKey('');
      try {
        const activated = await checkedApiFetch('/api/account/commerce/preferences', { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ modelSource: 'byok' }) });
        if (!activated.ok) throw new Error('activation_failed');
        try {
          const key = `lingbi-commerce-selection:${session.member.id}`;
          const previous: unknown = JSON.parse(localStorage.getItem(key) || '{}');
          const accountId = previous && typeof previous === 'object' && 'accountId' in previous && typeof previous.accountId === 'string' ? previous.accountId : undefined;
          localStorage.setItem(key, JSON.stringify({ accountId, source: 'byok' }));
        } catch { /* The account service remains authoritative. */ }
        setMessage('模型配置已加密保存，并启用自带密钥。实际可用性以服务调用结果为准。');
      } catch { setMessage('模型配置已保存，但暂未启用。请在“会员与用量”中将模型来源切换为自带密钥后重试。'); }
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
      const response = await checkedApiFetch('/api/account/provider-profile', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) throw new Error('移除失败，请稍后重试。');
      setProfile(EMPTY_PROFILE);
      setProviderId('aliyun-bailian');
      setWorkspaceId('');
      setApiKey('');
      setMessage('模型配置已移除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '移除失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-950" data-testid="bailian-provider-settings">
      <header className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-sm font-semibold">模型配置</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">API Key 加密保存，仅供当前账号生成内容时使用。</p>
        <p className="mt-2 text-xs text-slate-600">{loading ? '正在读取配置…' : profile.configured ? `当前保存：${modelProviderPreset(profile.provider_id).label} ${profile.secret_mask || ''}` : '尚未配置'}</p>
      </header>
      <div className="space-y-4 px-5 py-4">
        <label className="block text-sm font-medium text-slate-800">模型服务
          <select aria-label="模型服务" data-testid="model-provider-select" disabled={loading || saving} value={providerId} onChange={event => { setProviderId(modelProviderPreset(event.target.value).id); setApiKey(''); setMessage('请粘贴新选择服务的 API Key，保存后生效。'); }} className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm">{MODEL_PROVIDER_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        <p className="text-xs leading-5 text-slate-500">选择服务后粘贴对应 Key 即可，接口地址和默认模型自动匹配。同一账号当前使用一组自带密钥配置；保存会替换现有配置并启用自带密钥。供应商可能直接收取调用费用。请使用所选平台的标准 API Key，并确认已开通默认模型；编程套餐等专用密钥可能不通用。</p>
        <label className="block text-sm font-medium text-slate-800">
          API Key
          <input disabled={loading || saving} type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" placeholder={profile.configured ? `重新填写以替换 ${profile.secret_mask || '现有 Key'}` : 'sk-...'} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" data-testid="bailian-api-key" />
        </label>
        {providerId === 'aliyun-bailian' && <details className="text-sm text-slate-600"><summary className="cursor-pointer">高级选项（百炼绘图、语音需要）</summary><label className="mt-3 block">业务空间 ID<input disabled={loading || saving} value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} placeholder="使用百炼绘图或语音时填写" className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm" data-testid="bailian-workspace-id" /></label></details>}

        <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-xs sm:grid-cols-3">
          <div><span className="text-slate-500">文本</span><strong className="mt-1 block break-all text-slate-800">{preview.model}</strong></div>
          <div><span className="text-slate-500">科研绘图</span><strong className="mt-1 block break-all text-slate-800">{providerId === 'aliyun-bailian' && !workspaceId.trim() ? '需在高级选项填写业务空间 ID' : preview.image || '此服务配置不提供绘图'}</strong></div>
          <div><span className="text-slate-500">语音</span><strong className="mt-1 block break-all text-slate-800">{providerId === 'aliyun-bailian' && !workspaceId.trim() ? '需在高级选项填写业务空间 ID' : preview.tts || '此服务配置不提供语音'}</strong></div>
        </div>

        {message && <p className="flex items-start gap-2 text-xs leading-5 text-slate-600" role="status"><AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />{message}</p>}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
        {profile.configured ? <button type="button" onClick={() => void revoke()} disabled={saving || loading} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />移除配置</button> : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={() => void save()} disabled={saving || loading} className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}加密保存</button>
        </div>
      </footer>
    </section>
  );
}
