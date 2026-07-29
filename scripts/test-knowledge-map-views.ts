import assert from 'node:assert/strict';
import { buildCitationTrail, buildKnowledgeMapView } from '../src/lib/knowledge-map-views';
import type { KnowledgeMapData } from '../src/lib/knowledge-map-types';
import type { Citation } from '../src/types';

const map: KnowledgeMapData = {
  schemaVersion: 1,
  title: '合同论文精读视图验证',
  generatedAt: '2026-07-30T00:00:00.000Z',
  nodes: [
    {
      id: 'concept-a',
      label: '关键概念',
      type: 'concept',
      summary: '核心概念由来源一支撑。[1]',
      community: 'core',
      citationNumbers: [1],
      degree: 2,
      focal: true,
    },
    {
      id: 'method-b',
      label: '研究方法',
      type: 'method',
      summary: '研究方法由来源二支撑。[2]',
      community: 'core',
      citationNumbers: [2],
      degree: 2,
    },
    {
      id: 'source-c',
      label: '来源节点',
      type: 'source',
      summary: '来源节点用于证据追踪。[1]',
      community: 'evidence',
      citationNumbers: [1],
      degree: 1,
    },
    {
      id: 'question-d',
      label: '待研究问题',
      type: 'question',
      summary: '问题节点尚待进一步验证。',
      community: 'open',
      citationNumbers: [],
      degree: 1,
    },
  ],
  edges: [
    {
      id: 'edge-1',
      source: 'concept-a',
      target: 'method-b',
      relation: '依赖方法',
      confidence: 'EXTRACTED',
      evidence: '来源二说明概念依赖该方法。[2]',
      citationNumbers: [2],
    },
    {
      id: 'edge-2',
      source: 'source-c',
      target: 'concept-a',
      relation: '证据支撑',
      confidence: 'EXTRACTED',
      evidence: '来源一直接支撑该概念。[1]',
      citationNumbers: [1],
    },
    {
      id: 'edge-3',
      source: 'question-d',
      target: 'concept-a',
      relation: '继续追问',
      confidence: 'AMBIGUOUS',
      evidence: '问题尚无直接引用。',
      citationNumbers: [],
    },
  ],
  communities: [
    { id: 'core', label: '核心', nodeIds: ['concept-a', 'method-b'] },
    { id: 'evidence', label: '证据', nodeIds: ['source-c'] },
    { id: 'open', label: '开放问题', nodeIds: ['question-d'] },
  ],
  analysis: {
    hubNodes: [
      { id: 'concept-a', label: '关键概念', degree: 2 },
      { id: 'source-c', label: '来源节点', degree: 1 },
    ],
    bridgeEdges: [
      {
        source: 'source-c',
        target: 'concept-a',
        relation: '证据支撑',
        confidence: 'EXTRACTED',
        why: '来源连接核心概念。',
      },
    ],
    suggestedQuestions: ['关键概念还需要哪些证据？'],
  },
};

const citations: Citation[] = [
  {
    paperId: 'paper-1',
    paperShortName: '论文一',
    sourceId: 'source-1',
    chunkId: 'chunk-1',
    chunkIndex: 0,
    sourceTitle: '来源一',
    excerpt: '来源一直接说明了关键概念。',
    score: 0.94,
    page: 3,
  },
  {
    paperId: 'paper-2',
    paperShortName: '论文二',
    sourceId: 'source-2',
    chunkId: 'chunk-2',
    chunkIndex: 0,
    sourceTitle: '来源二',
    excerpt: '来源二描述了研究方法和概念关系。',
    score: 0.88,
    page: 7,
  },
];

const knowledgeView = buildKnowledgeMapView(map, 'knowledge');
assert.deepEqual(knowledgeView.nodes, map.nodes, 'knowledge view must retain the complete graph');

const conceptView = buildKnowledgeMapView(map, 'concept');
assert.deepEqual(
  conceptView.nodes.map(node => node.id),
  ['concept-a', 'method-b'],
  'concept view should keep concept-facing nodes only',
);
assert.deepEqual(
  conceptView.edges.map(edge => edge.id),
  ['edge-1'],
  'concept view must remove relationships with hidden endpoints',
);
assert.ok(
  conceptView.communities.every(community => community.nodeIds.length > 0),
  'concept view must remove empty communities',
);
assert.ok(
  conceptView.analysis.hubNodes.every(node => conceptView.nodes.some(item => item.id === node.id)),
  'concept view analysis must not reference hidden nodes',
);
const sourceFocalMap: KnowledgeMapData = {
  ...map,
  nodes: map.nodes.map(node => ({ ...node, focal: node.type === 'source' })),
};
assert.equal(
  buildKnowledgeMapView(sourceFocalMap, 'concept').nodes.filter(node => node.focal).length,
  1,
  'concept view should promote a visible focal node when the original focal source is hidden',
);

const trail = buildCitationTrail(map, citations);
assert.equal(trail.items.length, 2, 'every retrieved citation should remain auditable');
assert.deepEqual(
  trail.items[0].nodes.map(node => node.id),
  ['concept-a', 'source-c'],
  'citation one should list every node it supports',
);
assert.deepEqual(trail.items[0].edges.map(edge => edge.id), ['edge-2']);
assert.deepEqual(trail.items[1].nodes.map(node => node.id), ['method-b']);
assert.deepEqual(trail.items[1].edges.map(edge => edge.id), ['edge-1']);
assert.deepEqual(trail.uncoveredNodeIds, ['question-d'], 'unreferenced graph nodes must be reported instead of silently omitted');
assert.deepEqual(trail.uncoveredEdgeIds, ['edge-3'], 'unreferenced graph edges must be reported instead of silently omitted');

console.log(JSON.stringify({
  ok: true,
  knowledgeNodes: knowledgeView.nodes.length,
  conceptNodes: conceptView.nodes.length,
  citationRows: trail.items.length,
}, null, 2));
