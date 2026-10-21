'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';

export function OperationFeedbackHost() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const sync = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    const clear = () => toast.dismiss();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); sync();
    window.addEventListener('knowtrail-account-session-changed', clear);
    window.addEventListener('storage', clear);
    return () => { observer.disconnect(); window.removeEventListener('knowtrail-account-session-changed', clear); window.removeEventListener('storage', clear); };
  }, []);
  return <Toaster theme={theme} position="top-right" offset="72px" mobileOffset="80px" closeButton duration={4500} visibleToasts={2} toastOptions={{ style: { background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--glass-border)', fontSize: '14px', lineHeight: '1.6' } }} />;
}
