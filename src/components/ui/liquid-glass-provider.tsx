'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * LiquidGlassProvider
 * Provides ambient background blobs and mouse-tracking hover-light
 * for the entire app. Wrap your app content with this component.
 */
export function LiquidGlassProvider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Mouse tracking for hover-light — throttled with requestAnimationFrame
  const handleMouseMove = useCallback((e: MouseEvent) => {
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    if (rafRef.current !== null) return;

    rafRef.current = requestAnimationFrame(() => {
      const root = containerRef.current;
      if (!root) {
        rafRef.current = null;
        return;
      }

      const { x, y } = lastMouseRef.current;

      // Only update elements under cursor (use elementFromPoint for efficiency)
      const target = document.elementFromPoint(x, y);
      if (!target) {
        rafRef.current = null;
        return;
      }

      // Find closest glass element
      const glassElement = target.closest(
        '.liquid-glass-card, .liquid-glass-panel, .liquid-glass-static, .liquid-glass-btn, .liquid-glass-chip, .liquid-glass-input, [data-liquid-glass]'
      );

      if (glassElement) {
        const rect = glassElement.getBoundingClientRect();
        const relX = x - rect.left;
        const relY = y - rect.top;
        (glassElement as HTMLElement).style.setProperty('--mouse-x', `${relX}px`);
        (glassElement as HTMLElement).style.setProperty('--mouse-y', `${relY}px`);
      }

      rafRef.current = null;
    });
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      root.removeEventListener('mousemove', handleMouseMove);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [handleMouseMove]);

  return (
    <div ref={containerRef} className="relative w-full min-h-full bg-[var(--bg-primary)]">
      {/* Gradient stops retain soft edges without GPU blur or circular surfaces. */}
      <div className="glass-ambient-gradient" aria-hidden="true" />

      {/* Content */}
      <div className="relative z-10 w-full min-h-full">
        {children}
      </div>
    </div>
  );
}
