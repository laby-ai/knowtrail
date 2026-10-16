'use client';

import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import type { ThreeColumnLayoutProps } from './ThreeColumnLayout';

export function QuietWorkbenchLayout({
  leftPanel, centerPanel, rightPanel, rightOpen = false,
  onCloseRight, rightFocusKey, initialMobilePanel = 'center',
  initialPreferences, onPreferencesChange,
}: ThreeColumnLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(initialPreferences?.leftPanelCollapsed ?? false);
  const [mobilePanel, setMobilePanel] = useState(initialMobilePanel);
  const drawerRef = useRef<HTMLElement>(null);
  const previousTool = useRef(rightFocusKey);
  const wasOpen = useRef(false);
  const { revealPaperRequest } = useApp();

  useEffect(() => {
    if (!revealPaperRequest) return;
    setLeftCollapsed(false);
    setMobilePanel('left');
  }, [revealPaperRequest]);

  useEffect(() => {
    if (rightOpen) {
      setMobilePanel('right');
      drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    } else if (wasOpen.current) {
      drawerRef.current?.querySelector<HTMLButtonElement>(`[data-testid="studio-nav-${previousTool.current}"]`)?.focus();
    }
    if (rightOpen) previousTool.current = rightFocusKey;
    wasOpen.current = rightOpen;
  }, [rightOpen, rightFocusKey]);

  useEffect(() => {
    if (!rightOpen) return;
    const close = (event: KeyboardEvent) => {
      // Menus and source dialogs own Escape while they are open.
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"], [role="menu"]')) onCloseRight?.();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [rightOpen, onCloseRight]);

  function toggleLibrary() {
    const next = !leftCollapsed;
    setLeftCollapsed(next);
    onPreferencesChange?.({ leftPanelCollapsed: next });
  }

  return (
    <div className="quiet-workbench-shell" data-mobile-panel={mobilePanel} data-tool-open={rightOpen} data-library-collapsed={leftCollapsed}>
      <div className="quiet-mobile-tabs" role="tablist" aria-label="科研工作区">
        {(['left', 'center', 'right'] as const).map((id, i) => (
          <button key={id} type="button" role="tab" aria-selected={mobilePanel === id} data-testid={`workbench-mobile-tab-${id}`} onClick={() => setMobilePanel(id)}>{['资料', '对话', '工具'][i]}</button>
        ))}
      </div>
      <aside className="quiet-library-pane" data-testid="workbench-left-panel" aria-label="资料库">
        <button type="button" className="quiet-library-toggle" data-testid={leftCollapsed ? 'workbench-expand-left' : 'workbench-toggle-left'} onClick={toggleLibrary} aria-label={leftCollapsed ? '展开资料库' : '收起资料库'} aria-expanded={!leftCollapsed}>
          {leftCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <div className="quiet-library-content">{leftPanel}</div>
      </aside>
      <section className="quiet-main-pane" data-testid="workbench-center-panel" aria-label="文献问答">{centerPanel}</section>
      <aside ref={drawerRef} className="quiet-tools-pane" data-testid="workbench-right-panel" aria-label="工作室">{rightPanel}</aside>
    </div>
  );
}
