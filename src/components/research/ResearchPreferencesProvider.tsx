'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { Microscope } from 'lucide-react';
import { clientApiFetch } from '@/lib/client-api';
import { DEFAULT_RESEARCH_PREFERENCES, parseResearchPreferences, RESEARCH_DISCIPLINES, type ResearchPreferences } from '@/lib/research-preferences';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useApp } from '@/contexts/AppContext';
import { formatBibliography } from '@/lib/literature/citations';

const Context = createContext<{ preferences: ResearchPreferences; loaded: boolean; openSettings: () => void }>({ preferences: DEFAULT_RESEARCH_PREFERENCES, loaded: false, openSettings: () => undefined });
export const useResearchPreferences = () => useContext(Context);
type Payload = { configured: boolean; preferences: ResearchPreferences };

export function ResearchPreferencesProvider({ ownerId, children }: { ownerId?: string; children: ReactNode }) {
  const { getSelectedPapers } = useApp();
  const [preferences, setPreferences] = useState(DEFAULT_RESEARCH_PREFERENCES);
  const [draft, setDraft] = useState(DEFAULT_RESEARCH_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false); setPreferences(DEFAULT_RESEARCH_PREFERENCES); setOpen(false);
    if (!ownerId) { setLoaded(true); return; }
    void clientApiFetch<Payload>('/api/account/research-preferences', { signal: controller.signal }).then(payload => {
      const next = parseResearchPreferences(payload.preferences);
      if (controller.signal.aborted) return;
      setPreferences(next); setDraft(next); setLoaded(true); setError(null);
      if (!payload.configured) setOpen(true);
    }).catch(failure => {
      if (!controller.signal.aborted) { setLoaded(true); setError(failure instanceof Error ? failure.message : '科研偏好读取失败。'); }
    });
    return () => controller.abort();
  }, [ownerId]);
  const openSettings = useCallback(() => { setDraft(preferences); setOpen(true); }, [preferences]);
  async function save() {
    setBusy(true); setError(null);
    try {
      const payload = await clientApiFetch<Payload>('/api/account/research-preferences', { method: 'PUT', body: JSON.stringify(draft) });
      setPreferences(parseResearchPreferences(payload.preferences)); setOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '科研偏好保存失败。'); }
    finally { setBusy(false); }
  }
  const discipline = RESEARCH_DISCIPLINES.find(item => item.id === preferences.disciplines[0]);
  const [shortcutMessage, setShortcutMessage] = useState('');
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!preferences.researchMode || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
      if (!['KeyL', 'KeyC', 'KeyT'].includes(event.code)) return;
      event.preventDefault();
      if (event.code === 'KeyL') window.dispatchEvent(new Event('lingbi:open-literature-search'));
      if (event.code === 'KeyT') window.dispatchEvent(new Event('lingbi:open-data-analysis'));
      if (event.code === 'KeyC') {
        const papers = getSelectedPapers();
        if (!papers.length) { setShortcutMessage('请先在文献库中选择来源，再插入引用。'); return; }
        const citation = formatBibliography(papers.map(paper => ({ title: paper.title, authors: paper.authors.map(name => ({ name })), year: paper.year, venue: paper.literature?.venue, doi: paper.literature?.doi })), discipline?.citationStyle || 'GB/T 7714');
        window.dispatchEvent(new CustomEvent('lingbi:insert-citation', { detail: citation }));
        setShortcutMessage('已将所选文献的参考文献条目插入对话输入框。');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preferences.researchMode, discipline, getSelectedPapers]);
  useEffect(() => {
    if (!shortcutMessage) return;
    const timeout = setTimeout(() => setShortcutMessage(''), 5000);
    return () => clearTimeout(timeout);
  }, [shortcutMessage]);
  return <Context.Provider value={{ preferences, loaded, openSettings }}>
    <div className="flex h-full min-h-0 w-full flex-col" data-research-discipline={discipline?.id} data-research-mode={preferences.researchMode ? 'on' : 'off'} style={discipline ? { '--accent-blue': discipline.color, '--research-accent': discipline.color } as CSSProperties : undefined}>
      {children}
      {shortcutMessage && <p role="status" className="fixed bottom-4 left-1/2 z-[100] max-w-[90vw] -translate-x-1/2 rounded-lg border bg-[var(--bg-primary)] px-4 py-3 text-sm shadow-lg">{shortcutMessage}</p>}
    </div>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="sm:max-w-lg" data-testid="research-preferences-dialog">
        <DialogHeader><DialogTitle>选择研究领域</DialogTitle><DialogDescription>可多选。第一项领域决定配色与默认检索源、引用格式，之后可随时修改。</DialogDescription></DialogHeader>
        <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-sm font-medium">研究领域</legend>
          <div className="grid grid-cols-2 gap-3">{RESEARCH_DISCIPLINES.map(item => <label key={item.id} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
            <input type="checkbox" checked={draft.disciplines.includes(item.id)} onChange={event => setDraft(current => ({ ...current, disciplines: event.target.checked ? [...current.disciplines, item.id] : current.disciplines.filter(id => id !== item.id) }))} />
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />{item.label}
          </label>)}</div>
          <label className="flex items-center gap-2 pt-2 text-sm"><input type="checkbox" checked={draft.researchMode} onChange={event => setDraft(current => ({ ...current, researchMode: event.target.checked }))} />科研模式</label>
          <p className="text-xs text-[var(--text-secondary)]">科研模式强调基于来源的推理和引用；检索源与引用格式仍可手动调整。</p>
          <p className="text-xs text-[var(--text-secondary)]">Ctrl / ⌘ + Shift + L 检索文献；C 插入所选文献条目；T 打开数据分析。</p>
        </fieldset>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <button className="liquid-glass-btn px-4 py-3" disabled={!ownerId || busy || !draft.disciplines.length} onClick={() => void save()}>{busy ? '正在保存…' : '保存研究偏好'}</button>
      </DialogContent>
    </Dialog>
  </Context.Provider>;
}

export function ResearchModeButton() {
  const { preferences, loaded, openSettings } = useResearchPreferences();
  return <button type="button" aria-label="研究领域与科研模式" disabled={!loaded} onClick={openSettings} data-testid="research-mode-settings" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-border)] px-2.5 py-2 text-xs" title="研究领域与科研模式"><Microscope className="h-4 w-4" /><span className="hidden sm:inline">{preferences.researchMode ? '科研模式' : '研究偏好'}</span></button>;
}
