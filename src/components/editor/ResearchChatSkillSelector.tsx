'use client';

import {
  BookOpenText,
  ClipboardCheck,
  FileSearch,
  FileText,
  FlaskConical,
  Lightbulb,
  MessageCircle,
  ChevronDown,
  Search,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  RESEARCH_CHAT_SKILLS,
  type ResearchChatSkillId,
} from '@/lib/research-chat-skills';

const SKILL_ICONS: Record<ResearchChatSkillId, LucideIcon> = {
  'paper-search': Search,
  'deep-research': FileSearch,
  'literature-review': FileText,
  'hypothesis-generation': Lightbulb,
  'experiment-design': FlaskConical,
  'academic-writing': BookOpenText,
  'text-polishing': WandSparkles,
  'peer-review': ClipboardCheck,
};

export function ResearchChatSkillSelector({
  selectedSkillId,
  onSelect,
  onClear,
  disabled,
  inline = false,
}: {
  selectedSkillId: ResearchChatSkillId | null;
  onSelect: (skillId: ResearchChatSkillId) => void;
  onClear: () => void;
  disabled: boolean;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div data-testid="chat-skill-shortcuts" className="quiet-mode-bar" role="group" aria-label="对话模式">
        <button type="button" disabled={disabled} aria-pressed={!selectedSkillId} data-testid="chat-skill-normal" onClick={onClear}><MessageCircle />普通问答</button>
        {RESEARCH_CHAT_SKILLS.map(skill => {
          const Icon = SKILL_ICONS[skill.id];
          return <button key={skill.id} type="button" disabled={disabled} aria-pressed={selectedSkillId === skill.id} data-testid={`chat-skill-shortcut-${skill.id}`} onClick={() => onSelect(skill.id)}><Icon />{skill.label}</button>;
        })}
      </div>
    );
  }
  const selected = RESEARCH_CHAT_SKILLS.find(skill => skill.id === selectedSkillId);
  const SelectedIcon = selectedSkillId ? SKILL_ICONS[selectedSkillId] : MessageCircle;
  return (
    <div data-testid="chat-skill-shortcuts" className="min-w-0 flex-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={disabled} data-testid="chat-mode-menu" className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border-subtle)] px-3 text-sm text-[var(--text-secondary)]">
            <SelectedIcon className="chat-mode-icon h-4 w-4 shrink-0" />
            {selected?.label || '普通问答'}
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56 border-[var(--border-subtle)] bg-[var(--bg-primary)] p-1.5 text-[var(--text-primary)]">
          <DropdownMenuItem data-testid="chat-skill-normal" onSelect={onClear} className="gap-2 py-2.5 text-sm"><MessageCircle className="h-4 w-4" />普通问答</DropdownMenuItem>
          {RESEARCH_CHAT_SKILLS.map(skill => {
            const Icon = SKILL_ICONS[skill.id];
            return <DropdownMenuItem key={skill.id} data-testid={`chat-skill-shortcut-${skill.id}`} onSelect={() => onSelect(skill.id)} className="gap-2 py-2.5 text-sm"><Icon className="h-4 w-4" />{skill.label}</DropdownMenuItem>;
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
