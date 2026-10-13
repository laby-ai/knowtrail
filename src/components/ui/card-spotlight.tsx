'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';

/** Adapted from React Bits SpotlightCard for existing Lingbi button surfaces.
 * Upstream: https://github.com/DavidHDev/react-bits
 * Copyright (c) 2026 David Haz. See notices/react-bits-LICENSE.md.
 * No global listeners, animation loop, or replacement of native button behavior.
 */
export function CardSpotlight({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
    ref.current.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
  };
  return (
    <div ref={ref} onPointerMove={onMove} className={`lingbi-card-spotlight ${className}`}>
      {children}
      <span className="lingbi-card-spotlight-light" aria-hidden="true" />
    </div>
  );
}
