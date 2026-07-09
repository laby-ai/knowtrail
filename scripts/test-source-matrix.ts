import assert from 'node:assert/strict';
import { buildSourceMatrixFacets } from '../src/lib/source-matrix';
import type { Paper } from '../src/types';

function paper(overrides: Partial<Paper>): Paper {
  return {
    id: 'paper-1',
    title: 'Evidence matrix test',
    authors: [],
    year: 2026,
    keywords: [],
    content: '',
    shortName: 'Test 2026',
    fileName: 'paper.txt',
    fileType: 'txt',
    fileSize: 100,
    uploadTime: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

const richPaper = paper({
  title: 'Clinical model evaluation',
  abstract: [
    'Methods: We trained a regression model and evaluated it in a randomized experiment.',
    'Data: The dataset included 420 patient records collected from two hospitals.',
    'Results showed a significant reduction in error compared with the baseline.',
    'Limitations include sample bias and the need for further research.',
  ].join(' '),
});

const richFacets = buildSourceMatrixFacets(richPaper);
assert.equal(richFacets.length, 4);
assert.ok(richFacets.every(facet => facet.extracted), 'all four matrix facets should be extracted from explicit evidence');
assert.ok(richFacets.find(facet => facet.key === 'method')?.excerpt.includes('regression model'));
assert.ok(richFacets.find(facet => facet.key === 'data')?.excerpt.includes('420 patient records'));
assert.ok(richFacets.find(facet => facet.key === 'result')?.excerpt.includes('significant reduction'));
assert.ok(richFacets.find(facet => facet.key === 'limitation')?.excerpt.includes('sample bias'));

const sparseFacets = buildSourceMatrixFacets(paper({
  title: '只有标题的文献',
  content: '',
}));

assert.equal(sparseFacets.length, 4);
assert.ok(sparseFacets.every(facet => !facet.extracted), 'sparse paper should not fabricate matrix claims');
assert.ok(sparseFacets.every(facet => facet.evidenceLabel === '待补证据'));
assert.ok(sparseFacets.every(facet => facet.emptyHint.length > 0));

console.log(JSON.stringify({
  ok: true,
  extractedKeys: richFacets.filter(facet => facet.extracted).map(facet => facet.key),
  sparseMissing: sparseFacets.filter(facet => !facet.extracted).map(facet => facet.key),
}, null, 2));
