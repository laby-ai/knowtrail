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

const WIDTHS_STORAGE_KEY = 'knowtrail:workbench-panel-widths';

function readStoredWidths(): { left?: number; right?: number } {
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
  defaultLeftWidth = 280,
  defaultRightWidth = 440,
  initialMobilePanel = 'center',
}: ThreeColumnLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(() => {
    const stored = readStoredWidths().left;
    return stored && stored >= 220 && stored <= 450 ? stored : defaultLeftWidth;
  });
  const [rightWidth, setRightWidth] = useState(() => {
    const stored = readStoredWidths().right;
    return stored && stored >= 360 && stored <= 680 ? stored : defaultRightWidth;
  });
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'left' | 'center' | 'right'>(initialMobilePanel);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(side);
    startXRef.current = e.clientX;
    startWidthRef.current = side === 'left' ? leftWidth : rightWidth;
  }, [leftWidth, rightWidth]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const delta = e.clientX - startXRef.current;
    if (dragging === 'left') {
      const newWidth = Math.max(220, Math.min(450, startWidthRef.current + delta));
      setLeftWidth(newWidth);
    } else {
      const newWidth = Math.max(360, Math.min(680, startWidthRef.current - delta));
      setRightWidth(newWidth);
    }
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    try {
      window.localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify({ left: leftWidth, right: rightWidth }));
    } catch { /* quota — persistence is best-effort */ }
  }, [leftWidth, rightWidth]);

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

      {/* Left Panel — liquid glass */}
      <div
        className={`${mobilePanel === 'left' ? 'flex' : 'hidden'} ${leftCollapsed ? 'md:hidden' : 'md:flex'} min-h-0 w-full flex-1 flex-shrink-0 overflow-hidden liquid-glass-panel md:h-full md:flex-none`}
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

      {/* Center Panel — liquid glass */}
      <div
        className={`${mobilePanel === 'center' ? 'flex' : 'hidden'} relative min-h-0 w-full flex-1 overflow-hidden liquid-glass-panel md:flex md:h-full`}
        style={{ borderRight: 'none', borderLeft: 'none' }}
        aria-hidden={isMobile && mobilePanel !== 'center'}
      >
        {centerPanel}

        {/* Collapse / expand toggles */}
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

      {/* Right Panel — liquid glass */}
      <div
        className={`${mobilePanel === 'right' ? 'flex' : 'hidden'} ${rightCollapsed ? 'md:hidden' : 'md:flex'} min-h-0 w-full flex-1 flex-shrink-0 overflow-hidden liquid-glass-panel md:h-full md:flex-none`}
        style={{ width: isMobile ? undefined : rightWidth, borderRight: 'none', borderLeft: '1px solid var(--glass-border)' }}
        aria-hidden={isMobile && mobilePanel !== 'right'}
      >
        {rightPanel}
      </div>
    </div>
  );
}
