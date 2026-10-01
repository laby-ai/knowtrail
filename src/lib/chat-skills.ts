export const CHAT_SKILLS = [
  { id: 'deep-analysis', label: '深度分析', description: '深入分析文献内容与逻辑', instruction: '分析研究问题、论证链与证据强度，区分事实与推断。' },
  { id: 'citation-trace', label: '引用追溯', description: '追溯引用链与证据脉络', instruction: '依据可用来源追溯主张与引用；未提供的引用链明确标为无法核验。' },
  { id: 'data-extract', label: '数据提取', description: '提取关键数据与指标', instruction: '提取可核验的关键数据、单位、样本量与指标，并标明出处；缺失值不补造。' },
  { id: 'method-review', label: '方法审查', description: '审查研究方法与实验设计', instruction: '审查实验设计、对照、统计方法和可重复性，提出具体改进建议。' },
  { id: 'risk-assess', label: '风险评估', description: '识别局限性与潜在风险', instruction: '识别偏倚、混淆因素和推广限制，说明判断的证据与不确定性。' },
  { id: 'synthesis', label: '综合分析', description: '跨文献综合对比分析', instruction: '按共同维度比较文献，区分一致结论、冲突证据与研究空白。' },
] as const;

export type ChatSkillId = typeof CHAT_SKILLS[number]['id'];

export function chatSkillInstructions(selection: unknown): string {
  if (!Array.isArray(selection)) return '';
  const selected = CHAT_SKILLS.filter(skill => selection.includes(skill.id));
  return selected.length ? '\n\n用户选择的分析方法（仍须遵守来源和引用约束）：\n'
    + selected.map(skill => `- ${skill.label}：${skill.instruction}`).join('\n') : '';
}
