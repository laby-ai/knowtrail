'use client';

import { ArrowUpRight, Clock3, FileText, Plus } from 'lucide-react';
import {
  formatNotebookDate,
  type WorkspaceNotebook,
} from '@/components/home/workspace-types';
export function CreateNotebookCard({ disabled, onCreate }: { disabled: boolean; onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      disabled={disabled}
      className="research-notebook-card liquid-glass-card flex min-h-[184px] flex-col items-center justify-center rounded-xl p-5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
      className={`research-notebook-card liquid-glass-card group flex min-h-[184px] flex-col justify-between rounded-xl p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
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
