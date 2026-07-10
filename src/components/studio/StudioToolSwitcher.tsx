'use client';

import type { ElementType } from 'react';
import {
  GraduationCap,
  Presentation,
  GitBranch,
} from 'lucide-react';

export type StudioTab =
  | 'presentation'
  | 'knowledge'
  | 'virtual-classroom';

export interface StudioNavItem {
  id: StudioTab;
  label: string;
  desc: string;
  icon: ElementType;
  accent: string;
  status?: 'ready';
}

export const STUDIO_NAV: StudioNavItem[] = [
  { id: 'presentation', label: '演示文稿', desc: '图片页 / 可编辑 PPT', icon: Presentation, accent: 'from-amber-500/10 to-sky-500/5' },
  { id: 'knowledge', label: '资料脉络', desc: '核心词和关系', icon: GitBranch, accent: 'from-blue-500/10 to-cyan-500/5' },
  { id: 'virtual-classroom', label: '虚拟课堂', desc: '课堂系统', icon: GraduationCap, accent: 'from-emerald-500/10 to-sky-500/5' },
];

export function StudioToolSwitcher({
  activeTab,
  onSelect,
}: {
  activeTab: StudioTab;
  onSelect: (tab: StudioTab) => void;
}) {
  const renderNavButton = (item: StudioNavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;

    return (
      <button
        key={item.id}
        data-testid={`studio-nav-${item.id}`}
        aria-pressed={isActive}
        onClick={() => onSelect(item.id)}
        className={`spotlight-glass-card rounded-xl border px-3 py-2.5 text-left transition-all ${
          isActive
            ? 'border-blue-400/50 bg-blue-500/10'
            : 'border-[var(--glass-border)] bg-[var(--glass-subtle)] hover:border-[var(--border-hover)]'
        }`}
        title={`${item.label}：${item.desc}`}
      >
        <span className="flex items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${item.accent}`}>
            <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-semibold leading-tight text-[var(--text-primary)]">{item.label}</span>
            <span className="mt-0.5 block truncate text-[10px] leading-tight text-[var(--text-tertiary)]">{item.desc}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-2" data-testid="studio-tool-switcher">
      <div className="grid grid-cols-2 gap-2">
        {STUDIO_NAV.map(item => renderNavButton(item))}
      </div>
    </div>
  );
}
