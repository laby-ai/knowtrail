import assert from 'node:assert/strict';
import { buildFastKnowledgeMap } from '../src/lib/knowledge-map-compiler';
import type { GroundedCitation, RagSourceInput } from '../src/lib/rag';

const papers: RagSourceInput[] = [
  {
    id: 'paper-map-1',
    title: '资料脉络可用性验证',
    fileName: 'knowledge-map.txt',
    fileType: 'txt',
    content: '资料脉络需要围绕核心词建立节点、关系、引用状态和后续问题。',
    rawContent: '资料脉络需要围绕核心词建立节点、关系、引用状态和后续问题。',
  },
];

const citations: GroundedCitation[] = [
  {
    paperId: 'paper-map-1',
    paperShortName: '资料脉络',
    sourceId: 'paper-map-1',
    chunkId: 'paper-map-1::chunk-1',
    chunkIndex: 0,
    sourceTitle: '资料脉络可用性验证',
    excerpt: '资料脉络需要围绕核心词建立节点、关系、引用状态和后续问题。',
    score: 0.92,
  },
  {
    paperId: 'paper-map-1',
    paperShortName: '资料脉络',
    sourceId: 'paper-map-1',
    chunkId: 'paper-map-1::chunk-2',
    chunkIndex: 1,
    sourceTitle: '资料脉络可用性验证',
    excerpt: '核心词应当位于中间，相关概念通过关系边连接，用户点击节点后查看引用证据。',
    score: 0.88,
  },
];

const map = buildFastKnowledgeMap(papers, citations);
const focalNodes = map.nodes.filter(node => node.focal);
const extractedEdges = map.edges.filter(edge => edge.confidence === 'EXTRACTED');

assert.equal(map.schemaVersion, 1);
assert.ok(map.title.includes('资料脉络'), 'title should be product-facing');
assert.equal(focalNodes.length, 1, 'fast compiler should create exactly one focal node');
assert.ok(map.nodes.length >= 6, `expected at least 6 nodes, got ${map.nodes.length}`);
assert.ok(map.edges.length >= 5, `expected at least 5 edges, got ${map.edges.length}`);
assert.ok(focalNodes[0].degree > 0, 'focal node should have graph degree');
assert.ok(map.nodes.some(node => node.citationNumbers.length > 0), 'nodes should carry citation numbers');
assert.ok(map.edges.every(edge => edge.relation !== '相关'), 'relations should be specific rather than generic');
assert.ok(map.edges.some(edge => edge.citationNumbers.length > 0), 'edges should carry citation numbers');
assert.ok(extractedEdges.length >= 1, 'same-citation co-occurrence should produce extracted edges');
assert.ok(map.analysis.suggestedQuestions.length >= 1, 'analysis should include suggested follow-up questions');
assert.ok(map.communities.length >= 1, 'communities should group nodes');

console.log(JSON.stringify({
  ok: true,
  nodeCount: map.nodes.length,
  edgeCount: map.edges.length,
  focal: focalNodes[0].label,
  extractedEdgeCount: extractedEdges.length,
  suggestedQuestionCount: map.analysis.suggestedQuestions.length,
}, null, 2));
