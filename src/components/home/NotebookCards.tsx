'use client';

import { ArrowUpRight, BookOpen, Clock3, FileText, Plus } from 'lucide-react';
import {
  formatNotebookDate,
  type WorkspaceNotebook,
} from '@/components/home/workspace-types';
import { FEATURED_NOTEBOOKS } from '@/components/home/featured-notebooks';

export function FeaturedNotebookStrip({
  disabled,
  onOpen,
}: {
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const ACCENT_GLOWS: Record<string, string> = {
    'featured-ai-learning': 'rgba(244, 214, 145, 0.25)',
    'featured-personal-knowledge': 'rgba(96, 165, 250, 0.25)',
    'featured-research-reading': 'rgba(239, 68, 68, 0.25)',
    'featured-product-ideas': 'rgba(52, 211, 153, 0.25)',
  };

  return (
    <section className="mx-auto max-w-7xl px-4 pb-6 pt-7 sm:px-5 sm:pb-8" data-testid="notebook-home-featured-strip">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">精选模板</h2>
        <span className="text-sm text-[var(--text-secondary)]">4 个研究场景</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {FEATURED_NOTEBOOKS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            disabled={disabled}
            className="home-motion-card liquid-glass-card group flex min-h-[140px] flex-col overflow-hidden rounded-xl p-4 text-left shadow-[0_10px_28px_rgba(15,23,42,0.10)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ borderColor: ACCENT_GLOWS[item.id] ?? 'var(--glass-border)' }}
            data-testid={`notebook-home-featured-${item.id}`}
            aria-label={`打开精选文献本 ${item.title}`}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-primary)] sm:text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--glass-active)] text-[var(--text-primary)]">
                <BookOpen className="h-4 w-4" />
              </span>
              <ArrowUpRight className="h-4 w-4 opacity-50 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-80" />
            </div>
            <h3 className="mt-4 text-base font-semibold leading-snug text-[var(--text-primary)] sm:text-lg">{item.title}</h3>
            <p className="mt-auto pt-2 text-xs font-medium text-[var(--text-secondary)]">{item.author} · {item.meta}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

export function CreateNotebookCard({ disabled, onCreate }: { disabled: boolean; onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      disabled={disabled}
      className="home-motion-card liquid-glass-card flex min-h-[184px] flex-col items-center justify-center rounded-xl p-5 text-center transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      data-testid="notebook-home-create-card"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-lg text-blue-300" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)' }}>
        <Plus className="h-5 w-5" />
      </span>
      <span className="mt-4 block text-base font-semibold tracking-tight text-white">新建文献本</span>
    </button>
  );
}

export function NotebookCard({
  notebook,
  active,
  disabled,
  onOpen,
}: {
  notebook: WorkspaceNotebook;
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={`home-motion-card liquid-glass-card group flex min-h-[184px] flex-col justify-between rounded-xl p-5 text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'ring-2 ring-blue-400/50'
          : ''
      }`}
      data-testid={`notebook-home-card-${notebook.id}`}
    >
      <div className="flex items-start justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${notebook.accent}`}>
          <FileText className="h-5 w-5 text-white/90" />
        </span>
        <ArrowUpRight className="h-4 w-4 text-white/40 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white/70" />
      </div>

      <div>
        <h2 className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight text-white">{notebook.title}</h2>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-white/60">
          <Clock3 className="h-3.5 w-3.5" />
          {formatNotebookDate(notebook.updatedAt)} · {notebook.sourceCount} 个来源
        </p>
        <span
          className="mt-4 inline-flex text-xs font-semibold text-blue-300"
          data-testid={`notebook-home-open-${notebook.id}`}
        >
          打开文献本
        </span>
      </div>
    </button>
  );
}
