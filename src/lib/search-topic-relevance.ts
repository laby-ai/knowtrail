/** Deterministic relevance gate; lexical evidence, not an AI confidence score. */
const STOP = new Set('a an and are as at by for from how in is of on or that the this to what when where why with about research researches study studies paper papers article articles find search please 方法 机制 应用 研究 技术 现状 综述 文献 论文 搜索 检索 查找 关于 有关 相关 请 帮 我 帮我 一下 的 与 和 在 对 是 有'.split(' '));
const ALIASES: string[][] = [
  ['图神经网络', 'graph neural network', 'graph neural networks', 'gnn', 'gnns'],
  ['大语言模型', 'large language model', 'large language models', 'llm', 'llms'],
  ['机器学习', 'machine learning'], ['人工智能', 'artificial intelligence', 'ai'],
  ['深度学习', 'deep learning'], ['神经网络', 'neural network', 'neural networks'],
  ['多模态', 'multimodal', 'multi modal'],
  ['大模型', 'foundation model', 'foundation models', 'large model', 'large models'],
  ['评测', 'evaluation', 'evaluations', 'evaluate', 'assessment', 'assessments'],
  ['量子', 'quantum'], ['传感器', 'sensor', 'sensors'], ['校准', '标定', 'calibration', 'calibrate'],
  ['肿瘤', 'tumor', 'tumors', 'tumour', 'tumours'], ['癌症', 'cancer', 'cancers'],
  ['免疫治疗', 'immunotherapy', 'immunotherapies'],
  ['临床试验', 'clinical trial', 'clinical trials'],
  ['细胞', 'cell', 'cells'], ['数据集', 'dataset', 'datasets'],
];

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function contains(text: string, term: string): boolean {
  if (/\p{Script=Han}/u.test(term)) return text.includes(term);
  return (` ${text} `).includes(` ${term} `);
}

export interface TopicGroup { label: string; alternatives: string[] }

export function queryTopics(query: string): TopicGroup[] {
  // Provider-specific Boolean/field syntax must retain its original semantics.
  if (/\b(?:AND|OR|NOT)\b|["()[\]]/.test(query) || /(?:^|\s)(?:ti|au|author|title):|\bor\b/i.test(query)) return [];
  let text = normalize(query);
  const groups: TopicGroup[] = [];
  // Long phrases are consumed first, so "graph neural network" remains one concept.
  const aliases = ALIASES.flatMap((alternatives, index) => alternatives.map(term => ({ term: normalize(term), index }))).sort((a, b) => b.term.length - a.term.length);
  const consumed = new Set<number>();
  for (const { term, index } of aliases) {
    if (!contains(text, term)) continue;
    if (!consumed.has(index)) groups.push({ label: term, alternatives: ALIASES[index].map(normalize) });
    consumed.add(index);
    if (/\p{Script=Han}/u.test(term)) text = text.split(term).join(' ');
    else text = (` ${text} `).split(` ${term} `).join(' ').trim();
  }
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (!isWordLike || STOP.has(segment) || (!/\p{Script=Han}/u.test(segment) && segment.length < 2)) continue;
    if (!groups.some(group => group.label === segment)) groups.push({ label: segment, alternatives: [segment] });
  }
  return groups;
}

export function assessSearchTopics(query: string, evidence: string, groups = queryTopics(query)) {
  const text = normalize(evidence);
  const matched = groups.filter(group => group.alternatives.some(term => contains(text, term))).map(group => group.label);
  const missing = groups.filter(group => !matched.includes(group.label)).map(group => group.label);
  return { matched, missing, coverage: groups.length ? matched.length / groups.length : 0, accepted: groups.length === 0 || missing.length === 0 };
}
