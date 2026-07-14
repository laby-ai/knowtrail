'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * LiquidGlassProvider
 * Provides mouse-tracking hover-light for the app glass surfaces.
 */
export function LiquidGlassProvider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Mouse tracking for hover-light on all .liquid-glass-card / .liquid-glass-panel elements
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const root = containerRef.current;
    if (!root) return;

    // Find all glass elements under cursor
    const elements = root.querySelectorAll(
      '.liquid-glass-card, .liquid-glass-panel, .liquid-glass-static, .liquid-glass-btn, .liquid-glass-chip, .liquid-glass-input, [data-liquid-glass]'
    );
    elements.forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      (el as HTMLElement).style.setProperty('--mouse-x', `${x}px`);
      (el as HTMLElement).style.setProperty('--mouse-y', `${y}px`);
    });
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.addEventListener('mousemove', handleMouseMove);
    return () => root.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  return (
    <div ref={containerRef} className="relative w-full min-h-full bg-[var(--bg-primary)]">
      <div className="relative z-10 w-full min-h-full">
        {children}
      </div>
    </div>
  );
}
