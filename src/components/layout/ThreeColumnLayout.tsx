'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface ThreeColumnLayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  initialMobilePanel?: 'left' | 'center' | 'right';
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
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [rightWidth, setRightWidth] = useState(defaultRightWidth);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'left' | 'center' | 'right'>(initialMobilePanel);
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

  if (isMobile) {
    const activePanel = mobilePanel === 'left' ? leftPanel : mobilePanel === 'right' ? rightPanel : centerPanel;
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
          {activePanel}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex"
      style={{ cursor: dragging ? 'col-resize' : undefined }}
    >
      {/* Left Panel — liquid glass */}
      <div
        className="h-full flex-shrink-0 overflow-hidden liquid-glass-panel"
        style={{ width: leftWidth }}
      >
        {leftPanel}
      </div>

      {/* Left Divider */}
      <div
        className="panel-divider flex-shrink-0"
        onMouseDown={(e) => handleMouseDown('left', e)}
      />

      {/* Center Panel — liquid glass */}
      <div className="h-full flex-1 overflow-hidden liquid-glass-panel" style={{ borderRight: 'none', borderLeft: 'none' }}>
        {centerPanel}
      </div>

      {/* Right Divider */}
      <div
        className="panel-divider flex-shrink-0"
        onMouseDown={(e) => handleMouseDown('right', e)}
      />

      {/* Right Panel — liquid glass */}
      <div
        className="h-full flex-shrink-0 overflow-hidden liquid-glass-panel"
        style={{ width: rightWidth, borderRight: 'none', borderLeft: '1px solid var(--glass-border)' }}
      >
        {rightPanel}
      </div>
    </div>
  );
}
