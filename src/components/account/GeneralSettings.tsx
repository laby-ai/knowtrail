'use client';
import { useState } from 'react';
import { useAppPreferences } from './AppPreferencesProvider';
import type { AppPreferences } from '@/lib/app-preferences';

export function GeneralSettings() {
  const { preferences, ready, error, save } = useAppPreferences();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const en = preferences.interfaceLanguage === 'en';
  async function change(patch: Partial<AppPreferences>) {
    setBusy(true); setMessage('');
    try { await save({ ...preferences, ...patch }); setMessage(en ? 'Saved' : '已保存'); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : '保存失败'); }
    finally { setBusy(false); }
  }
  const selectClass = 'liquid-glass-input mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-3';
  return <div className="space-y-6">
    <label className="block text-sm font-medium">{en ? 'Interface language' : '界面语言'}
      <select aria-label="界面语言" disabled={!ready || busy} value={preferences.interfaceLanguage} onChange={event => void change({ interfaceLanguage: event.target.value as AppPreferences['interfaceLanguage'] })} className={selectClass}><option value="zh-CN">简体中文</option><option value="en">English（逐步完善 / Preview）</option></select>
      <span className="mt-2 block text-xs font-normal text-[var(--text-secondary)]">{en ? 'English is available for settings and primary navigation. Untranslated screens retain their original text.' : '英文目前覆盖设置与主要导航，未翻译页面保留原文。'}</span>
    </label>
    <label className="block text-sm font-medium">{en ? 'AI output language' : 'AI 输出语言'}
      <select aria-label="AI 输出语言" disabled={!ready || busy} value={preferences.outputLanguage} onChange={event => void change({ outputLanguage: event.target.value as AppPreferences['outputLanguage'] })} className={selectClass}><option value="auto">{en ? 'Follow task instructions' : '跟随任务要求'}</option><option value="zh-CN">简体中文</option><option value="en">English</option></select>
      <span className="mt-2 block text-xs font-normal text-[var(--text-secondary)]">{en ? 'Applies to new AI tasks. An explicit language selected within a task takes priority; quotations and citations are preserved.' : '用于新的 AI 任务；任务中明确指定的语言优先，原文引文、引用和代码保持不变。'}</span>
    </label>
    <label className="block text-sm font-medium">{en ? 'Font size' : '字体大小'}
      <select aria-label="字体大小" disabled={!ready || busy} value={preferences.fontSize} onChange={event => void change({ fontSize: event.target.value as AppPreferences['fontSize'] })} className={selectClass}><option value="standard">{en ? 'Standard' : '标准'}</option><option value="large">{en ? 'Large' : '较大'}</option><option value="larger">{en ? 'Larger' : '更大'}</option></select>
      <span className="mt-3 block rounded-xl border border-[var(--border-subtle)] p-4 font-normal">{en ? 'Read papers, trace evidence, and record research findings.' : '阅读文献、核对证据、记录研究发现。'}</span>
    </label>
    <label className="flex items-start justify-between gap-5 rounded-xl border border-[var(--border-subtle)] p-4 text-sm"><span>{en ? 'Reduce motion' : '减少动态效果'}<span className="mt-1 block text-xs text-[var(--text-secondary)]">{en ? 'Pause decorative animations and transitions.' : '停用背景流星等装饰动画，减少界面过渡。'}</span></span><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" disabled={!ready || busy} checked={preferences.reduceMotion} onChange={event => void change({ reduceMotion: event.target.checked })} /></label>
    <p role="status" className="text-sm text-[var(--text-secondary)]">{error || message}</p>
  </div>;
}
