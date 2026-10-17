export type ResearchChatSkillId =
  | 'paper-search'
  | 'deep-research'
  | 'literature-review'
  | 'hypothesis-generation'
  | 'experiment-design'
  | 'academic-writing'
  | 'text-polishing'
  | 'peer-review';

export type ResearchChatSkillGroupId = 'discover' | 'reason' | 'write';

export interface ResearchChatSkill {
  id: ResearchChatSkillId;
  label: string;
  description: string;
  placeholder: string;
  groupId: ResearchChatSkillGroupId;
  mode: 'chat' | 'workspace';
  allowsEmptyPrompt?: boolean;
}

export const RESEARCH_CHAT_SKILLS = [
  {
    id: 'paper-search',
    label: '论文检索',
    description: '检索、核验并把结果加入当前文献库',
    placeholder: '输入主题、作者、题目或关键词',
    groupId: 'discover',
    mode: 'workspace',
  },
  {
    id: 'deep-research',
    label: '深度研究',
    description: '基于已选来源生成可追溯的系统研究报告',
    placeholder: '输入研究问题、范围和希望重点核验的方向',
    groupId: 'discover',
    mode: 'workspace',
  },
  {
    id: 'literature-review',
    label: '文献综述',
    description: '综合当前来源，梳理论点、分歧与研究缺口',
    placeholder: '可选：说明综述重点、结构或目标读者',
    groupId: 'discover',
    mode: 'chat',
    allowsEmptyPrompt: true,
  },
  {
    id: 'hypothesis-generation',
    label: '假设生成',
    description: '基于现有证据形成反例与可证伪预测',
    placeholder: '输入需要解释或验证的研究问题',
    groupId: 'reason',
    mode: 'workspace',
  },
  {
    id: 'experiment-design',
    label: '实验设计',
    description: '组织对照、随机化、主要结局与预注册方案',
    placeholder: '输入研究问题、假设和实验约束',
    groupId: 'reason',
    mode: 'workspace',
  },
  {
    id: 'academic-writing',
    label: '学术写作',
    description: '基于证据撰写引言、相关工作或讨论',
    placeholder: '说明要写的章节、核心问题和篇幅要求',
    groupId: 'write',
    mode: 'chat',
  },
  {
    id: 'text-polishing',
    label: '文本润色',
    description: '保护事实与引用，改善表达并解释修改',
    placeholder: '粘贴待润色文字，并说明语言、风格或篇幅要求',
    groupId: 'write',
    mode: 'chat',
  },
  {
    id: 'peer-review',
    label: '论文审查',
    description: '定位论证、方法与证据问题，给出可执行建议',
    placeholder: '说明审查范围、关注重点或目标期刊要求',
    groupId: 'write',
    mode: 'chat',
  },
] as const satisfies readonly ResearchChatSkill[];

export const RESEARCH_CHAT_SKILL_GROUPS = [
  { id: 'discover', label: '找资料与理解' },
  { id: 'reason', label: '研究推理' },
  { id: 'write', label: '写作与审查' },
] as const satisfies readonly { id: ResearchChatSkillGroupId; label: string }[];

const RESEARCH_CHAT_SKILL_IDS = new Set<ResearchChatSkillId>(
  RESEARCH_CHAT_SKILLS.map(skill => skill.id),
);

export function isResearchChatSkillId(value: unknown): value is ResearchChatSkillId {
  return typeof value === 'string' && RESEARCH_CHAT_SKILL_IDS.has(value as ResearchChatSkillId);
}

export function getResearchChatSkill(skillId: ResearchChatSkillId | null): ResearchChatSkill | null {
  return RESEARCH_CHAT_SKILLS.find(skill => skill.id === skillId) ?? null;
}

export function isWorkspaceResearchChatSkillId(skillId: ResearchChatSkillId | null): boolean {
  return getResearchChatSkill(skillId)?.mode === 'workspace';
}
