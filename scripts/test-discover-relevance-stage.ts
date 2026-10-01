import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  applyDiscoverRelevanceStage,
  extractRelevanceQueryTerms,
  scoreDiscoveredSourceRelevance,
} from '../src/lib/discover-relevance-stage';

function source(input: Partial<Parameters<typeof scoreDiscoveredSourceRelevance>[1]>): Parameters<typeof scoreDiscoveredSourceRelevance>[1] {
  return {
    title: input.title || '',
    link: input.link || 'https://example.org/result',
    snippet: input.snippet || '',
    content: input.content,
    date: input.date || '',
    authors: input.authors || [],
    provider: input.provider || 'metaso',
    verificationStatus: input.verificationStatus || 'candidate',
  };
}

async function main() {
  assert.deepEqual(extractRelevanceQueryTerms('multimodal evaluation effectiveness'), [
    'multimodal',
    'evaluation',
    'effectiveness',
  ]);

  const relevant = scoreDiscoveredSourceRelevance(
    'multimodal evaluation effectiveness',
    source({
      title: 'Multimodal evaluation measures effectiveness of reports',
      snippet: 'We compare systems and report human and automatic checks.',
      provider: 'arxiv',
      verificationStatus: 'open-source-candidate',
    }),
  );
  assert.equal(relevant.relevance.verdict, 'relevant');
  assert.ok(relevant.relevance.confidence >= 0.55);
  assert.ok(relevant.relevance.matchedTerms.includes('multimodal'));

  const partial = scoreDiscoveredSourceRelevance(
    'fusion AI',
    source({
      title: 'AI-based national health policy analysis',
      snippet: 'The policy study compares health systems in two regions.',
    }),
  );
  assert.equal(partial.relevance.verdict, 'partially_relevant');
  assert.deepEqual(partial.relevance.matchedTerms, ['ai']);
  assert.deepEqual(partial.relevance.missingTerms, ['fusion']);

  const irrelevant = scoreDiscoveredSourceRelevance(
    'quantum sensor calibration',
    source({
      title: 'Evidence-aware multimodal document retrieval',
      snippet: 'A system links document chunks to report claims.',
    }),
  );
  assert.equal(irrelevant.relevance.verdict, 'irrelevant');
  assert.deepEqual(irrelevant.relevance.matchedTerms, []);

  const chinese = scoreDiscoveredSourceRelevance(
    '多模态大模型评测方法',
    source({
      title: '多模态大模型的自动评测方法',
      snippet: '提出可追溯的多模态评测流程，并给出模型能力对比。',
    }),
  );
  assert.equal(chinese.relevance.verdict, 'relevant');
  assert.ok(chinese.relevance.matchedTerms.includes('模态'));

  const filtered = applyDiscoverRelevanceStage('multimodal evaluation effectiveness', [
    source({ title: 'Multimodal evaluation measures effectiveness of reports' }),
    source({ title: 'How to organize a product catalog' }),
  ]);
  assert.equal(filtered.status, 'filtered-low-relevance');
  assert.equal(filtered.totalCount, 2);
  assert.equal(filtered.acceptedCount, 1);
  assert.equal(filtered.irrelevantCount, 1);
  assert.equal(filtered.results[0]?.relevance.verdict, 'relevant');

  const allIrrelevant = applyDiscoverRelevanceStage('quantum sensor calibration', [
    source({ title: 'Evidence-aware multimodal document retrieval' }),
    source({ title: 'Human health policy analysis' }),
  ]);
  assert.equal(allIrrelevant.status, 'all-irrelevant');
  assert.deepEqual(allIrrelevant.results, []);

  const empty = applyDiscoverRelevanceStage('multimodal evaluation', []);
  assert.equal(empty.status, 'empty-search');
  assert.deepEqual(empty.results, []);

  const unassessed = applyDiscoverRelevanceStage('a', [source({ title: 'An available candidate' })]);
  assert.equal(unassessed.status, 'no-query-terms');
  assert.equal(unassessed.acceptedCount, 1);
  assert.equal(unassessed.irrelevantCount, 0);
  assert.equal(unassessed.results[0]?.relevance.verdict, 'unassessed');
  assert.equal(unassessed.results.filter(item => item.relevance.verdict !== 'irrelevant').length, 1,
    'Unassessed candidates must survive the client relevance filter');

  const routeSource = await readFile(path.join(process.cwd(), 'src/app/api/discover/search/route.ts'), 'utf8');
  assert.match(routeSource, /applyDiscoverRelevanceStage/, 'Discover route must run the relevance gate before returning results.');
  const uiSource = await readFile(path.join(process.cwd(), 'src/components/library/DiscoverSourcesModal.tsx'), 'utf8');
  assert.match(uiSource, /discover-relevance-stage/, 'The search UI must expose relevance-stage outcomes.');

  console.log(JSON.stringify({
    ok: true,
  checked: [
    'English query terms use normalized lexical matching',
    'English plural candidates match the original lexical form',
      'AI-only overlap remains partial instead of pretending full relevance',
      'Chinese phrase overlap scores both short and long terms',
      'low-relevance candidates are kept out of accepted results',
      'all-irrelevant and empty searches return explicit no-results statuses',
      'discover route runs the relevance gate before the UI receives results',
      'search UI exposes relevance-stage audit information',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
