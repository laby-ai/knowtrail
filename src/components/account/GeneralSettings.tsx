'use client';
import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const selectClass = 'liquid-glass-input mt-2 h-auto min-h-11 w-full rounded-xl px-3 py-3';
  return <div className="space-y-6">
    <label className="block text-sm font-medium">{en ? 'Interface language' : '界面语言'}
      <Select disabled={!ready || busy} value={preferences.interfaceLanguage} onValueChange={value => void change({ interfaceLanguage: value as AppPreferences['interfaceLanguage'] })}><SelectTrigger aria-label="界面语言" className={selectClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="en">English (Preview)</SelectItem></SelectContent></Select>
      <span className="mt-2 block text-xs font-normal text-[var(--text-secondary)]">{en ? 'English is available for settings and primary navigation. Untranslated screens retain their original text.' : '英文目前覆盖设置与主要导航，未翻译页面保留原文。'}</span>
    </label>
    <label className="block text-sm font-medium">{en ? 'AI output language' : 'AI 输出语言'}
      <Select disabled={!ready || busy} value={preferences.outputLanguage} onValueChange={value => void change({ outputLanguage: value as AppPreferences['outputLanguage'] })}><SelectTrigger aria-label="AI 输出语言" className={selectClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">{en ? 'Follow task instructions' : '跟随任务要求'}</SelectItem><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select>
      <span className="mt-2 block text-xs font-normal text-[var(--text-secondary)]">{en ? 'Applies to new AI tasks. An explicit language selected within a task takes priority; quotations and citations are preserved.' : '用于新的 AI 任务；任务中明确指定的语言优先，原文引文、引用和代码保持不变。'}</span>
    </label>
    <label className="block text-sm font-medium">{en ? 'Font size' : '字体大小'}
      <Select disabled={!ready || busy} value={preferences.fontSize} onValueChange={value => void change({ fontSize: value as AppPreferences['fontSize'] })}><SelectTrigger aria-label="字体大小" className={selectClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="standard">{en ? 'Standard' : '标准'}</SelectItem><SelectItem value="large">{en ? 'Large' : '较大'}</SelectItem><SelectItem value="larger">{en ? 'Larger' : '更大'}</SelectItem></SelectContent></Select>
      <span className="mt-3 block rounded-xl border border-[var(--border-subtle)] p-4 font-normal">{en ? 'Read papers, trace evidence, and record research findings.' : '阅读文献、核对证据、记录研究发现。'}</span>
    </label>
    <label className="flex items-start justify-between gap-5 rounded-xl border border-[var(--border-subtle)] p-4 text-sm"><span>{en ? 'Reduce motion' : '减少动态效果'}<span className="mt-1 block text-xs text-[var(--text-secondary)]">{en ? 'Pause decorative animations and transitions.' : '停用背景流星等装饰动画，减少界面过渡。'}</span></span><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" disabled={!ready || busy} checked={preferences.reduceMotion} onChange={event => void change({ reduceMotion: event.target.checked })} /></label>
    <p role="status" className="text-sm text-[var(--text-secondary)]">{error || message}</p>
  </div>;
}
