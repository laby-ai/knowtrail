'use client';

import { Check, Code2, FileText, ImageIcon, Presentation } from 'lucide-react';
import type { ElementType } from 'react';

export type PresentationMode = 'image' | 'html' | 'structured';

type PresentationModeOption = {
  id: PresentationMode;
  label: string;
  badge: string;
  icon: ElementType;
};

const MODE_OPTIONS: PresentationModeOption[] = [
  {
    id: 'image',
    label: '图片页简报',
    badge: '视觉版',
    icon: ImageIcon,
  },
  {
    id: 'html',
    label: 'HTML 简报',
    badge: '设计版',
    icon: Code2,
  },
  {
    id: 'structured',
    label: '结构化 PPT',
    badge: '学术版',
    icon: FileText,
  },
];

export function PresentationModeSelector({
  mode,
  onModeChange,
}: {
  mode: PresentationMode;
  onModeChange: (mode: PresentationMode) => void;
}) {
  return (
    <section className="liquid-glass-card p-3 space-y-2" data-testid="presentation-mode-selector">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Presentation className="h-4 w-4 text-[var(--text-secondary)]" />
          <span>PPT 制作</span>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)]">
          选择产物
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {MODE_OPTIONS.map(option => {
          const Icon = option.icon;
          const selected = mode === option.id;
          return (
            <button
              key={option.id}
              data-testid={`presentation-mode-${option.id}`}
              aria-pressed={selected}
              onClick={() => onModeChange(option.id)}
              className={`spotlight-glass-card rounded-xl border px-3 py-2 text-left transition-all ${
                selected
                  ? 'border-blue-400/55 bg-blue-500/10 shadow-[0_12px_28px_rgba(37,99,235,0.12)]'
                  : 'border-[var(--glass-border)] bg-[var(--glass-subtle)] hover:border-[var(--border-hover)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                  selected
                    ? 'border-blue-400/40 bg-blue-500/15 text-blue-500 dark:text-blue-300'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
                }`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold leading-tight text-[var(--text-primary)]">
                    <span className="truncate">{option.label}</span>
                    <span className="rounded-full bg-[var(--glass-hover)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)]">
                      {option.badge}
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 text-blue-500" />}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
