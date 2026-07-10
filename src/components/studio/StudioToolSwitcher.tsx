'use client';

import type { ElementType } from 'react';
import {
  FileSearch,
  GraduationCap,
  Presentation,
  GitBranch,
  Lightbulb,
  Search,
} from 'lucide-react';
import {
  getVisibleStudioCategories,
  STUDIO_RESEARCH_PRODUCTS,
  type StudioProductId,
  type StudioResearchProduct,
} from '@/lib/studio-research-taxonomy';

export type StudioTab = StudioProductId;

export interface StudioNavItem extends StudioResearchProduct {
  icon: ElementType;
  accent: string;
}

const PRODUCT_VISUALS: Record<StudioTab, Pick<StudioNavItem, 'icon' | 'accent'>> = {
  'paper-search': { icon: Search, accent: 'from-violet-500/10 to-blue-500/5' },
  'deep-research': { icon: FileSearch, accent: 'from-cyan-500/10 to-blue-500/5' },
  'hypothesis-generation': { icon: Lightbulb, accent: 'from-amber-500/10 to-rose-500/5' },
  presentation: { icon: Presentation, accent: 'from-amber-500/10 to-sky-500/5' },
  knowledge: { icon: GitBranch, accent: 'from-blue-500/10 to-cyan-500/5' },
  'virtual-classroom': { icon: GraduationCap, accent: 'from-emerald-500/10 to-sky-500/5' },
};

export const STUDIO_NAV: StudioNavItem[] = STUDIO_RESEARCH_PRODUCTS.map(product => ({
  ...product,
  ...PRODUCT_VISUALS[product.id],
}));

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

  const visibleCategories = getVisibleStudioCategories();

  return (
    <div className="space-y-4" data-testid="studio-tool-switcher">
      {visibleCategories.map(category => (
        <section key={category.id} data-testid={`studio-category-${category.id}`}>
          <h3 className="mb-2 text-[10px] font-semibold text-[var(--text-tertiary)]">{category.label}</h3>
          <div className="grid grid-cols-1 gap-2">
            {category.products.map(product => {
              const item = STUDIO_NAV.find(navItem => navItem.id === product.id);
              return item ? renderNavButton(item) : null;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
