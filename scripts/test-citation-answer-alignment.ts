import assert from 'node:assert/strict';
import { alignCitationsToAnswerMarkers } from '../src/lib/citation-answer-alignment';

const feedback = {
  paperId: 'feedback',
  paperShortName: '用户反馈 2026',
  sourceTitle: '用户反馈摘录',
  excerpt: '用户反馈需要按场景、问题、影响程度和期望结果整理。',
};
const ideas = {
  paperId: 'ideas',
  paperShortName: '需求池 2026',
  sourceTitle: '灵感与需求池',
  excerpt: '需求池应分开管理灵感、证据、待验证假设和决策。',
};

const legacyAnswer = [
  '**用户反馈组织：**',
  '- 按场景、问题、影响程度和期望结果整理[1]。',
  '- 保留原始片段，确保产品判断回到用户真实表达[1]。',
  '',
  '**需求池组织：**',
  '- 将灵感、证据、待验证假设和决策分开管理[2]。',
].join('\n');

assert.deepEqual(
  alignCitationsToAnswerMarkers(legacyAnswer, [ideas, feedback]).map(item => item.paperId),
  ['feedback', 'ideas'],
  'Legacy citations should follow the source meaning attached to [1] and [2].',
);

assert.deepEqual(
  alignCitationsToAnswerMarkers(legacyAnswer, [feedback, ideas]).map(item => item.paperId),
  ['feedback', 'ideas'],
  'Already aligned citations must stay stable.',
);

assert.deepEqual(
  alignCitationsToAnswerMarkers('资料显示两种组织方式都值得保留[1][2]。', [ideas, feedback]),
  [ideas, feedback],
  'Ambiguous prose must not trigger a guessed reorder.',
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'legacy citation cards align with explicit source meaning in answer markers',
    'already aligned and ambiguous answers remain stable',
  ],
}));
