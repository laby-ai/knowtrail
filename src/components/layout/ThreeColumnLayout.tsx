'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { LibraryBig, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { QuietWorkbenchLayout } from './QuietWorkbenchLayout';
import type { WorkbenchPreferences } from '@/components/home/workspace-types';

export interface ThreeColumnLayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  rightRail?: React.ReactNode;
  rightOpen?: boolean;
  onCloseRight?: () => void;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  initialMobilePanel?: 'left' | 'center' | 'right';
  appearance?: 'glass' | 'quiet-research';
  rightFocusKey?: string | null;
  storageScopeKey?: string;
  initialPreferences?: WorkbenchPreferences;
  onPreferencesChange?: (preferences: Partial<WorkbenchPreferences>) => void;
}

const WIDTHS_STORAGE_KEY = 'knowtrail:workbench-panel-widths';
const COLLAPSE_STORAGE_KEY = 'knowtrail:workbench-panel-collapsed';

function readStoredWidths(storageKey: string, fallbackKey?: string): { left?: number; right?: number } {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) || (fallbackKey && window.localStorage.getItem(fallbackKey)) || '{}');
  } catch {
    return {};
  }
}

function readStoredCollapse(storageKey: string, fallbackKey?: string): { left?: boolean; right?: boolean } {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) || (fallbackKey && window.localStorage.getItem(fallbackKey)) || '{}');
  } catch {
    return {};
  }
}

export function ThreeColumnLayout(props: ThreeColumnLayoutProps) {
  if (props.appearance === 'quiet-research') return <QuietWorkbenchLayout {...props} />;
  return <GlassThreeColumnLayout {...props} />;
}

function GlassThreeColumnLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  defaultLeftWidth = 280,
  defaultRightWidth = 440,
  initialMobilePanel = 'center',
  appearance = 'glass',
  rightFocusKey = null,
  storageScopeKey = '',
  initialPreferences = {},
  onPreferencesChange,
}: ThreeColumnLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const legacyWidthsStorageKey = appearance === 'quiet-research'
    ? `${WIDTHS_STORAGE_KEY}:quiet-research`
    : WIDTHS_STORAGE_KEY;
  const legacyCollapseStorageKey = appearance === 'quiet-research'
    ? `${COLLAPSE_STORAGE_KEY}:quiet-research`
    : COLLAPSE_STORAGE_KEY;
  const widthsStorageKey = storageScopeKey ? `${legacyWidthsStorageKey}:${storageScopeKey}` : legacyWidthsStorageKey;
  const collapseStorageKey = storageScopeKey ? `${legacyCollapseStorageKey}:${storageScopeKey}` : legacyCollapseStorageKey;
  const [leftWidth, setLeftWidth] = useState(() => {
    const stored = initialPreferences.leftPanelWidth
      ?? readStoredWidths(widthsStorageKey, legacyWidthsStorageKey).left;
    return stored && stored >= 220 && stored <= 450 ? stored : defaultLeftWidth;
  });
  const [rightWidth, setRightWidth] = useState(() => {
    const stored = initialPreferences.rightPanelWidth
      ?? readStoredWidths(widthsStorageKey, legacyWidthsStorageKey).right;
    return stored && stored >= 360 && stored <= 680 ? stored : defaultRightWidth;
  });
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'left' | 'center' | 'right'>(initialMobilePanel);
  const [leftCollapsed, setLeftCollapsed] = useState(() => (
    initialPreferences.leftPanelCollapsed
    ?? readStoredCollapse(collapseStorageKey, legacyCollapseStorageKey).left
    ?? false
  ));
  const [rightCollapsed, setRightCollapsed] = useState(() => (
    initialPreferences.rightPanelCollapsed
    ?? readStoredCollapse(collapseStorageKey, legacyCollapseStorageKey).right
    ?? false
  ));
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
      window.localStorage.setItem(widthsStorageKey, JSON.stringify({ left: leftWidth, right: rightWidth }));
    } catch { /* quota — persistence is best-effort */ }
    onPreferencesChange?.({ leftPanelWidth: leftWidth, rightPanelWidth: rightWidth });
  }, [leftWidth, onPreferencesChange, rightWidth, widthsStorageKey]);

  const resizeFromKeyboard = useCallback((side: 'left' | 'right', delta: number) => {
    if (side === 'left') {
      const next = Math.max(220, Math.min(450, leftWidth + delta));
      setLeftWidth(next);
      onPreferencesChange?.({ leftPanelWidth: next });
    } else {
      const next = Math.max(360, Math.min(680, rightWidth + delta));
      setRightWidth(next);
      onPreferencesChange?.({ rightPanelWidth: next });
    }
  }, [leftWidth, onPreferencesChange, rightWidth]);

  const handleDividerKeyDown = (side: 'left' | 'right', event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    resizeFromKeyboard(side, side === 'left' ? direction * 16 : direction * -16);
  };

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

  useEffect(() => {
    if (rightFocusKey) setMobilePanel('right');
  }, [rightFocusKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(collapseStorageKey, JSON.stringify({ left: leftCollapsed, right: rightCollapsed }));
    } catch { /* quota — persistence is best-effort */ }
    onPreferencesChange?.({ leftPanelCollapsed: leftCollapsed, rightPanelCollapsed: rightCollapsed });
  }, [collapseStorageKey, leftCollapsed, onPreferencesChange, rightCollapsed]);

  if (isMobile) {
    const tabs: Array<{ id: 'left' | 'center' | 'right'; label: string }> = [
      { id: 'left', label: '资料' },
      { id: 'center', label: '对话' },
      { id: 'right', label: '产物' },
    ];

    return (
      <div ref={containerRef} className="h-full w-full min-w-0 overflow-hidden flex flex-col">
        <div className="flex-shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/92 px-3 py-2 backdrop-blur-xl">
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
        <div className="min-h-0 flex-1 overflow-hidden liquid-glass-panel" style={{ borderRight: 'none', borderLeft: 'none' }}>
          <div className={mobilePanel === 'left' ? 'h-full' : 'hidden'}>{leftPanel}</div>
          <div className={mobilePanel === 'center' ? 'h-full' : 'hidden'}>{centerPanel}</div>
          <div className={mobilePanel === 'right' ? 'h-full' : 'hidden'}>{rightPanel}</div>
        </div>
      </div>
    );
  }

  const panelClass = appearance === 'quiet-research' ? 'quiet-workbench-panel' : 'liquid-glass-panel';

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full flex ${appearance === 'quiet-research' ? 'quiet-workbench-shell' : ''}`}
      style={{ cursor: dragging ? 'col-resize' : undefined }}
    >
      {leftCollapsed && (
        <aside
          className={`mr-3 flex h-full w-14 flex-shrink-0 flex-col items-center gap-3 overflow-hidden py-3 ${panelClass}`}
          data-testid="workbench-left-rail"
          aria-label="资料库已收起"
        >
          <button
            type="button"
            onClick={() => setLeftCollapsed(false)}
            data-testid="workbench-expand-left"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            title="展开资料库"
            aria-label="展开资料库"
          >
            <PanelLeftOpen className="pointer-events-none h-4 w-4" />
          </button>
          <LibraryBig className="mt-1 h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
          <span className="[writing-mode:vertical-rl] text-xs font-medium tracking-[0.18em] text-[var(--text-tertiary)]">资料库</span>
        </aside>
      )}

      {/* Left Panel — liquid glass */}
      {!leftCollapsed && (
        <div
          className={`h-full flex-shrink-0 overflow-hidden ${panelClass}`}
          style={{ width: leftWidth }}
          data-testid="workbench-left-panel"
        >
          {leftPanel}
        </div>
      )}

      {/* Left Divider */}
      {!leftCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整资料栏宽度"
          aria-valuenow={leftWidth}
          tabIndex={0}
          data-testid="workbench-divider-left"
          className="panel-divider flex-shrink-0"
          onMouseDown={(e) => handleMouseDown('left', e)}
          onKeyDown={(event) => handleDividerKeyDown('left', event)}
          onDoubleClick={() => setLeftCollapsed(true)}
          title="拖拽调宽 · 双击收起"
        />
      )}

      {/* Center Panel — liquid glass */}
      <div
        className={`relative h-full flex-1 overflow-hidden ${panelClass}`}
        style={{ borderRight: 'none', borderLeft: 'none' }}
        data-testid="workbench-center-panel"
      >
        {centerPanel}

        {/* Collapse / expand toggles */}
        {!leftCollapsed && (
          <button
            type="button"
            onClick={() => setLeftCollapsed(true)}
            data-testid="workbench-toggle-left"
            className="absolute left-2 top-1/2 z-20 flex h-9 w-6 -translate-y-1/2 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]/85 text-[var(--text-tertiary)] opacity-40 backdrop-blur transition-all hover:opacity-100 hover:text-[var(--text-primary)]"
            title="收起资料库"
            aria-label="收起资料库"
          >
            <PanelLeftClose className="pointer-events-none h-3.5 w-3.5" />
          </button>
        )}
        {!rightCollapsed && (
          <button
            type="button"
            onClick={() => setRightCollapsed(true)}
            data-testid="workbench-toggle-right"
            className="absolute right-2 top-1/2 z-20 flex h-9 w-6 -translate-y-1/2 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]/85 text-[var(--text-tertiary)] opacity-40 backdrop-blur transition-all hover:opacity-100 hover:text-[var(--text-primary)]"
            title="收起产物中心"
            aria-label="收起产物中心"
          >
            <PanelRightClose className="pointer-events-none h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Right Divider */}
      {!rightCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整产物栏宽度"
          aria-valuenow={rightWidth}
          tabIndex={0}
          data-testid="workbench-divider-right"
          className="panel-divider flex-shrink-0"
          onMouseDown={(e) => handleMouseDown('right', e)}
          onKeyDown={(event) => handleDividerKeyDown('right', event)}
          onDoubleClick={() => setRightCollapsed(true)}
          title="拖拽调宽 · 双击收起"
        />
      )}

      {/* Right Panel — liquid glass */}
      {!rightCollapsed && (
        <div
          className={`h-full flex-shrink-0 overflow-hidden ${panelClass}`}
          style={{
            width: rightWidth,
            borderRight: 'none',
            borderLeft: appearance === 'quiet-research' ? 'none' : '1px solid var(--glass-border)',
          }}
          data-testid="workbench-right-panel"
        >
          {rightPanel}
        </div>
      )}

      {rightCollapsed && (
        <aside
          className={`ml-3 flex h-full w-14 flex-shrink-0 flex-col items-center gap-3 overflow-hidden py-3 ${panelClass}`}
          data-testid="workbench-right-rail"
          aria-label="产物中心已收起"
        >
          <button
            type="button"
            onClick={() => setRightCollapsed(false)}
            data-testid="workbench-expand-right"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            title="展开产物中心"
            aria-label="展开产物中心"
          >
            <PanelRightOpen className="pointer-events-none h-4 w-4" />
          </button>
          <Sparkles className="mt-1 h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
          <span className="[writing-mode:vertical-rl] text-xs font-medium tracking-[0.18em] text-[var(--text-tertiary)]">产物中心</span>
        </aside>
      )}
    </div>
  );
}
