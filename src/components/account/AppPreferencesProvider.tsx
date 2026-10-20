'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { checkedApiFetch } from '@/lib/api-response';
import { readStoredAccountSession } from '@/lib/account-session-browser';
import { appPreferencesSchema, DEFAULT_APP_PREFERENCES, type AppPreferences } from '@/lib/app-preferences';

type PreferencesContext = { preferences: AppPreferences; ready: boolean; error: string; save: (value: AppPreferences) => Promise<void> };
const Context = createContext<PreferencesContext>({ preferences: DEFAULT_APP_PREFERENCES, ready: false, error: '', save: async () => { throw new Error('设置尚未就绪。'); } });
export const useAppPreferences = () => useContext(Context);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_APP_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [identity, setIdentity] = useState(0);
  useEffect(() => {
    const changed = () => setIdentity(value => value + 1);
    const storage = (event: StorageEvent) => { if (event.key === 'knowtrail-account-session') changed(); };
    window.addEventListener('knowtrail-account-session-changed', changed);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('knowtrail-account-session-changed', changed); window.removeEventListener('storage', storage); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const session = readStoredAccountSession();
    setPreferences(DEFAULT_APP_PREFERENCES); setReady(false); setError('');
    if (!session) { setReady(true); return () => controller.abort(); }
    void checkedApiFetch('/api/account/app-preferences', { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('无法读取通用设置，请刷新后重试。'); return appPreferencesSchema.parse(await response.json()); })
      .then(value => { if (!controller.signal.aborted) { setPreferences(value); setReady(true); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '设置读取失败。'); });
    return () => controller.abort();
  }, [identity]);
  useEffect(() => {
    document.documentElement.lang = preferences.interfaceLanguage;
    document.documentElement.style.fontSize = ({ standard: '100%', large: '112.5%', larger: '125%' })[preferences.fontSize];
    document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion);
  }, [preferences]);
  const save = useCallback(async (value: AppPreferences) => {
    const session = readStoredAccountSession();
    if (!session) throw new Error('请先登录。');
    const response = await checkedApiFetch('/api/account/app-preferences', { method: 'PUT', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error('设置保存失败，请重试。');
    const next = appPreferencesSchema.parse(await response.json());
    if (readStoredAccountSession()?.token !== session.token) return;
    setPreferences(next);
  }, []);
  return <Context.Provider value={{ preferences, ready, error, save }}>{children}</Context.Provider>;
}
