'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';

interface ThreeColumnLayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  initialMobilePanel?: 'left' | 'center' | 'right';
}

const WIDTHS_STORAGE_KEY = 'knowtrail:workbench-panel-widths-v3';
const MIN_PANEL = 200;
const DIVIDER_WIDTH = 5;

function readStoredWidths(): { leftPct?: number; rightPct?: number } {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(WIDTHS_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function ThreeColumnLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  defaultLeftWidth,
  defaultRightWidth,
  initialMobilePanel = 'center',
}: ThreeColumnLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [leftPct, setLeftPct] = useState(1 / 3);
  const [rightPct, setRightPct] = useState(1 / 3);
  const leftPctRef = useRef(1 / 3);
  const rightPctRef = useRef(1 / 3);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'left' | 'center' | 'right'>(initialMobilePanel);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const startXRef = useRef(0);
  const startLeftPctRef = useRef(1 / 3);
  const startRightPctRef = useRef(1 / 3);

  // Derive pixel widths from percentages and current container width
  const available = Math.max(0, containerWidth - DIVIDER_WIDTH * 2);
  const leftWidth = initialized && containerWidth > 0 ? Math.floor(available * leftPct) : 0;
  const rightWidth = initialized && containerWidth > 0 ? Math.floor(available * rightPct) : 0;
  const centerWidth = Math.max(0, available - leftWidth - rightWidth);

  // ResizeObserver: recalculate pixel widths from stored percentages on every resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initialize from localStorage on first valid container width
  useEffect(() => {
    if (containerWidth <= 0 || initialized) return;
    const stored = readStoredWidths();
    const third = 1 / 3;
    const lp = stored.leftPct && stored.leftPct > 0 ? stored.leftPct : third;
    const rp = stored.rightPct && stored.rightPct > 0 ? stored.rightPct : third;
    setLeftPct(lp);
    setRightPct(rp);
    leftPctRef.current = lp;
    rightPctRef.current = rp;
    setInitialized(true);
  }, [containerWidth, initialized]);

  const handleMouseDown = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(side);
    startXRef.current = e.clientX;
    startLeftPctRef.current = leftPctRef.current;
    startRightPctRef.current = rightPctRef.current;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || containerWidth <= 0) return;
    const delta = e.clientX - startXRef.current;
    const avail = containerWidth - DIVIDER_WIDTH * 2;
    if (avail <= 0) return;

    if (dragging === 'left') {
      const newPct = Math.max(MIN_PANEL / avail, Math.min(1 - MIN_PANEL / avail, startLeftPctRef.current + delta / avail));
      setLeftPct(newPct);
      leftPctRef.current = newPct;
    } else {
      const newPct = Math.max(MIN_PANEL / avail, Math.min(1 - MIN_PANEL / avail, startRightPctRef.current - delta / avail));
      setRightPct(newPct);
      rightPctRef.current = newPct;
    }
  }, [dragging, containerWidth]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    try {
      window.localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify({
        leftPct: leftPctRef.current,
        rightPct: rightPctRef.current,
      }));
    } catch { /* quota — persistence is best-effort */ }
  }, []);

  useEffect(() => {
    if (dragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    const updateLayoutMode = () => setIsMobile(window.innerWidth < 768);
    updateLayoutMode();
    window.addEventListener('resize', updateLayoutMode);
    return () => window.removeEventListener('resize', updateLayoutMode);
  }, []);

  useEffect(() => {
    setMobilePanel(initialMobilePanel);
  }, [initialMobilePanel]);

  const tabs: Array<{ id: 'left' | 'center' | 'right'; label: string }> = [
    { id: 'left', label: '资料' },
    { id: 'center', label: '对话' },
    { id: 'right', label: '产物' },
  ];

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full min-w-0 flex-col overflow-hidden md:flex-row"
      style={{ cursor: dragging ? 'col-resize' : undefined }}
    >
      <div className="flex-shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/92 px-3 py-2 backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-1 shadow-[var(--glass-shadow-sm)]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMobilePanel(tab.id)}
              data-testid={`workbench-mobile-tab-${tab.id}`}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                mobilePanel === tab.id
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] shadow-[0_8px_24px_rgba(15,23,42,0.14)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Left Panel */}
      <div
        className={`${mobilePanel === 'left' ? 'flex' : 'hidden'} ${leftCollapsed ? 'md:hidden' : 'md:flex'} min-h-0 flex-shrink-0 overflow-hidden liquid-glass-panel md:h-full`}
        style={{ width: isMobile ? undefined : leftWidth }}
        aria-hidden={isMobile && mobilePanel !== 'left'}
      >
        {leftPanel}
      </div>

      {/* Left Divider */}
      {!leftCollapsed && (
        <div
          className="panel-divider hidden flex-shrink-0 md:block"
          onMouseDown={(e) => handleMouseDown('left', e)}
          onDoubleClick={() => setLeftCollapsed(true)}
          title="拖拽调宽 · 双击收起"
        />
      )}

      {/* Center Panel */}
      <div
        className={`${mobilePanel === 'center' ? 'flex' : 'hidden'} relative min-h-0 flex-shrink-0 overflow-hidden liquid-glass-panel md:flex md:h-full`}
        style={{ width: isMobile ? undefined : centerWidth, borderRight: 'none', borderLeft: 'none' }}
        aria-hidden={isMobile && mobilePanel !== 'center'}
      >
        {centerPanel}

        <button
          type="button"
          onClick={() => setLeftCollapsed(v => !v)}
          data-testid="workbench-toggle-left"
          className="absolute left-2 top-1/2 z-20 hidden h-9 w-6 -translate-y-1/2 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]/85 text-[var(--text-tertiary)] opacity-40 backdrop-blur transition-all hover:opacity-100 hover:text-[var(--text-primary)] md:flex"
          title={leftCollapsed ? '展开资料库' : '收起资料库'}
          aria-label={leftCollapsed ? '展开资料库' : '收起资料库'}
        >
          {leftCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setRightCollapsed(v => !v)}
          data-testid="workbench-toggle-right"
          className="absolute right-2 top-1/2 z-20 hidden h-9 w-6 -translate-y-1/2 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]/85 text-[var(--text-tertiary)] opacity-40 backdrop-blur transition-all hover:opacity-100 hover:text-[var(--text-primary)] md:flex"
          title={rightCollapsed ? '展开产物中心' : '收起产物中心'}
          aria-label={rightCollapsed ? '展开产物中心' : '收起产物中心'}
        >
          {rightCollapsed ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Right Divider */}
      {!rightCollapsed && (
        <div
          className="panel-divider hidden flex-shrink-0 md:block"
          onMouseDown={(e) => handleMouseDown('right', e)}
          onDoubleClick={() => setRightCollapsed(true)}
          title="拖拽调宽 · 双击收起"
        />
      )}

      {/* Right Panel */}
      <div
        className={`${mobilePanel === 'right' ? 'flex' : 'hidden'} ${rightCollapsed ? 'md:hidden' : 'md:flex'} min-h-0 flex-shrink-0 overflow-hidden liquid-glass-panel md:h-full`}
        style={{ width: isMobile ? undefined : rightWidth, borderRight: 'none', borderLeft: '1px solid var(--glass-border)' }}
        aria-hidden={isMobile && mobilePanel !== 'right'}
      >
        {rightPanel}
      </div>
    </div>
  );
}
