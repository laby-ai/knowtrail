import {
  isResearchChatSkillId,
  type ResearchChatSkillId,
} from './research-chat-skills';

const SKILL_INSTRUCTIONS: Partial<Record<ResearchChatSkillId, string>> = {
  'academic-writing': [
    '当前任务是证据约束的学术写作。',
    '先识别用户指定的章节、论证目标和目标读者，再生成可以继续修改的正文。',
    '不要补写证据中不存在的实验、数据或结论；证据不足处明确标为待补证据。',
    '保持引用编号与证据片段一致，并在结尾简要列出建议继续修改的方向。',
  ].join('\n'),
  'text-polishing': [
    '当前任务是学术文本润色。',
    '保留原文事实、数字、专有名词、结论强度和引用编号，只改善清晰度、连贯性与学术表达。',
    '不要把不确定表述改成确定结论，也不要添加原文或证据中没有的新事实。',
    '先给出润色后的完整文本，再用简短要点解释关键修改。',
  ].join('\n'),
  'peer-review': [
    '当前任务是只读论文审查。',
    '按重要程度定位研究问题、方法、证据、结果解释和可复现性风险，并给出可执行修改建议。',
    '区分必须修改、建议修改与证据不足；不要直接替用户改写整篇稿件，也不要伪造审稿结论。',
    '每项判断尽量引用对应证据编号，最后概括最优先处理的三项问题。',
  ].join('\n'),
};

export function resolveResearchChatSkillInstruction(skill: unknown): string {
  if (!isResearchChatSkillId(skill) || skill === 'literature-review') return '';
  return SKILL_INSTRUCTIONS[skill] || '';
}
