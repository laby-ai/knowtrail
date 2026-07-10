export type PolishingScene = 'paper' | 'proposal' | 'presentation';
export type PolishingChangeCategory = 'structure' | 'flow' | 'clarity' | 'tone' | 'grammar';

export interface TextProtectionSnapshot {
  items: string[];
}

export interface TextPolishingResult {
  revisedText: string;
  changes: Array<{
    original: string;
    revised: string;
    reason: string;
    category: PolishingChangeCategory;
  }>;
  remainingRisks: string[];
}

export interface TextPolishingAudit {
  safe: boolean;
  missingProtectedItems: string[];
  strengthenedClaims: string[];
}

function unique(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(item => item.length >= 2))]
    .sort((a, b) => b.length - a.length);
}

export function buildTextProtection(sourceText: string, protectedTerms: string[] = []): TextProtectionSnapshot {
  const patterns = [
    /\bp\s*[<=>]\s*0?\.\d+\b/gi,
    /(?<![\w.])\d+(?:\.\d+)?\s*%/g,
    /\[(?:\d+(?:\s*[-,，]\s*\d+)*)\]/g,
    /(?:图|表)\s*\d+[A-Za-z]?|(?:Fig(?:ure)?\.?|Table)\s*\d+[A-Za-z]?/gi,
    /(?<![\w.])\d+(?:\.\d+)?\s*(?:mg|kg|g|μg|ug|mL|L|mm|cm|m|km|Hz|kHz|MHz|GHz|°C|K|h|min|s|ms)\b/gi,
  ];
  const detected = patterns.flatMap(pattern => sourceText.match(pattern) || []);
  return { items: unique([...protectedTerms, ...detected]) };
}

export function buildTextPolishingPrompt(input: {
  sourceText: string;
  goal: string;
  scene: PolishingScene;
  protection: TextProtectionSnapshot;
}): string {
  return `请对下面的科研文本做最小修改的专业润色。

场景：${input.scene}
润色目标：${input.goal.trim() || '减少模板腔并改善可读性。'}

硬性规则：
- 默认少动、最小修改。先调整论证顺序和句间关系，再处理确实影响理解的句子。
- 必须原样保留数字、单位、术语、引用和图表编号。保护项：${input.protection.items.join('、') || '未自动检测到；仍不得改写原文事实。'}
- 不得改变事实、结论方向、证据强度或不确定性；不得把相关性写成因果，不得新增“证明、导致、显著、首次、机制已揭示”等强主张。
- 不得补造引用、数据、统计检验、作者观点、期刊格式或投稿状态。
- 每项修改必须给出原片段、修订片段、原因和类别；没有必要修改的内容应保留。

只输出一个 JSON 对象，不要输出 Markdown 围栏或额外说明：
{
  "revisedText": "完整修订文本",
  "changes": [{ "original": "原片段", "revised": "修订片段", "reason": "为何必须改", "category": "structure|flow|clarity|tone|grammar" }],
  "remainingRisks": ["仍需作者确认的事实或证据边界"]
}

原文：
${input.sourceText.trim()}`;
}

function textValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length < 2) throw new Error(`文本润色结构不完整：缺少 ${field}。`);
  return value.trim();
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`文本润色结构不完整：${field} 必须是对象。`);
  return value as Record<string, unknown>;
}

export function parseTextPolishingOutput(raw: string): TextPolishingResult {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('文本润色结构不完整：未找到 JSON 对象。');
  let parsed: Record<string, unknown>;
  try {
    parsed = objectValue(JSON.parse(trimmed.slice(start, end + 1)), 'result');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('文本润色')) throw error;
    throw new Error('文本润色结构不完整：JSON 无法解析。');
  }
  if (!Array.isArray(parsed.changes)) throw new Error('文本润色结构不完整：changes 必须是数组。');
  const categories: PolishingChangeCategory[] = ['structure', 'flow', 'clarity', 'tone', 'grammar'];
  const changes = parsed.changes.map((item, index) => {
    const value = objectValue(item, `changes[${index}]`);
    if (!categories.includes(value.category as PolishingChangeCategory)) throw new Error(`文本润色结构不完整：changes[${index}].category 无效。`);
    return {
      original: textValue(value.original, `changes[${index}].original`),
      revised: textValue(value.revised, `changes[${index}].revised`),
      reason: textValue(value.reason, `changes[${index}].reason`),
      category: value.category as PolishingChangeCategory,
    };
  });
  if (!Array.isArray(parsed.remainingRisks)) throw new Error('文本润色结构不完整：remainingRisks 必须是数组。');
  return {
    revisedText: textValue(parsed.revisedText, 'revisedText'),
    changes,
    remainingRisks: parsed.remainingRisks.map((item, index) => textValue(item, `remainingRisks[${index}]`)),
  };
}

export function auditTextPolishing(
  sourceText: string,
  result: TextPolishingResult,
  protection: TextProtectionSnapshot,
): TextPolishingAudit {
  const missingProtectedItems = protection.items.filter(item => !result.revisedText.includes(item));
  const strongPatterns = [
    /证明(?:了|其|该|直接)/g,
    /显著(?:提升|增加|降低|改善|差异)/g,
    /(?:直接)?导致/g,
    /直接调控/g,
    /机制已揭示/g,
    /首次(?:证明|发现|揭示)/g,
  ];
  const strengthenedClaims = unique(strongPatterns.flatMap(pattern => {
    const revised = result.revisedText.match(pattern) || [];
    return revised.filter(item => !sourceText.includes(item));
  }));
  return {
    safe: missingProtectedItems.length === 0 && strengthenedClaims.length === 0,
    missingProtectedItems,
    strengthenedClaims,
  };
}

export function buildPolishingMarkdown(
  sourceText: string,
  result: TextPolishingResult,
  audit: TextPolishingAudit,
): string {
  return `# 科研文本润色记录

> 本记录只说明表达修改，不代表事实、引用、统计结果或投稿状态已经核验。

## 原文

${sourceText.trim()}

## 修订文

${result.revisedText}

## 修改说明

${result.changes.length ? result.changes.map((item, index) => `${index + 1}. **${item.category}**：${item.original} → ${item.revised}\n   - ${item.reason}`).join('\n') : '- 未做实质修改。'}

## 保护项检查

- 状态：${audit.safe ? '通过' : '未通过'}
- 丢失保护项：${audit.missingProtectedItems.join('、') || '无'}
- 新增强主张：${audit.strengthenedClaims.join('、') || '无'}

## 仍需确认

${result.remainingRisks.length ? result.remainingRisks.map(item => `- ${item}`).join('\n') : '- 请作者回读事实、术语、数字、引用和结论强度。'}
`;
}
