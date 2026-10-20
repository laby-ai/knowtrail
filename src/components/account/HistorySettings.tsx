'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { useAppPreferences } from './AppPreferencesProvider';
import { checkedApiFetch } from '@/lib/api-response';
import type { AccountAuthSession } from '@/lib/account-auth-client';

export function HistorySettings({ session }: { session: AccountAuthSession }) {
  const { preferences, ready, save } = useAppPreferences();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const en = preferences.interfaceLanguage === 'en';
  async function toggle(value: boolean) {
    setBusy(true); setMessage('');
    try { await save({ ...preferences, saveHistory: value }); setMessage(value ? (en ? 'Automatic saving enabled. The current conversation will also be saved.' : '已开启保存，当前对话也将同步保存。') : (en ? 'New conversations will not be saved. Existing history is retained.' : '已停止新增对话的自动保存，已有历史仍保留。')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true); setMessage('');
    try {
      const response = await checkedApiFetch('/api/account/archive', { headers: { Authorization: `Bearer ${session.token}` } });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '下载失败'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'lingbi-research-history.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage(en ? 'Download started. If prompted, allow downloads in your browser.' : '已发起下载；如浏览器提示，请允许保存文件。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '下载失败'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    <label className="flex items-start justify-between gap-5 rounded-xl border border-[var(--border-subtle)] p-4 text-sm"><span>{en ? 'Automatically save conversations' : '自动保存对话历史'}<span className="mt-2 block text-xs leading-relaxed text-[var(--text-secondary)]">{en ? 'Controls browser and cloud conversation saving. Existing history and manually saved research artifacts are retained. Turning this back on also saves the current conversation.' : '同时控制浏览器与云端对话保存。关闭不删除已有历史，也不影响手动保存的研究成果。重新开启会保存当前对话。'}</span></span><input aria-label="自动保存对话历史" type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={preferences.saveHistory} disabled={!ready || busy} onChange={event => void toggle(event.target.checked)} /></label>
    <section className="space-y-3"><h3 className="font-semibold">{en ? 'Download research history' : '下载研究历史'}</h3><p className="text-sm leading-relaxed text-[var(--text-secondary)]">{en ? 'Download cloud-saved conversations, research artifacts, notebook titles and general preferences as JSON. Original files, unsynced conversations, shared notebooks owned by others, passwords and model keys are excluded. Download original files from their notebook.' : '以 JSON 下载账号云端已保存的对话、研究成果、文献本标题与通用设置。不包含原始附件、未同步对话、他人文献本、密码和模型密钥；原始资料请在对应文献本下载。'}</p><button type="button" className="liquid-glass-btn inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm" disabled={busy} onClick={() => void download()}><Download className="h-4 w-4" />{busy ? (en ? 'Processing…' : '处理中…') : (en ? 'Download JSON' : '下载历史记录')}</button></section>
    <p role="status" className="text-sm text-[var(--text-secondary)]">{message}</p>
  </div>;
}
