'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type MotionRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
};

// React Bits AnimatedContent / FadeContent adaptation. Native browser animation
// keeps server-rendered text visible and adds no animation-library dependency.
// Upstream provenance and license: THIRD_PARTY_NOTICES/react-bits/.
export function MotionReveal({ children, className, delay = 0, y = 10 }: MotionRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !element.animate || !window.IntersectionObserver) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    let revealed = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || revealed) return;
      revealed = true; observer.disconnect();
      if (reduced.matches || document.hidden) return;
      animation = element.animate([
        { opacity: 0.4, transform: `translateY(${Math.min(Math.max(y, 0), 12)}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 440, delay: Math.min(Math.max(delay * 1000, 0), 180), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }, { threshold: 0.12 });
    const stop = () => { if (reduced.matches || document.hidden) animation?.cancel(); };
    reduced.addEventListener('change', stop);
    document.addEventListener('visibilitychange', stop);
    observer.observe(element);
    return () => { observer.disconnect(); animation?.cancel(); reduced.removeEventListener('change', stop); document.removeEventListener('visibilitychange', stop); };
  }, [delay, y]);
  return <div ref={ref} className={className} data-research-reveal="true">{children}</div>;
}
