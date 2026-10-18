import assert from 'node:assert/strict';
import { resolveCitationSourceId } from '../src/lib/citation-source-identity';

const papers = [
  {
    id: 'featured-product-feedback',
    title: '用户反馈摘录',
    shortName: '用户反馈 2026',
    fileName: 'product-feedback.txt',
  },
  {
    id: 'featured-product-ideas',
    title: '灵感与需求池',
    shortName: '需求池 2026',
    fileName: 'product-ideas.txt',
  },
];

assert.equal(
  resolveCitationSourceId('persisted-source-42', {
    sourceTitle: '灵感与需求池',
    paperShortName: '需求池 2026',
  }, papers),
  'featured-product-ideas',
  'A persisted citation whose source id differs from the visible card should resolve by source metadata.',
);

assert.equal(
  resolveCitationSourceId('featured-product-feedback', {
    sourceTitle: '不相关标题',
  }, papers),
  'featured-product-feedback',
  'An exact source id must remain the first choice.',
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'citation source falls back to a unique title and short-name match',
    'exact source id remains authoritative',
  ],
}));
