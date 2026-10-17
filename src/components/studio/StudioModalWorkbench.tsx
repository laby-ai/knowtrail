'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useApp } from '@/contexts/AppContext';
import type { StudioSavedOutput } from '@/lib/studio-saved-outputs';
import { StudioSavedOutputs } from './StudioSavedOutputs';
import { StudioOutputViewer } from './StudioOutputViewer';
import type { PresentationMode } from './PresentationModeSelector';
import { STUDIO_NAV, StudioToolSwitcher, type StudioNavItem, type StudioTab } from './StudioToolSwitcher';

export function StudioModalWorkbench({ activeTab, onSelect, onClose, navItems, renderTool }: {
  activeTab: StudioTab | null; onSelect: (tab: StudioTab) => void; onClose: () => void; navItems: StudioNavItem[];
  renderTool: (tab: StudioTab, mode: PresentationMode, onModeChange: (mode: PresentationMode) => void) => ReactNode;
}) {
  const [visited, setVisited] = useState<StudioTab[]>([]);
  const [output, setOutput] = useState<StudioSavedOutput | null>(null);
  const [presentationMode, setPresentationMode] = useState<PresentationMode>('image');
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const parking = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const { revealPaperRequest } = useApp();
  const previousReveal = useRef(revealPaperRequest);
  const nav = STUDIO_NAV.find(item => item.id === (output?.tool || activeTab));
  const Icon = nav?.icon;
  const open = Boolean(activeTab || output);

  useEffect(() => {
    const container = document.createElement('div');
    container.className = 'studio-modal-tool-host';
    parking.current?.appendChild(container); setHost(container);
    return () => container.remove();
  }, []);
  useEffect(() => {
    if (activeTab) setVisited(previous => previous.includes(activeTab) ? previous : [...previous, activeTab]);
  }, [activeTab]);
  useEffect(() => {
    if (previousReveal.current === revealPaperRequest) return;
    previousReveal.current = revealPaperRequest;
    if (revealPaperRequest) { setOutput(null); onClose(); }
  }, [onClose, revealPaperRequest]);
  // Move the same portal host between the dialog and hidden parking. Closing a
  // Radix dialog can unmount its frame without discarding a draft or live job.
  const mountToolHost = useCallback((slot: HTMLDivElement | null) => {
    if (host) (slot || parking.current)?.appendChild(host);
  }, [host]);
  const close = () => { setOutput(null); onClose(); };
  const rememberFocus = () => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const select = (tab: StudioTab) => { rememberFocus(); setOutput(null); onSelect(tab); };
  const openOutput = (saved: StudioSavedOutput) => { rememberFocus(); onClose(); setOutput(saved); };
  const openOutputTool = () => {
    if (!output) return;
    if (output.tool === 'presentation') setPresentationMode(output.kind === 'html-deck' ? 'html' : output.kind === 'structured-ppt' ? 'structured' : 'image');
    onSelect(output.tool); setOutput(null);
  };

  return <>
    <div data-testid="studio-directory-scroll" className="studio-modal-directory h-full min-h-0 overflow-y-auto" data-density="compact">
      <h2>工作室</h2>
      <StudioToolSwitcher compact activeTab={activeTab} onSelect={select} navItems={navItems} />
      <StudioSavedOutputs onOpen={openOutput} />
    </div>
    <div ref={parking} hidden data-testid="studio-tool-parking" />
    {host && createPortal(visited.map(tab => <div key={tab} hidden={tab !== activeTab || Boolean(output)} className="h-full min-h-0" data-studio-tool={tab}>
      {renderTool(tab, presentationMode, setPresentationMode)}
    </div>), host)}
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent className="quiet-studio-dialog" showCloseButton={false} aria-describedby={undefined} onPointerDownOutside={event => {
        // The kept-alive portal's React ancestry is outside DialogContent even
        // while its DOM lives inside the dialog.
        const target = event.detail.originalEvent.target;
        if (target instanceof Node && host?.contains(target)) event.preventDefault();
      }} onCloseAutoFocus={event => {
        event.preventDefault();
        const target = returnFocus.current;
        requestAnimationFrame(() => { if (target?.isConnected) target.focus(); });
      }}>
        <div className="studio-modal-header">
          {Icon && <Icon size={22} aria-hidden="true" />}
          <DialogTitle className="studio-modal-title">{output?.title || nav?.label || '工作室'}</DialogTitle>
          <button type="button" data-testid="studio-modal-close" aria-label="关闭工作室弹窗" onClick={close}><X size={20} /></button>
        </div>
        {output ? <div className="studio-modal-output" data-testid="studio-output-modal">
          <div className="studio-output-toolbar"><span>{nav?.label}</span><button type="button" className="agent-plugin-open" onClick={openOutputTool}>打开{nav?.label}工具</button></div>
          <StudioOutputViewer key={`${output.kind}:${output.revision}`} output={output} />
        </div> : <div ref={mountToolHost} className="studio-modal-mount" />}
      </DialogContent>
    </Dialog>
  </>;
}

