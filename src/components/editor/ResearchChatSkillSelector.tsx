'use client';

import {
  BookOpenText,
  ClipboardCheck,
  FileSearch,
  FileText,
  FlaskConical,
  Lightbulb,
  MessageCircle,
  Search,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
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
}: {
  selectedSkillId: ResearchChatSkillId | null;
  onSelect: (skillId: ResearchChatSkillId) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  return (
      <div data-testid="chat-skill-shortcuts" className="quiet-mode-bar" role="group" aria-label="对话模式">
        <button type="button" disabled={disabled} aria-pressed={!selectedSkillId} data-testid="chat-skill-normal" onClick={onClear}><MessageCircle />普通问答</button>
        {RESEARCH_CHAT_SKILLS.map(skill => {
          const Icon = SKILL_ICONS[skill.id];
          return <button key={skill.id} type="button" title={skill.description} disabled={disabled} aria-pressed={selectedSkillId === skill.id} data-testid={`chat-skill-shortcut-${skill.id}`} onClick={() => onSelect(skill.id)}><Icon />{skill.label}</button>;
        })}
      </div>
  );
}
