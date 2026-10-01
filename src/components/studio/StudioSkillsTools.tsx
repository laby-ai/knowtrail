'use client';

import { useState } from 'react';
import { Settings, FileSearch, BookOpen, TrendingUp, Scale, AlertTriangle, GitCompare } from 'lucide-react';
import { CHAT_SKILLS, type ChatSkillId } from '@/lib/chat-skills';
import { useApp } from '@/contexts/AppContext';

const ICONS = { 'deep-analysis': FileSearch, 'citation-trace': BookOpen, 'data-extract': TrendingUp,
  'method-review': Scale, 'risk-assess': AlertTriangle, synthesis: GitCompare } satisfies Record<ChatSkillId, typeof FileSearch>;

export function StudioSkillsTools() {
  const [open, setOpen] = useState(false);
  const { selectedChatSkills, toggleChatSkill } = useApp();
  return (
    <section className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] p-3" data-testid="studio-skills-tools">
      <button type="button" aria-expanded={open} aria-controls="studio-skills-list" onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-2 text-left text-xs font-semibold">
        <Settings className="h-3.5 w-3.5" />技能与工具
        <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">{selectedChatSkills.length ? `${selectedChatSkills.length} 已选` : '展开'}</span>
      </button>
      {open && <div id="studio-skills-list" className="mt-3 grid grid-cols-2 gap-2">
        {CHAT_SKILLS.map(skill => {
          const Icon = ICONS[skill.id];
          const selected = selectedChatSkills.includes(skill.id);
          return <button key={skill.id} type="button" aria-pressed={selected} title={skill.description} onClick={() => toggleChatSkill(skill.id)} className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-left text-[11px] ${selected ? 'border-blue-400/50 bg-blue-500/10 text-blue-600' : 'border-[var(--glass-border)] text-[var(--text-secondary)]'}`}><Icon className="h-3.5 w-3.5 shrink-0" />{skill.label}</button>;
        })}
        <p className="col-span-2 pt-2 text-[10px] text-[var(--text-tertiary)]">用于当前文献本的下一次学术对话；选择技能不会自动生成内容。</p>
      </div>}
    </section>
  );
}
