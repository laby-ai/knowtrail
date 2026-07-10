'use client';

import { useState } from 'react';
import { KnowledgeMapPanel } from './KnowledgeMapPanel';
import { PresentationWorkspacePanel } from './PresentationPanels';
import { VirtualClassroomPanel } from './VirtualClassroomPanel';
import { PaperSearchPanel } from './PaperSearchPanel';
import { DeepResearchPanel } from './DeepResearchPanel';
import { HypothesisGenerationPanel } from './HypothesisGenerationPanel';
import { DataProcessingPanel } from './DataProcessingPanel';
import {
  STUDIO_NAV,
  StudioToolSwitcher,
  type StudioNavItem,
  type StudioTab,
} from './StudioToolSwitcher';

export function StudioPanel() {
  const [activeTab, setActiveTab] = useState<StudioTab>(STUDIO_NAV[0].id);
  const navItem: StudioNavItem = STUDIO_NAV.find(n => n.id === activeTab) ?? STUDIO_NAV[0];
  const NavIcon = navItem.icon;

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${navItem.accent} flex items-center justify-center border border-[var(--glass-border)]`}>
            <NavIcon className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">产物中心</h2>
            <p className="text-[11px] text-[var(--text-tertiary)]">资料工具与生成结果</p>
          </div>
        </div>

        <StudioToolSwitcher activeTab={activeTab} onSelect={setActiveTab} />
        <p data-testid="studio-nav-helper" className="mt-3 text-[10px] leading-relaxed text-[var(--text-quaternary)]">
          切换入口只打开对应工作区，检索或生成需在下方明确操作。
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {activeTab === 'paper-search' && <PaperSearchPanel />}
        {activeTab === 'deep-research' && <DeepResearchPanel />}
        {activeTab === 'hypothesis-generation' && <HypothesisGenerationPanel />}
        {activeTab === 'data-processing' && <DataProcessingPanel />}
        {activeTab === 'presentation' && <PresentationWorkspacePanel />}
        {activeTab === 'knowledge' && <KnowledgeMapPanel />}
        {activeTab === 'virtual-classroom' && <VirtualClassroomPanel />}
      </div>
    </div>
  );
}
