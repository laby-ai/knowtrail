'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { StudioModalWorkbench } from './StudioModalWorkbench';
import type { PresentationMode } from './PresentationModeSelector';
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
import { LearningArtifactsPanel } from './LearningArtifactsPanel';
import {
  STUDIO_NAV,
  StudioToolSwitcher,
  getVisibleStudioNav,
  shouldHideVirtualClassroom,
  type StudioNavItem,
  type StudioTab,
} from './StudioToolSwitcher';

export const ACTIVE_TOOL_STORAGE_KEY = 'knowtrail:studio-active-tool';

export function StudioPanel({
  compact = false,
  activeTab,
  onSelect,
  onClose,
}: {
  compact?: boolean;
  activeTab: StudioTab | null;
  onSelect: (tab: StudioTab) => void;
  onClose: () => void;
}) {
  const [hideVirtualClassroom, setHideVirtualClassroom] = useState(false);
  const visibleNavItems = useMemo(
    () => getVisibleStudioNav(hideVirtualClassroom),
    [hideVirtualClassroom],
  );
  const DirectoryIcon = STUDIO_NAV[0].icon;

  useEffect(() => {
    setHideVirtualClassroom(shouldHideVirtualClassroom());
  }, []);

  if (compact) return <StudioModalWorkbench activeTab={activeTab} onSelect={onSelect} onClose={onClose} navItems={visibleNavItems}
    renderTool={(tab, mode, onModeChange) => <StudioWorkspacePanel compact inDialog activeTab={tab} onClose={onClose} presentationMode={mode} onPresentationModeChange={onModeChange} />} />;

  if (activeTab) {
    return (
      <StudioWorkspacePanel
        compact={compact}
        activeTab={activeTab}
        onClose={onClose}
      />
    );
  }

  return (
    <div
      data-testid="studio-directory-scroll"
      className="h-full min-h-0 overflow-y-auto"
      data-density={compact ? 'compact' : 'default'}
    >
      <div className={compact ? 'px-4 pb-4 pt-3' : 'px-5 pb-5 pt-5'}>
        <div className={compact ? 'mb-4 flex items-center gap-2.5' : 'mb-5 flex items-center gap-3'}>
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)]">
            <DirectoryIcon className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>
          <div>
            <h2 className={compact
              ? 'text-sm font-semibold tracking-tight text-[var(--text-primary)]'
              : 'text-base font-semibold tracking-tight text-[var(--text-primary)]'}>工作室</h2>
          </div>
        </div>

        <StudioToolSwitcher
          compact={compact}
          activeTab={activeTab}
          onSelect={onSelect}
          navItems={visibleNavItems}
        />
      </div>
    </div>
  );
}

export function StudioWorkspacePanel({
  compact = false,
  inDialog = false,
  activeTab,
  onClose,
  presentationMode,
  onPresentationModeChange,
}: {
  compact?: boolean;
  inDialog?: boolean;
  activeTab: StudioTab;
  onClose: () => void;
  presentationMode?: PresentationMode;
  onPresentationModeChange?: (mode: PresentationMode) => void;
}) {
  const navItem: StudioNavItem = STUDIO_NAV.find(item => item.id === activeTab) ?? STUDIO_NAV[0];
  const NavIcon = navItem.icon;

  return (
    <div
      data-testid="studio-workspace-right"
      className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]"
      data-density={compact ? 'compact' : 'default'}
    >
      {!inDialog && <div
        data-testid="studio-workspace-header"
        className={compact
          ? 'flex shrink-0 items-center gap-3 border-b border-[#E4E9F1] px-4 py-3'
          : 'flex shrink-0 items-center gap-3 border-b border-[var(--glass-border)] px-5 py-4'}
      >
        <button
          type="button"
          data-testid="studio-back-to-directory"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          aria-label="返回工具列表"
          title="返回工具列表"
        >
          <ArrowLeft className="pointer-events-none h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div
            data-testid="studio-workspace-breadcrumb"
            className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-[var(--text-tertiary)]"
          >
            <span>产物中心</span>
            <span aria-hidden="true">›</span>
            <span className="truncate">{navItem.label}</span>
          </div>
          <h2 className="mt-0.5 truncate text-sm font-semibold tracking-tight text-[var(--text-primary)]">{navItem.label}</h2>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-gradient-to-br ${navItem.accent}`}>
          <NavIcon className="h-4 w-4 text-[var(--text-secondary)]" />
        </div>
      </div>}

      <div
        data-testid="studio-workspace-scroll"
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${compact ? 'px-4 py-4' : 'px-5 py-5'}`}
      >
        <div className="space-y-4">
          <div
            data-testid="studio-tool-content"
            className={compact ? "min-w-0" : "rounded-[20px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4"}
          >
            {activeTab === 'paper-search' && <PaperSearchPanel />}
            {activeTab === 'deep-research' && <DeepResearchPanel />}
            {activeTab === 'hypothesis-generation' && <HypothesisGenerationPanel />}
            {activeTab === 'data-processing' && <DataProcessingPanel />}
            {activeTab === 'experiment-design' && <ExperimentDesignPanel />}
            {activeTab === 'academic-writing' && <AcademicWritingPanel />}
            {activeTab === 'text-polishing' && <TextPolishingPanel />}
            {activeTab === 'scientific-illustration' && <ScientificIllustrationPanel />}
            {activeTab === 'peer-review' && <PeerReviewPanel />}
            {activeTab === 'presentation' && <PresentationWorkspacePanel mode={presentationMode} onModeChange={onPresentationModeChange} />}
            {activeTab === 'knowledge' && <KnowledgeMapPanel />}
            {activeTab === 'report' && <DeepResearchPanel />}
            {activeTab === 'flashcards' && <LearningArtifactsPanel mode="flashcards" />}
            {activeTab === 'quiz' && <LearningArtifactsPanel mode="quiz" />}
            {activeTab === 'virtual-classroom' && <VirtualClassroomPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
