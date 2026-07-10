const REQUIRED_FIELDS = [
  'statement',
  'reasoningBasis',
  'competingExplanation',
  'falsifiablePrediction',
  'validationPlan',
  'uncertainty',
];

export function createHypothesisGenerationProbeBody() {
  return {
    question: '显式记录证据来源、反例和限制为什么可能降低研究中的选择性报告，并提高复核能力？',
    notebookId: 'live-hypothesis-generation-smoke',
    papers: [{
      id: 'live-hypothesis-source',
      title: '可复核证据链方法说明',
      abstract: '显式记录问题边界、证据来源、反例与限制，可以减少选择性保留材料的风险。',
      content: [
        '研究开始前应固定问题边界，并保存每条证据的来源、作者、日期、摘录与核验状态。',
        '纳入与排除理由需要显式记录，以减少只保留支持预期结论材料的选择偏差。',
        '关键主张应关联来源片段，同时单独记录反例、限制和仍待全文核验的事项。',
        '这些做法提高过程可复核性，但当前材料没有提供随机对照结果，不能证明因果关系或统计显著性。',
      ].join(''),
    }],
  };
}

function applyPayload(result, payload) {
  if (typeof payload === 'string') {
    if (payload === '[DONE]') result.done = true;
    return;
  }
  if (!payload || typeof payload !== 'object') return;
  if (payload.error) throw new Error(`${payload.errorType || 'hypothesis_generation_failed'}: ${payload.error}`);
  if (payload.progress?.stage) result.progressStages.push(payload.progress.stage);
  if (Array.isArray(payload.citations)) result.citations = payload.citations;
  if (payload.retrieval) result.retrieval = payload.retrieval;
  if (Array.isArray(payload.hypotheses)) result.hypotheses = payload.hypotheses;
  if (payload.hypothesisStatus) result.hypothesisStatus = payload.hypothesisStatus;
  if (payload.billing) result.billing = payload.billing;
}

function parseEventBlock(result, block) {
  const data = block
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data) return;
  if (data === '[DONE]') return applyPayload(result, data);
  try {
    applyPayload(result, JSON.parse(data));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Hypothesis generation returned malformed SSE JSON.');
    throw error;
  }
}

export async function consumeHypothesisGenerationSse(body) {
  if (!body) throw new Error('Hypothesis generation returned an empty SSE body.');
  const result = {
    hypotheses: [],
    citations: [],
    progressStages: [],
    retrieval: null,
    hypothesisStatus: null,
    billing: null,
    done: false,
  };
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) parseEventBlock(result, block);
    if (done) break;
  }
  if (buffer.trim()) parseEventBlock(result, buffer);
  return result;
}

export function validateHypothesisGenerationResult(result, options = {}) {
  if (!result.done) throw new Error('Hypothesis generation SSE ended without [DONE].');
  if (result.hypothesisStatus?.answerStatus !== 'complete') {
    throw new Error(`Hypothesis generation is not complete: ${result.hypothesisStatus?.answerStatus || 'missing'}.`);
  }
  if (!Array.isArray(result.citations) || result.citations.length === 0) {
    throw new Error('Hypothesis generation returned no evidence citations.');
  }
  if (!Array.isArray(result.hypotheses) || result.hypotheses.length < 3 || result.hypotheses.length > 5) {
    throw new Error('Hypothesis generation must return 3-5 hypotheses.');
  }
  const invalidEvidenceMarkers = result.hypothesisStatus?.invalidEvidenceMarkers || [];
  if (invalidEvidenceMarkers.length) throw new Error(`Hypothesis generation returned invalid evidence markers: ${invalidEvidenceMarkers.join(', ')}.`);

  result.hypotheses.forEach((hypothesis, index) => {
    const expectedId = `H${index + 1}`;
    if (hypothesis?.id !== expectedId) throw new Error(`Hypothesis IDs must be continuous; expected ${expectedId}.`);
    for (const field of REQUIRED_FIELDS) {
      if (typeof hypothesis[field] !== 'string' || hypothesis[field].trim().length < 8) {
        throw new Error(`${expectedId} has an incomplete ${field}.`);
      }
    }
    if (!Array.isArray(hypothesis.evidenceMarkers) || hypothesis.evidenceMarkers.length === 0) {
      throw new Error(`${expectedId} has no evidence markers.`);
    }
    for (const marker of hypothesis.evidenceMarkers) {
      if (!Number.isInteger(marker) || marker < 1 || marker > result.citations.length) {
        throw new Error(`${expectedId} has an out-of-range evidence marker: ${marker}.`);
      }
      if (!hypothesis.reasoningBasis.includes(`[${marker}]`)) {
        throw new Error(`${expectedId} reasoning basis does not show evidence marker [${marker}].`);
      }
    }
  });

  const requiredStages = ['evidence-ready', 'generating', 'auditing'];
  const missingStages = requiredStages.filter(stage => !result.progressStages.includes(stage));
  if (missingStages.length) throw new Error(`Hypothesis generation stream is missing progress stages: ${missingStages.join(', ')}.`);
  if (options.requireBilling && result.billing?.status !== 'settled') {
    throw new Error(`Hypothesis generation billing did not settle: ${result.billing?.status || 'missing'}.`);
  }
  return {
    answerStatus: result.hypothesisStatus.answerStatus,
    hypothesisCount: result.hypotheses.length,
    citationCount: result.citations.length,
    progressStages: [...new Set(result.progressStages)],
    billingStatus: result.billing?.status || 'not-required',
  };
}
