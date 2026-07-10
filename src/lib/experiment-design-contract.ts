export type ExperimentDesignStatus = 'complete' | 'incomplete' | 'no-evidence';
export type ExperimentStudyMode = 'confirmatory' | 'exploratory';

export interface ExperimentArm {
  name: string;
  role: 'treatment' | 'control' | 'comparator';
  intervention: string;
}

export interface ExperimentDesignProtocol {
  title: string;
  studyMode: ExperimentStudyMode;
  designType: string;
  designRationale: string;
  researchQuestion: string;
  hypothesis: string;
  experimentalUnit: string;
  replicationLevel: string;
  arms: ExperimentArm[];
  primaryOutcome: {
    name: string;
    timing: string;
    measurement: string;
  };
  secondaryOutcomes: string[];
  randomization: {
    method: string;
    unit: string;
    seedPlan: string;
    allocationConcealment: string;
  };
  blockingAndBlinding: string[];
  confounders: Array<{ factor: string; control: string }>;
  sampleSizePlan: {
    effectBasis: string;
    testFamily: string;
    assumptions: string;
    nextAction: string;
  };
  dataCollectionPlan: string[];
  analysisPlan: string[];
  stoppingRules: string[];
  exclusionRules: string[];
  ethicsAndFeasibility: string;
  evidenceMarkers: number[];
  limitations: string[];
}

export interface ExperimentDesignPromptInput {
  question: string;
  hypothesis: string;
  experimentalUnit: string;
  arms: string[];
  primaryOutcome: string;
  constraints: string;
  alpha: number;
  targetPower: number;
  sourceCount: number;
  evidenceContext: string;
}

export function buildExperimentDesignPrompt(input: ExperimentDesignPromptInput): string {
  return `请把下面的研究问题和假设整理成一份采集前实验设计协议。

研究问题：${input.question.trim()}
待验证假设：${input.hypothesis.trim()}
独立实验单位：${input.experimentalUnit.trim()}
处理/对照臂：${input.arms.join('、')}
主要结局：${input.primaryOutcome.trim()}
现实约束：${input.constraints.trim() || '尚未提供，请列为待确认项。'}
预设 alpha=${input.alpha}，目标 power=${input.targetPower}。

证据和质量边界：
- 只能基于当前 ${input.sourceCount} 个已选来源及下方证据片段，引用线索不等于全文已核验。
- 只做采集前设计和预注册计划，不执行实验、统计检验、数据分析或伦理审批。
- 不得根据通用经验拍脑袋给出样本量数字或“所需 N”；效应量必须来自文献、预实验或最小实际意义效应。证据不足时明确写“待执行功效计算”。
- 必须区分独立重复与重复测量，避免伪重复；随机化、区组、盲法和分析层级必须匹配实验单位。
- 不得声称伦理审批已通过、实验已完成、统计显著、因果已证实或样本量已经充分。

只输出一个 JSON 对象，不要输出 Markdown 代码围栏或额外说明。结构必须严格为：
{
  "title": "协议标题",
  "studyMode": "confirmatory 或 exploratory",
  "designType": "完全随机/随机区组/析因/交叉/重复测量/整群等",
  "designRationale": "设计选择依据，使用[1]等证据编号",
  "researchQuestion": "研究问题",
  "hypothesis": "可证伪假设",
  "experimentalUnit": "真正被随机化的独立单位",
  "replicationLevel": "独立重复层级与伪重复边界",
  "arms": [{ "name": "组名", "role": "treatment|control|comparator", "intervention": "处理或对照定义" }],
  "primaryOutcome": { "name": "唯一主要结局", "timing": "测量时间", "measurement": "操作化定义" },
  "secondaryOutcomes": ["次要结局"],
  "randomization": { "method": "方法", "unit": "随机化单位", "seedPlan": "seed 生成与归档计划", "allocationConcealment": "分配隐藏" },
  "blockingAndBlinding": ["区组、分层、运行顺序或盲法措施"],
  "confounders": [{ "factor": "干扰因素", "control": "控制方式" }],
  "sampleSizePlan": { "effectBasis": "效应量依据或缺口", "testFamily": "待用检验/模型家族", "assumptions": "alpha/power/聚类/脱落假设", "nextAction": "确定性功效计算和归档步骤" },
  "dataCollectionPlan": ["数据采集与质控步骤"],
  "analysisPlan": ["与设计匹配的采集前分析计划"],
  "stoppingRules": ["固定 N 或预先定义的停止规则"],
  "exclusionRules": ["采集前排除规则"],
  "ethicsAndFeasibility": "伦理与可行性待办，不得写成已审批",
  "evidenceMarkers": [1],
  "limitations": ["证据和设计限制"]
}

要求：
- 至少包含两个组，其中至少一个 treatment 和一个 control/comparator。
- primaryOutcome 必须唯一明确；secondaryOutcomes 不得冒充主要结局。
- 样本量计划只能写依据、假设、计算方法和下一步，不允许返回 requiredN、sampleSize 或任何模型猜测的 N。
- 每个关键设计判断至少能由 evidenceMarkers 中一个有效编号追溯；证据不足处写入 limitations。

证据片段：
${input.evidenceContext}`;
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('实验设计结构不完整：未找到 JSON 对象。');
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new Error('实验设计结构不完整：JSON 无法解析。');
  }
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`实验设计结构不完整：${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length < 2) {
    throw new Error(`实验设计结构不完整：缺少 ${field}。`);
  }
  return value.trim();
}

function textList(value: unknown, field: string, allowEmpty = false): string[] {
  if (!Array.isArray(value)) throw new Error(`实验设计结构不完整：${field} 必须是数组。`);
  const items = value.map((item, index) => textValue(item, `${field}[${index}]`));
  if (!allowEmpty && items.length === 0) throw new Error(`实验设计结构不完整：${field} 不能为空。`);
  return items;
}

export function parseExperimentDesignOutput(raw: string): ExperimentDesignProtocol {
  const parsed = objectValue(parseJsonObject(raw), 'protocol');
  const studyMode = parsed.studyMode;
  if (studyMode !== 'confirmatory' && studyMode !== 'exploratory') {
    throw new Error('实验设计结构不完整：studyMode 必须是 confirmatory 或 exploratory。');
  }

  if (!Array.isArray(parsed.arms) || parsed.arms.length < 2) {
    throw new Error('实验设计结构不完整：至少需要两个处理或对照臂。');
  }
  const arms = parsed.arms.map((value, index): ExperimentArm => {
    const arm = objectValue(value, `arms[${index}]`);
    if (arm.role !== 'treatment' && arm.role !== 'control' && arm.role !== 'comparator') {
      throw new Error(`实验设计结构不完整：arms[${index}].role 无效。`);
    }
    return {
      name: textValue(arm.name, `arms[${index}].name`),
      role: arm.role,
      intervention: textValue(arm.intervention, `arms[${index}].intervention`),
    };
  });
  if (!arms.some(arm => arm.role === 'treatment') || !arms.some(arm => arm.role !== 'treatment')) {
    throw new Error('实验设计结构不完整：需要 treatment 与 control/comparator。');
  }

  const primaryOutcome = objectValue(parsed.primaryOutcome, 'primaryOutcome');
  const randomization = objectValue(parsed.randomization, 'randomization');
  const sampleSizePlan = objectValue(parsed.sampleSizePlan, 'sampleSizePlan');
  const normalizedSampleSizePlan = {
    effectBasis: textValue(sampleSizePlan.effectBasis, 'sampleSizePlan.effectBasis'),
    testFamily: textValue(sampleSizePlan.testFamily, 'sampleSizePlan.testFamily'),
    assumptions: textValue(sampleSizePlan.assumptions, 'sampleSizePlan.assumptions'),
    nextAction: textValue(sampleSizePlan.nextAction, 'sampleSizePlan.nextAction'),
  };
  const guessedSampleSizePattern = /(?:所需|需要|建议|每组|总计|总样本量|样本量(?:为|=))\s*(?:N\s*=?\s*)?\d+|(?:^|[^a-z])N\s*=\s*\d+/i;
  if (guessedSampleSizePattern.test(Object.values(normalizedSampleSizePlan).join(' '))) {
    throw new Error('实验设计结构不完整：样本量数字必须来自确定性功效计算，不得由模型猜测 N。');
  }
  const confounders = Array.isArray(parsed.confounders)
    ? parsed.confounders.map((value, index) => {
        const item = objectValue(value, `confounders[${index}]`);
        return {
          factor: textValue(item.factor, `confounders[${index}].factor`),
          control: textValue(item.control, `confounders[${index}].control`),
        };
      })
    : [];
  if (confounders.length === 0) throw new Error('实验设计结构不完整：至少需要一个混杂或干扰因素。');

  const evidenceMarkers = Array.isArray(parsed.evidenceMarkers)
    ? [...new Set(parsed.evidenceMarkers.filter(value => Number.isInteger(value) && Number(value) > 0).map(Number))]
    : [];
  if (evidenceMarkers.length === 0) throw new Error('实验设计结构不完整：缺少 evidenceMarkers。');

  return {
    title: textValue(parsed.title, 'title'),
    studyMode,
    designType: textValue(parsed.designType, 'designType'),
    designRationale: textValue(parsed.designRationale, 'designRationale'),
    researchQuestion: textValue(parsed.researchQuestion, 'researchQuestion'),
    hypothesis: textValue(parsed.hypothesis, 'hypothesis'),
    experimentalUnit: textValue(parsed.experimentalUnit, 'experimentalUnit'),
    replicationLevel: textValue(parsed.replicationLevel, 'replicationLevel'),
    arms,
    primaryOutcome: {
      name: textValue(primaryOutcome.name, 'primaryOutcome.name'),
      timing: textValue(primaryOutcome.timing, 'primaryOutcome.timing'),
      measurement: textValue(primaryOutcome.measurement, 'primaryOutcome.measurement'),
    },
    secondaryOutcomes: textList(parsed.secondaryOutcomes, 'secondaryOutcomes', true),
    randomization: {
      method: textValue(randomization.method, 'randomization.method'),
      unit: textValue(randomization.unit, 'randomization.unit'),
      seedPlan: textValue(randomization.seedPlan, 'randomization.seedPlan'),
      allocationConcealment: textValue(randomization.allocationConcealment, 'randomization.allocationConcealment'),
    },
    blockingAndBlinding: textList(parsed.blockingAndBlinding, 'blockingAndBlinding'),
    confounders,
    sampleSizePlan: normalizedSampleSizePlan,
    dataCollectionPlan: textList(parsed.dataCollectionPlan, 'dataCollectionPlan'),
    analysisPlan: textList(parsed.analysisPlan, 'analysisPlan'),
    stoppingRules: textList(parsed.stoppingRules, 'stoppingRules'),
    exclusionRules: textList(parsed.exclusionRules, 'exclusionRules'),
    ethicsAndFeasibility: textValue(parsed.ethicsAndFeasibility, 'ethicsAndFeasibility'),
    evidenceMarkers,
    limitations: textList(parsed.limitations, 'limitations'),
  };
}

export function classifyExperimentDesign(input: {
  protocol: ExperimentDesignProtocol;
  citationCount: number;
}): ExperimentDesignStatus {
  if (input.citationCount === 0) return 'no-evidence';
  if (!input.protocol.evidenceMarkers.some(marker => marker >= 1 && marker <= input.citationCount)) return 'no-evidence';
  if (input.protocol.evidenceMarkers.some(marker => marker < 1 || marker > input.citationCount)) return 'incomplete';
  return 'complete';
}

export function hasSubstantiveExperimentEvidence(
  citations: Array<{ excerpt?: string; snippet?: string }>,
): boolean {
  return citations.some(citation => {
    const text = (citation.excerpt || citation.snippet || '').replace(/\s+/g, ' ').trim();
    return text.length >= 40;
  });
}

function bullets(items: string[]): string {
  return items.map(item => `- ${item}`).join('\n');
}

export function buildPreregistrationMarkdown(
  protocol: ExperimentDesignProtocol,
  planning: { alpha: number; targetPower: number },
): string {
  return `# ${protocol.title}

## 1. 背景与假设
- 研究模式：${protocol.studyMode === 'confirmatory' ? '验证性' : '探索性'}
- 研究问题：${protocol.researchQuestion}
- 待验证假设：${protocol.hypothesis}
- 设计类型：${protocol.designType}
- 设计依据：${protocol.designRationale}

## 2. 设计与独立重复
- 独立实验单位：${protocol.experimentalUnit}
- 独立重复层级：${protocol.replicationLevel}
- 处理与对照：
${protocol.arms.map(arm => `  - ${arm.name}（${arm.role}）：${arm.intervention}`).join('\n')}
- 主要结局：${protocol.primaryOutcome.name}；${protocol.primaryOutcome.timing}；${protocol.primaryOutcome.measurement}
- 次要结局：${protocol.secondaryOutcomes.join('、') || '无'}

## 3. 随机化、区组与盲法
- 随机化方法：${protocol.randomization.method}
- 随机化单位：${protocol.randomization.unit}
- Seed 与归档：${protocol.randomization.seedPlan}
- 分配隐藏：${protocol.randomization.allocationConcealment}
${bullets(protocol.blockingAndBlinding)}

## 4. 样本量与功效
- 预设 alpha=${planning.alpha}，目标 power=${planning.targetPower}
- 效应依据：${protocol.sampleSizePlan.effectBasis}
- 计划方法：${protocol.sampleSizePlan.testFamily}
- 假设：${protocol.sampleSizePlan.assumptions}
- 下一步：${protocol.sampleSizePlan.nextAction}
- 状态：未执行样本量计算；不得把本协议当作所需 N 已确定。

## 5. 数据采集与分析计划
### 数据采集
${bullets(protocol.dataCollectionPlan)}
### 分析计划
${bullets(protocol.analysisPlan)}
### 混杂控制
${protocol.confounders.map(item => `- ${item.factor}：${item.control}`).join('\n')}

## 6. 停止、排除与伦理
### 停止规则
${bullets(protocol.stoppingRules)}
### 排除规则
${bullets(protocol.exclusionRules)}
### 伦理与可行性
${protocol.ethicsAndFeasibility}

## 7. 证据与边界
- 证据编号：${protocol.evidenceMarkers.map(marker => `[${marker}]`).join('、')}
${bullets(protocol.limitations)}
- 本协议仅用于采集前设计与预注册，不代表伦理审批、实验执行、统计分析或因果结论已经完成。
`;
}
