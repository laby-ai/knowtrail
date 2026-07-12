import process from 'node:process';

const node = process.execPath;
const step = (id, script, options = {}) => ({
  id,
  command: node,
  args: [script],
  timeoutMs: options.timeoutMs,
  env: options.env,
});

export const KNOWTRAIL_QUALITY_MATRIX = [
  {
    id: 'paper-search',
    name: '论文检索',
    category: '文献证据',
    exclusiveResource: 'next-dev-worktree',
    steps: [
      step('ui', 'scripts/smoke-paper-search-ui.mjs', { timeoutMs: 240_000 }),
      step('production', 'scripts/smoke-live-paper-search-provider.mjs', { timeoutMs: 90_000 }),
    ],
  },
  {
    id: 'deep-research',
    name: '深度研究',
    category: '文献证据',
    exclusiveResource: 'next-dev-worktree',
    steps: [
      step('ui', 'scripts/smoke-deep-research-ui.mjs', { timeoutMs: 240_000 }),
      step('production-gate', 'scripts/smoke-live-deep-research.mjs', { timeoutMs: 60_000 }),
    ],
  },
  {
    id: 'research-map',
    name: '研究脉络',
    category: '文献证据',
    exclusiveResource: 'next-dev-worktree',
    steps: [
      step('ui', 'scripts/smoke-knowledge-map-ui.mjs', { timeoutMs: 240_000 }),
      step('production-gate', 'scripts/smoke-live-knowledge-map.mjs', { timeoutMs: 60_000 }),
    ],
  },
  {
    id: 'hypothesis-generation',
    name: '假设生成',
    category: '研究构思',
    exclusiveResource: 'next-dev-worktree',
    steps: [
      step('ui', 'scripts/smoke-hypothesis-generation-ui.mjs', { timeoutMs: 240_000 }),
      step('production-gate', 'scripts/smoke-live-hypothesis-generation.mjs', { timeoutMs: 60_000 }),
    ],
  },
  {
    id: 'data-processing',
    name: '数据处理',
    category: '研究构思',
    exclusiveResource: 'next-dev-worktree',
    steps: [
      step('ui', 'scripts/smoke-data-processing-ui.mjs', { timeoutMs: 240_000 }),
      step('production-gate', 'scripts/smoke-live-data-processing.mjs', { timeoutMs: 60_000 }),
    ],
  },
  {
    id: 'experiment-design',
    name: '实验设计',
    category: '研究构思',
    exclusiveResource: 'next-dev-worktree',
    steps: [step('ui', 'scripts/smoke-experiment-design-ui.mjs', { timeoutMs: 240_000 })],
  },
  {
    id: 'academic-writing',
    name: '学术写作',
    category: '成果表达',
    exclusiveResource: 'next-dev-worktree',
    steps: [step('ui', 'scripts/smoke-academic-writing-ui.mjs', { timeoutMs: 240_000 })],
  },
  {
    id: 'text-polishing',
    name: '文本润色',
    category: '成果表达',
    exclusiveResource: 'next-dev-worktree',
    steps: [step('ui', 'scripts/smoke-text-polishing-ui.mjs', { timeoutMs: 240_000 })],
  },
  {
    id: 'scientific-illustration',
    name: '科研绘图',
    category: '成果表达',
    exclusiveResource: 'next-dev-worktree',
    steps: [step('ui', 'scripts/smoke-scientific-illustration-ui.mjs', { timeoutMs: 300_000 })],
  },
  {
    id: 'ppt',
    name: 'PPT 制作',
    category: '成果表达',
    exclusiveResource: 'next-dev-worktree',
    steps: [step('ui-and-files', 'scripts/smoke-workbench-studio-ui.mjs', { timeoutMs: 300_000 })],
  },
  {
    id: 'peer-review',
    name: '论文审查',
    category: '协作沉淀',
    exclusiveResource: 'next-dev-worktree',
    steps: [step('ui', 'scripts/smoke-peer-review-ui.mjs', { timeoutMs: 240_000 })],
  },
  {
    id: 'virtual-classroom',
    name: '虚拟课堂',
    category: '协作沉淀',
    exclusiveResource: 'next-dev-worktree',
    steps: [step('production-browser', 'scripts/smoke-live-virtual-classroom.mjs', { timeoutMs: 180_000 })],
  },
];
