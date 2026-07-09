import type { Paper } from '@/types';

export type SourceMatrixFacetKey = 'method' | 'data' | 'result' | 'limitation';

export interface SourceMatrixFacet {
  key: SourceMatrixFacetKey;
  label: string;
  emptyHint: string;
  excerpt: string;
  evidenceLabel: string;
  extracted: boolean;
}

const FACET_CONFIG: Array<{
  key: SourceMatrixFacetKey;
  label: string;
  emptyHint: string;
  patterns: RegExp[];
}> = [
  {
    key: 'method',
    label: '方法',
    emptyHint: '未在已入库片段中识别到明确方法线索',
    patterns: [
      /方法|实验设计|研究设计|模型|框架|算法|流程|采用|构建|训练|测量|评估|回归|访谈|问卷|对照|随机|method|methods|approach|framework|algorithm|model|training|evaluation|experiment|design|regression|survey|interview/i,
    ],
  },
  {
    key: 'data',
    label: '数据',
    emptyHint: '未在已入库片段中识别到明确数据或样本线索',
    patterns: [
      /数据|样本|队列|受试|参与者|病例|数据集|资料来源|观测|采集|n\s*=|dataset|data set|sample|cohort|participant|patient|subjects|records|observations|collected/i,
    ],
  },
  {
    key: 'result',
    label: '结果',
    emptyHint: '未在已入库片段中识别到明确结果线索',
    patterns: [
      /结果|发现|表明|显示|证明|提升|降低|显著|相关|影响|结论|result|results|finding|findings|show|shows|showed|demonstrate|improve|reduced|significant|conclusion/i,
    ],
  },
  {
    key: 'limitation',
    label: '局限',
    emptyHint: '未在已入库片段中识别到明确局限性线索',
    patterns: [
      /局限|限制|不足|偏差|风险|未来工作|仍需|尚未|不能|无法|可能|limitation|limitations|limited|bias|risk|future work|further research|cannot|may not/i,
    ],
  },
];

function normalizeText(text?: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function splitEvidenceSentences(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[。！？；;.!?])\s+|[\r\n]+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  if (sentences.length > 0) return sentences;

  return Array.from(
    { length: Math.ceil(normalized.length / 180) },
    (_, index) => normalized.slice(index * 180, index * 180 + 180).trim(),
  ).filter(Boolean);
}

function trimExcerpt(text: string, maxLength = 120): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function sourceTextForMatrix(paper: Paper): string {
  return [
    paper.title,
    paper.abstract,
    paper.rawContent,
    paper.content,
    paper.keywords?.join(' '),
  ].filter(Boolean).join('\n');
}

function findFacetExcerpt(sentences: string[], patterns: RegExp[]): string {
  const matched = sentences.find(sentence => patterns.some(pattern => pattern.test(sentence)));
  return matched ? trimExcerpt(matched) : '';
}

export function buildSourceMatrixFacets(paper: Paper): SourceMatrixFacet[] {
  const sentences = splitEvidenceSentences(sourceTextForMatrix(paper));

  return FACET_CONFIG.map(config => {
    const excerpt = findFacetExcerpt(sentences, config.patterns);
    return {
      key: config.key,
      label: config.label,
      emptyHint: config.emptyHint,
      excerpt,
      evidenceLabel: excerpt ? '自动线索' : '待补证据',
      extracted: Boolean(excerpt),
    };
  });
}
