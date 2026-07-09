'use client';

import { useState } from 'react';
import { KnowledgeMapPanel } from './KnowledgeMapPanel';
import { PresentationWorkspacePanel } from './PresentationPanels';
import { VirtualClassroomPanel } from './VirtualClassroomPanel';
import {
  STUDIO_ARTIFACT_TOOLS,
  STUDIO_NAV,
  StudioToolSwitcher,
  type StudioNavItem,
  type StudioTab,
} from './StudioToolSwitcher';
import { StudioArtifactToolPanel } from './StudioArtifactToolPanel';

export function StudioPanel() {
  const [activeTab, setActiveTab] = useState<StudioTab>('presentation');
  const activeToolItem = STUDIO_ARTIFACT_TOOLS.find(n => n.id === activeTab);
  const navItem: StudioNavItem =
    STUDIO_NAV.find(n => n.id === activeTab) ??
    (activeToolItem
      ? {
          id: activeToolItem.id,
          label: activeToolItem.label,
          desc: activeToolItem.desc,
          icon: activeToolItem.icon,
          accent: 'from-blue-500/10 to-cyan-500/5',
        }
      : STUDIO_NAV[0]);
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
          切换入口只打开对应工作区，生成会在右侧产物面板内确认后执行。
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {activeTab === 'presentation' && <PresentationWorkspacePanel />}
        {activeTab === 'presentation2' && <PresentationWorkspacePanel initialMode="structured" />}
        {activeTab === 'knowledge' && <KnowledgeMapPanel />}
        {activeTab === 'virtual-classroom' && <VirtualClassroomPanel />}
        {activeTab === 'interactive' && <StudioArtifactToolPanel toolId="interactive" />}
        {activeTab === 'quiz' && <StudioArtifactToolPanel toolId="quiz" />}
        {activeTab === 'project' && <StudioArtifactToolPanel toolId="project" />}
        {activeTab === 'seminar' && <StudioArtifactToolPanel toolId="seminar" />}
        {activeTab === 'experiment' && <StudioArtifactToolPanel toolId="experiment" />}
        {activeTab === 'results' && <StudioArtifactToolPanel toolId="results" />}
      </div>
    </div>
  );
}
