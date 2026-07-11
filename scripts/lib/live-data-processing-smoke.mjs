const REQUIRED_ARTIFACT_SECTIONS = [
  '数据合同',
  '数据质量',
  '切分与泄漏',
  'Baseline 与评估',
  '可复现步骤',
  '边界',
];

export function createDataProcessingProbeBody() {
  const content = [
    'patient_id,site,age,response',
    'p1,A,20,yes',
    'p2,A,,no',
    'p3,B,42,yes',
    'p4,B,37,no',
  ].join('\n');
  return {
    question: '能否用入组时信息预测治疗响应？',
    sampleUnit: '单个患者',
    taskFamily: 'prediction',
    targetColumn: 'response',
    splitColumn: 'site',
    notebookId: 'live-data-processing-smoke',
    paper: {
      id: 'live-data-source',
      title: 'Treatment response cohort',
      authors: ['Research Team'],
      year: 2026,
      abstract: 'Structured cohort data for a deterministic release probe.',
      content,
      rawContent: content,
      shortName: 'Cohort CSV',
      keywords: [],
      fileName: 'cohort.csv',
      fileType: 'csv',
      fileSize: Buffer.byteLength(content),
      uploadTime: '2026-07-11T00:00:00.000Z',
    },
  };
}

export function validateDataProcessingResponse(payload) {
  if (payload?.code !== 0 || payload?.msg !== 'ok' || !payload?.data) {
    throw new Error(`Data processing must return code 0, got ${payload?.code ?? 'missing'}.`);
  }
  const plan = payload.data;
  if (plan.dataset?.rowCount !== 4 || plan.dataset?.columnCount !== 4) {
    throw new Error('Data processing dataset dimensions drifted from the deterministic CSV.');
  }
  if (plan.contract?.taskFamily !== 'prediction'
    || plan.contract?.targetColumn !== 'response'
    || plan.contract?.splitColumn !== 'site') {
    throw new Error('Data processing input-output contract is incomplete.');
  }
  const columns = Array.isArray(plan.dataset?.columns) ? plan.dataset.columns : [];
  const missingColumnCount = columns.filter(column => Number(column.missingCount) > 0).length;
  const warnings = Array.isArray(plan.dataQuality?.warnings) ? plan.dataQuality.warnings : [];
  const identifierWarningCount = warnings.filter(warning => /patient_id.*标识列|标识列.*patient_id/.test(warning)).length;
  if (missingColumnCount < 1 || !warnings.some(warning => /age.*缺失 1/.test(warning))) {
    throw new Error('Data processing lost the real missing-value finding.');
  }
  if (identifierWarningCount < 1) throw new Error('Data processing lost the identifier leakage warning.');
  if (!/site.*分组切分|分组切分.*site/.test(plan.split?.rule || '')) {
    throw new Error('Data processing lost the grouped split rule.');
  }
  if (!Array.isArray(plan.split?.leakageRisks)
    || !plan.split.leakageRisks.some(risk => /response.*特征|目标列.*特征/.test(risk))) {
    throw new Error('Data processing lost the target leakage boundary.');
  }
  if (!/逻辑回归|RandomForest|多数类/.test(plan.recommendation?.baseline || '')) {
    throw new Error('Data processing returned no credible lightweight baseline.');
  }
  const metrics = plan.recommendation?.metrics || [];
  for (const metric of ['balanced accuracy', 'F1', 'PR-AUC', '校准']) {
    if (!metrics.includes(metric)) throw new Error(`Data processing is missing metric: ${metric}.`);
  }
  if (!/未执行模型训练/.test(plan.boundary || '') || !/因果识别/.test(plan.boundary || '')) {
    throw new Error('Data processing lost the unexecuted-analysis boundary.');
  }
  const artifact = plan.artifactMarkdown || '';
  const missingSections = REQUIRED_ARTIFACT_SECTIONS.filter(section => !artifact.includes(`## ${section}`));
  if (missingSections.length) throw new Error(`Data processing artifact is missing sections: ${missingSections.join(', ')}.`);
  if (/模型已训练|统计显著|显著优于|因果已证实/.test(artifact)) {
    throw new Error('Data processing artifact claims unexecuted results.');
  }
  if (!/\.md$/.test(plan.artifactFileName || '')) throw new Error('Data processing artifact filename is invalid.');
  return {
    rowCount: plan.dataset.rowCount,
    columnCount: plan.dataset.columnCount,
    missingColumnCount,
    identifierWarningCount,
    baseline: plan.recommendation.baseline,
    metrics,
    artifactFileName: plan.artifactFileName,
    artifactBytes: Buffer.byteLength(artifact),
  };
}
