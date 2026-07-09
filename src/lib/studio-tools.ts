export type StudioArtifactToolId = 'interactive' | 'quiz' | 'project' | 'seminar' | 'experiment' | 'results';

export interface StudioArtifactToolDef {
  id: StudioArtifactToolId;
  label: string;
  desc: string;
  actionLabel: string;
  generationPattern: string;
  resultShape: string[];
  prompt: string;
}

export const STUDIO_ARTIFACT_TOOL_DEFS: StudioArtifactToolDef[] = [
  {
    id: 'interactive',
    label: '互动页面',
    desc: '生成可操作的互动任务',
    actionLabel: '生成互动页面',
    generationPattern: '把资料转成可点击、可选择、可反馈的互动任务，先产出页面结构、交互规则和状态说明。',
    resultShape: ['互动目标', '页面状态', '用户动作', '反馈规则', '素材清单'],
    prompt:
      '请基于我选中的资料设计一个互动页面。要求：1）明确互动目标和适用场景；2）输出页面状态、用户动作、正确反馈、错误反馈和完成条件；3）列出需要的图文素材和数据字段；4）每个关键规则都要标出资料依据；5）当前只生成可检查的互动设计稿，不要声称已经生成可运行网页。',
  },
  {
    id: 'quiz',
    label: '测验练习',
    desc: '生成题目、答案和解析',
    actionLabel: '生成测验练习',
    generationPattern: '先确定练习目标，再生成题目、标准答案、解析反馈和追问建议。',
    resultShape: ['题目', '标准答案', '解析反馈', '来源依据'],
    prompt:
      '请基于我选中的资料生成一套测验练习。要求：1）给出 6 道题，覆盖选择题、判断题、简答题；2）每题提供标准答案和解析；3）标出每题对应的资料依据或引用片段；4）最后给出我还应该追问的 3 个问题。',
  },
  {
    id: 'project',
    label: '项目研习',
    desc: '生成角色、任务和检查点',
    actionLabel: '生成项目研习',
    generationPattern: '把资料组织成项目制研习任务，包含角色、问题板、阶段任务、检查点和验收标准。',
    resultShape: ['项目目标', '角色分工', '问题板', '阶段任务', '验收标准'],
    prompt:
      '请把我选中的资料设计成一个项目研习任务。要求：1）输出项目目标、背景情境、角色分工、问题板、阶段任务、风险和验收标准；2）每个任务都要说明来源依据；3）给出适合个人工作台执行的最小行动；4）用 Markdown 分组，不要泛泛而谈。',
  },
  {
    id: 'seminar',
    label: '组会材料',
    desc: '生成汇报提纲和讨论问题',
    actionLabel: '生成组会材料',
    generationPattern: '把选中资料整理成组会前可检查的汇报草稿，先输出研究问题、证据摘要、方法/数据/结果/局限和讨论问题。',
    resultShape: ['汇报标题', '研究问题', '证据摘要', '方法/数据/结果/局限', '讨论问题', '待补证据'],
    prompt:
      '请基于我选中的资料生成一份组会材料草稿。要求：1）给出一个谨慎的汇报标题和 3 个汇报目标；2）按“研究问题、核心证据、方法/数据、主要结果、局限与待补证据、组会讨论问题”组织；3）每个关键判断都要标出资料依据或引用片段；4）明确哪些内容只是待讨论假设，不能写成已经证实的结论；5）当前只生成 Markdown 草稿，不要声称已经生成 PPT、Word、LaTeX 或投稿材料。',
  },
  {
    id: 'experiment',
    label: '实验记录',
    desc: '整理实验目的、参数和观察',
    actionLabel: '生成实验记录',
    generationPattern: '把选中资料整理成可追踪的实验记录草稿，先输出实验目的、样本/参数、观察结果、异常偏差和下一步。',
    resultShape: ['实验目的', '样本/参数', '观察结果', '异常/偏差', '下一步', '待补证据'],
    prompt:
      '请基于我选中的资料生成一份实验记录草稿。要求：1）按“实验目的、材料/样本、关键参数或步骤、观察结果、异常/偏差、下一步、待补证据”组织；2）每个实验条件、观察和结论边界都要标出资料依据或引用片段；3）把推测、未验证现象和需要补实验的部分单独列出；4）当前只生成可复核的 Markdown 实验记录，不要声称已经生成统计脚本、论文图表、自动数据分析或投稿材料。',
  },
  {
    id: 'results',
    label: 'Results 初稿',
    desc: '整理结果、证据和局限边界',
    actionLabel: '生成 Results 初稿',
    generationPattern: '把选中资料中的数据观察和引用证据整理成可追溯的 Results 文本草稿，明确结果、依据、局限和待补分析。',
    resultShape: ['结果概述', '数据/观察', '证据依据', '局限边界', '待补分析'],
    prompt:
      '请基于我选中的资料生成一份 Results 初稿。要求：1）按“结果概述、数据/观察、证据依据、局限边界、待补分析”组织；2）每个定量描述、观察和结果判断都要标出资料依据或引用片段；3）严格区分资料中已经报告的结果、当前可支持的解释和仍需补做的分析；4）不补造样本量、效应量、显著性、图表编号或统计结论；5）当前只生成可追溯的 Results 文本草稿，不要声称已经完成统计检验、论文图表生成、Word/LaTeX 导出或投稿。',
  },
];

export function getStudioArtifactTool(id: unknown): StudioArtifactToolDef | undefined {
  return STUDIO_ARTIFACT_TOOL_DEFS.find(tool => tool.id === id);
}
