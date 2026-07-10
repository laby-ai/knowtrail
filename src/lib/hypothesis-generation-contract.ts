export type HypothesisGenerationStatus = 'complete' | 'incomplete' | 'no-evidence';

export interface HypothesisCard {
  id: `H${number}`;
  title: string;
  statement: string;
  reasoningBasis: string;
  competingExplanation: string;
  falsifiablePrediction: string;
  validationPlan: string;
  evidenceMarkers: number[];
  uncertainty: string;
}

export interface HypothesisGenerationResult {
  hypotheses: HypothesisCard[];
}

export interface HypothesisGenerationPromptInput {
  question: string;
  evidenceContext: string;
  sourceCount: number;
}

const REQUIRED_TEXT_FIELDS = [
  'title',
  'statement',
  'reasoningBasis',
  'competingExplanation',
  'falsifiablePrediction',
  'validationPlan',
  'uncertainty',
] as const;

export function buildHypothesisGenerationPrompt(input: HypothesisGenerationPromptInput): string {
  return `请基于当前证据生成 3-5 个可区分、可证伪的研究假设。

研究问题：
${input.question.trim()}

证据边界：
- 只能基于当前已选来源及下方检索到的证据片段；当前共选择 ${input.sourceCount} 个来源。
- 引用线索是候选证据，不代表已核验全文。每个假设至少引用一个有效证据编号。
- 不得声称假设具有已证实的新颖性，不得声称因果关系、统计显著性或实验已经完成。
- 证据不足时写入 uncertainty，不得补写不存在的 DOI、引用量、期刊等级、实验结果或机制事实。

只输出一个 JSON 对象，不要输出 Markdown 代码围栏或额外说明。结构必须严格为：
{
  "hypotheses": [
    {
      "id": "H1",
      "title": "短标题",
      "statement": "可检验的假设陈述",
      "reasoningBasis": "基于证据的推理依据，并在句中使用[1]等证据编号",
      "competingExplanation": "至少一个竞争解释或反例边界",
      "falsifiablePrediction": "若假设成立/不成立分别应观察到什么",
      "validationPlan": "需要的数据、对照、指标或分析步骤；不得写成实验已执行",
      "evidenceMarkers": [1],
      "uncertainty": "当前不确定性与待补证据"
    }
  ]
}

要求：
- 假设 ID 必须从 H1 连续编号，最多 H5。
- 每个假设必须能被未来数据推翻，竞争解释不得与主假设同义复述。
- validationPlan 只描述验证路径，不得伪造真实统计检验、样本或实验结果。

证据片段：
${input.evidenceContext}`;
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('假设结构不完整：未找到 JSON 对象。');
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new Error('假设结构不完整：JSON 无法解析。');
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length < 2) {
    throw new Error(`假设结构不完整：缺少 ${field}。`);
  }
  return value.trim();
}

export function parseHypothesisGenerationOutput(raw: string): HypothesisGenerationResult {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { hypotheses?: unknown }).hypotheses)) {
    throw new Error('假设结构不完整：缺少 hypotheses。');
  }

  const sourceItems = (parsed as { hypotheses: unknown[] }).hypotheses;
  if (sourceItems.length < 3 || sourceItems.length > 5) {
    throw new Error('假设结构不完整：必须返回 3-5 个假设。');
  }

  const hypotheses = sourceItems.map((item, index): HypothesisCard => {
    if (!item || typeof item !== 'object') throw new Error(`假设结构不完整：H${index + 1} 不是对象。`);
    const record = item as Record<string, unknown>;
    const expectedId = `H${index + 1}` as `H${number}`;
    if (record.id !== expectedId) throw new Error(`假设结构不完整：ID 必须连续编号为 ${expectedId}。`);

    const evidenceMarkers = Array.isArray(record.evidenceMarkers)
      ? [...new Set(record.evidenceMarkers.filter(value => Number.isInteger(value) && Number(value) > 0).map(Number))]
      : [];
    if (evidenceMarkers.length === 0) {
      throw new Error(`假设结构不完整：${expectedId} 缺少 evidenceMarkers。`);
    }

    const text = Object.fromEntries(REQUIRED_TEXT_FIELDS.map(field => [field, requiredText(record[field], field)])) as Record<typeof REQUIRED_TEXT_FIELDS[number], string>;
    return {
      id: expectedId,
      title: text.title,
      statement: text.statement,
      reasoningBasis: text.reasoningBasis,
      competingExplanation: text.competingExplanation,
      falsifiablePrediction: text.falsifiablePrediction,
      validationPlan: text.validationPlan,
      evidenceMarkers,
      uncertainty: text.uncertainty,
    };
  });

  return { hypotheses };
}

export function classifyHypothesisGeneration(input: {
  hypothesisCount: number;
  validEvidenceMarkerCount: number;
}): HypothesisGenerationStatus {
  if (input.validEvidenceMarkerCount === 0) return 'no-evidence';
  if (input.hypothesisCount < 3 || input.hypothesisCount > 5) return 'incomplete';
  if (input.validEvidenceMarkerCount < input.hypothesisCount) return 'incomplete';
  return 'complete';
}

export function hasSubstantiveHypothesisEvidence(
  citations: Array<{ excerpt?: string; snippet?: string }>,
): boolean {
  return citations.some(citation => {
    const text = (citation.excerpt || citation.snippet || '').replace(/\s+/g, ' ').trim();
    return text.length >= 40;
  });
}
