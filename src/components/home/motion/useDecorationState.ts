'use client';

import { useEffect, useState, type RefObject } from 'react';

/** Only visible, foreground decorations may animate; follows both motion settings. */
export function useDecorationState(ref: RefObject<HTMLElement | null>) {
  const [state, setState] = useState({ active: false, reduced: true, light: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const sync = () => {
      const root = document.documentElement;
      const reduced = media.matches || root.dataset.reduceMotion === 'true';
      const next = { active: visible && !document.hidden && !reduced, reduced, light: root.dataset.theme === 'light' };
      setState(previous => previous.active === next.active && previous.reduced === next.reduced && previous.light === next.light ? previous : next);
    };
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync(); });
    const mutation = new MutationObserver(sync);
    intersection.observe(element);
    mutation.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-reduce-motion'] });
    media.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => { intersection.disconnect(); mutation.disconnect(); media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync); };
  }, [ref]);
  return state;
}
