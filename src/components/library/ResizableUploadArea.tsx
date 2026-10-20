'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const DEFAULT_HEIGHT = 300;
export function ResizableUploadArea({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [bounds, setBounds] = useState({ min: 220, max: 480 });
  const [loaded, setLoaded] = useState(false);
  const key = `knowtrail:upload-height:${encodeURIComponent(storageKey)}`;
  useEffect(() => {
    try { const value = Number(localStorage.getItem(key)); if (Number.isFinite(value) && value >= 140 && value <= 480) setHeight(value); } catch { /* Resizing also works without browser storage. */ }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    const element = root.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const measure = () => {
      if (!parent.clientHeight || !element.getClientRects().length) return;
      const siblings = Array.from(parent.children).filter(child => child !== element && !child.hasAttribute('data-library-scroll') && !['absolute', 'fixed'].includes(getComputedStyle(child).position));
      const fixedHeight = siblings.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      const max = Math.max(140, Math.min(480, parent.clientHeight - fixedHeight - 160));
      const min = Math.min(220, max);
      setBounds(previous => previous.min === min && previous.max === max ? previous : { min, max });
      setHeight(previous => Math.max(min, Math.min(max, previous)));
    };
    const observer = new ResizeObserver(measure);
    const observe = () => { observer.disconnect(); observer.observe(parent); for (const child of Array.from(parent.children)) if (child !== element && !child.hasAttribute('data-library-scroll')) observer.observe(child); measure(); };
    const mutation = new MutationObserver(observe);
    mutation.observe(parent, { childList: true });
    observe();
    return () => { observer.disconnect(); mutation.disconnect(); };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => { try { localStorage.setItem(key, String(height)); } catch { /* Optional preference. */ } }, 200);
    return () => clearTimeout(timer);
  }, [height, key, loaded]);
  const resize = (value: number) => setHeight(Math.max(bounds.min, Math.min(bounds.max, value)));
  return <div ref={root} style={{ height }} className="flex shrink-0 flex-col border-t border-[var(--border-subtle)]" data-testid="library-upload-area">
    <div role="separator" aria-label="调整上传区域高度" aria-orientation="horizontal" aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={Math.round(height)} tabIndex={0}
      className="group flex h-6 shrink-0 cursor-row-resize touch-none select-none items-center justify-center gap-2 text-[10px] text-[var(--text-tertiary)] outline-none hover:bg-[var(--glass-subtle)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400" title="向上拖动扩大上传区，向下缩小；双击恢复默认大小"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { y: event.clientY, height }; }}
      onPointerMove={event => { if (drag.current) resize(drag.current.height + drag.current.y - event.clientY); }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={() => resize(DEFAULT_HEIGHT)}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); resize(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : height + (event.key === 'ArrowUp' ? 24 : -24)); } }}>
      <span className="h-1 w-8 rounded-full bg-[var(--border-subtle)] group-hover:bg-blue-400/60" aria-hidden="true" /><span>拖动调整上传区</span>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
  </div>;
}
