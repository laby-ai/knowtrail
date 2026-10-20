'use client';
import { UiText } from '@/components/account/UiText';
import { CardSpotlight } from '@/components/ui/card-spotlight';

import type { ElementType } from 'react';
import {
  FileSearch,
  GraduationCap,
  Presentation,
  GitBranch,
  Lightbulb,
  Search,
  TableProperties,
  TestTubes,
  BookOpenText,
  WandSparkles,
  ClipboardCheck,
  Images,
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
  'data-processing': { icon: TableProperties, accent: 'from-teal-500/10 to-emerald-500/5' },
  'experiment-design': { icon: TestTubes, accent: 'from-rose-500/10 to-amber-500/5' },
  'academic-writing': { icon: BookOpenText, accent: 'from-indigo-500/10 to-cyan-500/5' },
  'text-polishing': { icon: WandSparkles, accent: 'from-fuchsia-500/10 to-rose-500/5' },
  'scientific-illustration': { icon: Images, accent: 'from-cyan-500/10 to-emerald-500/5' },
  'peer-review': { icon: ClipboardCheck, accent: 'from-violet-500/10 to-emerald-500/5' },
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
  activeTab: StudioTab | null;
  onSelect: (tab: StudioTab) => void;
}) {
  const renderNavButton = (item: StudioNavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;

    return (
      <CardSpotlight key={item.id}>
      <button
        data-testid={`studio-nav-${item.id}`}
        aria-pressed={isActive}
        aria-haspopup="dialog"
        type="button"
        onClick={() => onSelect(item.id)}
        className={`spotlight-glass-card h-full min-h-24 w-full rounded-xl border px-3 py-3 text-left transition-all ${
          isActive
            ? 'border-blue-400/50 bg-blue-500/10'
            : 'border-[var(--glass-border)] bg-[var(--glass-subtle)] hover:border-[var(--border-hover)]'
        }`}
        title={`$<UiText>{item.label}</UiText>：$<UiText>{item.desc}</UiText>`}
      >
        <span className="flex items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${item.accent}`}>
            <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
          </span>
          <span className="min-w-0">
            <span className="line-clamp-2 break-words text-sm font-semibold leading-5 text-[var(--text-primary)]"><UiText>{item.label}</UiText></span>
            <span className="mt-1 line-clamp-2 break-words text-xs leading-[18px] text-[var(--text-tertiary)]"><UiText>{item.desc}</UiText></span>
          </span>
        </span>
      </button>
      </CardSpotlight>
    );
  };

  const visibleCategories = getVisibleStudioCategories();

  return (
    <div className="space-y-3" data-testid="studio-tool-switcher">
      {visibleCategories.map(category => (
        <section key={category.id} data-testid={`studio-category-${category.id}`}>
          <h3 className="mb-2 text-xs font-semibold leading-5 text-[var(--text-secondary)]"><UiText>{category.label}</UiText></h3>
          <div className="grid grid-cols-2 gap-2">
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
