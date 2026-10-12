import assert from 'node:assert/strict';
import { assessSearchTopics } from '../src/lib/search-topic-relevance';
import { applyDiscoverRelevanceStage } from '../src/lib/discover-relevance-stage';

assert.equal(assessSearchTopics('AI', 'Rainfall measurement in Spain').accepted, false, 'AI must not match inside unrelated words');
assert.equal(assessSearchTopics('AI fusion', 'Artificial intelligence in health policy').accepted, false, 'One common word cannot satisfy a multi-topic query');
assert.equal(assessSearchTopics('AI fusion', 'Artificial intelligence for sensor fusion').accepted, true);
assert.equal(assessSearchTopics('多模态大模型评测方法', 'Evaluation of multimodal foundation models').accepted, true, 'Common bilingual terms should survive');
assert.equal(assessSearchTopics('多模态大模型评测方法', '一种材料性能的自动评测方法').accepted, false, 'Generic Chinese method words must not satisfy a topic');
assert.equal(assessSearchTopics('quantum sensor calibration', 'Calibration of quantum sensors').accepted, true);
assert.equal(assessSearchTopics('Geoffrey Hinton', 'Paper author: Hinton, Geoffrey').accepted, true);
assert.equal(assessSearchTopics('cancer OR tumor', 'Source Boolean query').accepted, true, 'Advanced syntax is delegated to its provider, never rewritten as AND');

const candidate = { title: 'AI-based health policy', link: 'https://example.invalid/paper', snippet: 'National health policy research', content: 'Navigation links: AI fusion quantum sensors', date: '', authors: [], provider: 'metaso' as const, verificationStatus: 'candidate' as const };
assert.equal(applyDiscoverRelevanceStage('AI fusion', [candidate]).results.length, 0, 'Off-topic summaries cannot pass through body navigation keywords');
assert.equal(applyDiscoverRelevanceStage('AI fusion', [{ ...candidate, title: 'AI sensor fusion', snippet: '' }]).results.length, 1);
console.log('Search topic regression checks passed');
