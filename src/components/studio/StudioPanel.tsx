'use client';

import { UiText } from '@/components/account/UiText';
import { useRef, useState, useEffect } from 'react';
import { useApp } from '@/contexts/AppContext';
import { PersistentStudioTool } from './PersistentStudioTool';
import { StudioTaskProvider, type StudioTask } from './StudioTaskContext';
import { StudioTaskRail } from './StudioTaskRail';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from '@/components/ui/dialog';
import { StudioSkillsTools } from './StudioSkillsTools';
import { ResearchMcpPanel } from '@/components/mcp/ResearchMcpPanel';
import { KnowledgeMapWorkspace } from './KnowledgeMapWorkspace';
import { VirtualClassroomWorkspace } from './VirtualClassroomWorkspace';
import { KnowledgeMapPanel } from './KnowledgeMapPanel';
import { PresentationWorkspacePanel } from './PresentationPanels';
import { VirtualClassroomPanel } from './VirtualClassroomPanel';
import { PaperSearchPanel } from './PaperSearchPanel';
import { DeepResearchPanel } from './DeepResearchPanel';
import { HypothesisGenerationPanel } from './HypothesisGenerationPanel';
import { DataProcessingPanel } from './DataProcessingPanel';
import { ExperimentDesignPanel } from './ExperimentDesignPanel';
import { AcademicWritingPanel } from './AcademicWritingPanel';
import { PeerReviewPanel } from './PeerReviewPanel';
import { ScientificIllustrationPanel } from './ScientificIllustrationPanel';
import { TextPolishingPanel } from './TextPolishingPanel';
import {
  STUDIO_NAV,
  StudioToolSwitcher,
  type StudioNavItem,
  type StudioTab,
} from './StudioToolSwitcher';

export function StudioPanel() {
  const { storageScopeKey } = useApp();
  return <StudioTaskProvider key={storageScopeKey}><StudioPanelContent /></StudioTaskProvider>;
}

function StudioPanelContent() {
  const [activeTab, setActiveTab] = useState<StudioTab | null>(null);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [visited, setVisited] = useState<Array<'presentation' | 'deep-research'>>([]);
  useEffect(() => {
    if (activeTab === 'presentation' || activeTab === 'deep-research') {
      setVisited(previous => previous.includes(activeTab) ? previous : [...previous, activeTab]);
    }
  }, [activeTab]);
  useEffect(() => {
    const openTool = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      const item = STUDIO_NAV.find((entry) => entry.id === detail);
      if (item) setActiveTab(item.id);
    };
    window.addEventListener('lingbi:open-studio-tool', openTool);
    return () => window.removeEventListener('lingbi:open-studio-tool', openTool);
  }, []);
  useEffect(() => {
    const open = () => setActiveTab('data-processing');
    window.addEventListener('lingbi:open-data-analysis', open);
    return () => window.removeEventListener('lingbi:open-data-analysis', open);
  }, []);
  const navItem: StudioNavItem = STUDIO_NAV.find(n => n.id === activeTab) ?? STUDIO_NAV[0];
  const NavIcon = navItem.icon;
  const triggerRef = useRef<HTMLElement | null>(null);
  const { knowledgeMapViewer, virtualClassroomViewer } = useApp();
  const openTool = (tab: StudioTab) => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActiveTab(tab);
  };
  const openTask = (task: StudioTask) => {
    openTool(task.tool);
    if (task.mode) window.dispatchEvent(new CustomEvent('lingbi:open-presentation-mode', { detail: task.mode }));
  };

  return (
    <div className="h-full w-full min-w-0 overflow-y-auto" data-testid="studio-panel">
      <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${navItem.accent} flex items-center justify-center border border-[var(--glass-border)]`}>
            <NavIcon className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]"><UiText>产物中心</UiText></h2>
            <p className="text-sm leading-6 text-[var(--text-tertiary)]"><UiText>资料工具与生成结果</UiText></p>
          </div>
        </div>

        <StudioTaskRail onOpen={openTask} />
        <StudioToolSwitcher activeTab={activeTab} onSelect={openTool} />
        <p data-testid="studio-nav-helper" className="mt-3 text-xs leading-5 text-[var(--text-tertiary)]"><UiText>
          点击入口打开弹窗，检索或生成需在弹窗内确认。
        </UiText></p>
      </div>

      <div className="px-5 py-4"><StudioSkillsTools /><ResearchMcpPanel /></div>
      <Dialog open={activeTab !== null} onOpenChange={open => { if (!open) setActiveTab(null); }}>
        <DialogContent
          data-testid="studio-tool-dialog"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          className="flex h-[min(860px,calc(100dvh-2rem))] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl border-[var(--glass-border)] p-0 sm:max-w-5xl"
          onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus(); }}
        >
          <DialogHeader className="shrink-0 border-b border-[var(--glass-border)] px-6 py-4 pr-12 text-left">
            <DialogTitle>{navItem.label}</DialogTitle>
            <DialogDescription>{navItem.desc}</DialogDescription>
            {(activeTab === 'presentation' || activeTab === 'deep-research') && <p className="text-sm leading-6 text-[var(--text-secondary)]">生成中可关闭弹窗，在产物中心查看进度。请保留当前页面，刷新或离开文献本可能中断。</p>}
          </DialogHeader>
          <div ref={setBody} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6" data-testid="studio-tool-body">
            {activeTab === 'paper-search' && <PaperSearchPanel />}
            {activeTab === 'hypothesis-generation' && <HypothesisGenerationPanel />}
            {activeTab === 'data-processing' && <DataProcessingPanel />}
            {activeTab === 'experiment-design' && <ExperimentDesignPanel />}
            {activeTab === 'academic-writing' && <AcademicWritingPanel />}
            {activeTab === 'scientific-illustration' && <ScientificIllustrationPanel />}
            {activeTab === 'text-polishing' && <TextPolishingPanel />}
            {activeTab === 'peer-review' && <PeerReviewPanel />}
            {activeTab === 'knowledge' && (knowledgeMapViewer ? <KnowledgeMapWorkspace /> : <KnowledgeMapPanel />)}
            {activeTab === 'virtual-classroom' && (virtualClassroomViewer ? <VirtualClassroomWorkspace /> : <VirtualClassroomPanel />)}
          </div>
        </DialogContent>
      </Dialog>
      {visited.map(tab => <PersistentStudioTool key={tab} active={activeTab === tab} target={body}>
        {tab === 'presentation' ? <PresentationWorkspacePanel /> : <DeepResearchPanel />}
      </PersistentStudioTool>)}
    </div>
  );
}
