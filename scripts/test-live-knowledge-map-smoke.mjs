import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createKnowledgeMapProbeBody,
  validateKnowledgeMapResponse,
} from './lib/live-knowledge-map-smoke.mjs';

const probe = createKnowledgeMapProbeBody();
assert.equal(probe.papers.length, 1);
assert.ok(probe.papers[0].content.length >= 120, 'Live probe should contain substantive evidence.');

const summary = validateKnowledgeMapResponse({
  map: {
    schemaVersion: 1,
    title: '证据合成的研究脉络',
    nodes: [
      { id: 'evidence', label: '证据记录', focal: true, citationNumbers: [1], sourceId: 'live-map-source' },
      { id: 'bias', label: '选择偏差', focal: false, citationNumbers: [1], sourceId: 'live-map-source' },
      { id: 'review', label: '来源复核', focal: false, citationNumbers: [1], sourceId: 'live-map-source' },
      { id: 'limits', label: '限制说明', focal: false, citationNumbers: [1], sourceId: 'live-map-source' },
    ],
    edges: [
      { source: 'evidence', target: 'bias', relation: '降低偏差', confidence: 'EXTRACTED', citationNumbers: [1] },
      { source: 'evidence', target: 'review', relation: '支持复核', confidence: 'EXTRACTED', citationNumbers: [1] },
    ],
  },
  citations: [{ sourceId: 'live-map-source', excerpt: 'substantive evidence' }],
  citationAudit: { status: 'pass' },
  retrieval: { sourceCount: 1 },
});
assert.equal(summary.nodeCount, 4);
assert.equal(summary.edgeCount, 2);
assert.equal(summary.focalCount, 1);
assert.equal(summary.citedNodeCount, 4);
assert.equal(summary.citedEdgeCount, 2);

assert.throws(
  () => validateKnowledgeMapResponse({ map: { nodes: [], edges: [] }, citations: [], citationAudit: { status: 'none' } }),
  /nodes/,
);
assert.throws(
  () => validateKnowledgeMapResponse({
    map: {
      nodes: [
        { id: 'a', focal: true, citationNumbers: [] },
        { id: 'b', focal: false, citationNumbers: [] },
        { id: 'c', focal: false, citationNumbers: [] },
        { id: 'd', focal: false, citationNumbers: [] },
      ],
      edges: [
        { source: 'a', target: 'b', relation: '相关', citationNumbers: [] },
        { source: 'a', target: 'c', relation: '相关', citationNumbers: [] },
      ],
    },
    citations: [{ sourceId: 'x' }],
    citationAudit: { status: 'pass' },
  }),
  /citation-backed/,
);

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts?.['smoke:live-knowledge-map'], 'node ./scripts/smoke-live-knowledge-map.mjs');
assert.equal(packageJson.scripts?.['test:live-knowledge-map-smoke'], 'node ./scripts/test-live-knowledge-map-smoke.mjs');
assert.match(packageJson.scripts?.validate || '', /test:live-knowledge-map-smoke/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'probe carries substantive deterministic evidence',
    'live response requires nodes, edges, one focal node, citations, and evidence-backed relationships',
    'runner and validation entrypoints remain wired',
  ],
}, null, 2));
