'use client';

import { useEffect, useMemo, useState } from 'react';
import { KnowledgeMapPanel } from './KnowledgeMapPanel';
import { PresentationWorkspacePanel } from './PresentationPanels';
import { VirtualClassroomPanel } from './VirtualClassroomPanel';
import { PaperSearchPanel } from './PaperSearchPanel';
import { DeepResearchPanel } from './DeepResearchPanel';
import { HypothesisGenerationPanel } from './HypothesisGenerationPanel';
import { DataProcessingPanel } from './DataProcessingPanel';
import { ExperimentDesignPanel } from './ExperimentDesignPanel';
import { AcademicWritingPanel } from './AcademicWritingPanel';
import { TextPolishingPanel } from './TextPolishingPanel';
import { PeerReviewPanel } from './PeerReviewPanel';
import { ScientificIllustrationPanel } from './ScientificIllustrationPanel';
import {
  STUDIO_NAV,
  StudioToolSwitcher,
  getVisibleStudioNav,
  shouldHideVirtualClassroom,
  type StudioNavItem,
  type StudioTab,
} from './StudioToolSwitcher';

export function StudioPanel({ compact = false }: { compact?: boolean }) {
  const [activeTab, setActiveTab] = useState<StudioTab>(STUDIO_NAV[0].id);
  const [hideVirtualClassroom, setHideVirtualClassroom] = useState(false);
  const visibleNavItems = useMemo(
    () => getVisibleStudioNav(hideVirtualClassroom),
    [hideVirtualClassroom],
  );

  useEffect(() => {
    setHideVirtualClassroom(shouldHideVirtualClassroom());
  }, []);

  useEffect(() => {
    if (!visibleNavItems.some(item => item.id === activeTab)) {
      setActiveTab(visibleNavItems[0].id);
    }
  }, [activeTab, visibleNavItems]);

  const navItem: StudioNavItem = visibleNavItems.find(n => n.id === activeTab) ?? visibleNavItems[0];
  const NavIcon = navItem.icon;

  return (
    <div className="h-full overflow-y-auto" data-density={compact ? 'compact' : 'default'}>
      <div className={compact
        ? 'border-b border-[#E4E9F1] px-4 pb-3 pt-3'
        : 'border-b border-[var(--glass-border)] px-5 pb-4 pt-5'}>
        <div className={compact ? 'mb-3 flex items-center gap-2.5' : 'mb-4 flex items-center gap-3'}>
          <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${navItem.accent} flex items-center justify-center border border-[var(--glass-border)]`}>
            <NavIcon className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>
          <div>
            <h2 className={compact
              ? 'text-sm font-semibold tracking-tight text-[var(--text-primary)]'
              : 'text-base font-semibold tracking-tight text-[var(--text-primary)]'}>产物中心</h2>
            <p className="text-[11px] text-[var(--text-tertiary)]">资料工具与生成结果</p>
          </div>
        </div>

        <StudioToolSwitcher compact={compact} activeTab={activeTab} onSelect={setActiveTab} navItems={visibleNavItems} />
        <p data-testid="studio-nav-helper" className="mt-3 text-[10px] leading-relaxed text-[var(--text-quaternary)]">
          切换入口只打开对应工作区，检索或生成需在下方明确操作。
        </p>
      </div>

      <div className={compact ? 'px-4 py-3' : 'px-5 py-4'}>
        {activeTab === 'paper-search' && <PaperSearchPanel />}
        {activeTab === 'deep-research' && <DeepResearchPanel />}
        {activeTab === 'hypothesis-generation' && <HypothesisGenerationPanel />}
        {activeTab === 'data-processing' && <DataProcessingPanel />}
        {activeTab === 'experiment-design' && <ExperimentDesignPanel />}
        {activeTab === 'academic-writing' && <AcademicWritingPanel />}
        {activeTab === 'text-polishing' && <TextPolishingPanel />}
        {activeTab === 'scientific-illustration' && <ScientificIllustrationPanel />}
        {activeTab === 'peer-review' && <PeerReviewPanel />}
        {activeTab === 'presentation' && <PresentationWorkspacePanel />}
        {activeTab === 'knowledge' && <KnowledgeMapPanel />}
        {activeTab === 'virtual-classroom' && <VirtualClassroomPanel />}
      </div>
    </div>
  );
}
