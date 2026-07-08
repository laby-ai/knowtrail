'use client';

import { BookOpen, Clock3, FileText, MoreVertical, Plus } from 'lucide-react';
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
  return (
    <section className="mx-auto max-w-7xl px-5 py-10" data-testid="notebook-home-featured-strip">
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-medium tracking-tight text-slate-950">精选文献本</h2>
        <span className="hidden h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 shadow-sm sm:inline-flex">
          示例可直接打开
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {FEATURED_NOTEBOOKS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            disabled={disabled}
            className="home-motion-card group min-h-[176px] overflow-hidden rounded-2xl p-5 text-left text-white shadow-[0_18px_44px_rgba(15,23,42,0.12)] transition hover:-translate-y-1 hover:shadow-[0_24px_54px_rgba(15,23,42,0.18)] focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: item.image }}
            data-testid={`notebook-home-featured-${item.id}`}
            aria-label={`打开精选文献本 ${item.title}`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-white/92">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/92 text-slate-950">
                <BookOpen className="h-4 w-4" />
              </span>
              {item.author}
            </div>
            <h3 className="mt-6 max-w-[14rem] text-2xl font-medium leading-tight tracking-tight">{item.title}</h3>
            <p className="mt-4 text-sm font-medium text-white/84">2026 · {item.meta}</p>
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
      className="home-motion-card flex min-h-[250px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_22px_50px_rgba(37,99,235,0.10)] disabled:cursor-not-allowed disabled:opacity-60"
      data-testid="notebook-home-create-card"
    >
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#eef2ff] text-blue-600">
        <Plus className="h-7 w-7" />
      </span>
      <span className="mt-8 block text-2xl font-normal tracking-tight text-slate-950">新建文献本</span>
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
      className={`home-motion-card group flex min-h-[250px] flex-col justify-between rounded-2xl border p-6 text-left transition hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'border-blue-300 bg-[#eef2ff] shadow-[0_22px_54px_rgba(37,99,235,0.12)]'
          : 'border-transparent bg-[#eff2fc] hover:bg-[#e9eefb]'
      }`}
      data-testid={`notebook-home-card-${notebook.id}`}
    >
      <div className="flex items-start justify-between">
        <span className={`flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${notebook.accent}`}>
          <FileText className="h-7 w-7 text-slate-700" />
        </span>
        <MoreVertical className="h-5 w-5 text-slate-500" />
      </div>

      <div>
        <h2 className="line-clamp-2 text-2xl font-normal leading-tight tracking-tight text-slate-950">{notebook.title}</h2>
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          <Clock3 className="h-4 w-4" />
          {formatNotebookDate(notebook.updatedAt)} · {notebook.sourceCount} 个来源
        </p>
        <span
          className="mt-5 inline-flex rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 opacity-0 transition group-hover:opacity-100"
          data-testid={`notebook-home-open-${notebook.id}`}
        >
          打开
        </span>
      </div>
    </button>
  );
}
