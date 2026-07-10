const REQUIRED_SECTIONS = [
  '研究问题',
  '研究边界',
  '关键词',
  '证据来源',
  '主要结论',
  '分论点',
  '争议或不足',
  '可实操路线',
  '还需要核验',
];

export function createDeepResearchProbeBody() {
  return {
    question: '显式记录研究问题、证据来源和限制如何降低研究结论偏差？',
    notebookId: 'live-deep-research-smoke',
    papers: [{
      id: 'live-deep-research-source',
      title: '可复核证据链方法说明',
      abstract: '该方法要求在形成结论前固定研究问题，记录证据来源、纳入与排除理由，并区分已核验材料和候选材料。',
      content: [
        '研究流程应先固定问题和边界，再保存每条证据的来源、作者、日期、摘录与核验状态。',
        '纳入和排除理由需要显式记录，避免只保留支持预期结论的材料。',
        '报告中的关键主张应指向证据编号，同时列出反例、限制和仍需核验的项目。',
        '这种记录提高过程可复核性，但不能替代全文核验、统计检验，也不能证明因果关系。',
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
  if (payload.error) throw new Error(`${payload.errorType || 'deep_research_failed'}: ${payload.error}`);
  if (payload.progress?.stage) result.progressStages.push(payload.progress.stage);
  if (Array.isArray(payload.citations)) result.citations = payload.citations;
  if (payload.retrieval) result.retrieval = payload.retrieval;
  if (typeof payload.content === 'string') result.answer += payload.content;
  if (typeof payload.replaceContent === 'string') result.answer = payload.replaceContent;
  if (payload.citationAudit) result.citationAudit = payload.citationAudit;
  if (payload.researchStatus) result.researchStatus = payload.researchStatus;
  if (payload.billing) result.billing = payload.billing;
}

function parseEventBlock(result, block) {
  const data = block
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data) return;
  if (data === '[DONE]') {
    applyPayload(result, data);
    return;
  }
  try {
    applyPayload(result, JSON.parse(data));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Deep research returned malformed SSE JSON.');
    throw error;
  }
}

export async function consumeDeepResearchSse(body) {
  if (!body) throw new Error('Deep research returned an empty SSE body.');
  const result = {
    answer: '',
    citations: [],
    progressStages: [],
    retrieval: null,
    citationAudit: null,
    researchStatus: null,
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

export function validateDeepResearchResult(result, options = {}) {
  const answerStatus = result.researchStatus?.answerStatus;
  const citationAuditStatus = result.citationAudit?.status;
  const sectionCoverageStatus = result.researchStatus?.sectionCoverage?.status;
  if (!result.done) throw new Error('Deep research SSE ended without [DONE].');
  if (answerStatus !== 'complete') {
    const missingSections = result.researchStatus?.sectionCoverage?.missingSections || [];
    const uncitedClaimCount = result.researchStatus?.sectionCoverage?.uncitedClaims?.length || 0;
    throw new Error(
      `Deep research report is not complete: ${answerStatus || 'missing'}; `
      + `citation=${citationAuditStatus || 'missing'}; sections=${sectionCoverageStatus || 'missing'}; `
      + `missing=${missingSections.join(',') || 'none'}; uncitedClaims=${uncitedClaimCount}.`,
    );
  }
  if (citationAuditStatus !== 'pass') throw new Error(`Deep research citation audit failed: ${citationAuditStatus || 'missing'}.`);
  if (sectionCoverageStatus !== 'pass') throw new Error(`Deep research section coverage failed: ${sectionCoverageStatus || 'missing'}.`);
  if (!Array.isArray(result.citations) || result.citations.length === 0) throw new Error('Deep research returned no citations.');
  if (!/\[\d+\]/.test(result.answer)) throw new Error('Deep research report contains no numbered citation markers.');
  const missingSections = REQUIRED_SECTIONS.filter(section => !result.answer.includes(section));
  if (missingSections.length) throw new Error(`Deep research report is missing sections: ${missingSections.join(', ')}.`);
  const requiredStages = ['evidence-ready', 'writing', 'auditing'];
  const missingStages = requiredStages.filter(stage => !result.progressStages.includes(stage));
  if (missingStages.length) throw new Error(`Deep research stream is missing progress stages: ${missingStages.join(', ')}.`);
  if (options.requireBilling && result.billing?.status !== 'settled') {
    throw new Error(`Deep research billing did not settle: ${result.billing?.status || 'missing'}.`);
  }
  return {
    answerStatus,
    citationAuditStatus,
    sectionCoverageStatus,
    citationCount: result.citations.length,
    progressStages: [...new Set(result.progressStages)],
    answerChars: result.answer.length,
    billingStatus: result.billing?.status || 'not-required',
    removedUncitedClaims: result.researchStatus?.removedUncitedClaims || 0,
    repairAttempted: result.researchStatus?.repairAttempted === true,
  };
}
