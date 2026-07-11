import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createDataProcessingProbeBody,
  validateDataProcessingResponse,
} from './lib/live-data-processing-smoke.mjs';

const probe = createDataProcessingProbeBody();
assert.equal(probe.paper.fileType, 'csv');
assert.match(probe.paper.content, /patient_id,site,age,response/);
assert.equal(probe.targetColumn, 'response');
assert.equal(probe.splitColumn, 'site');

const summary = validateDataProcessingResponse({
  code: 0,
  msg: 'ok',
  data: {
    dataset: {
      sourceId: 'live-data-source',
      sourceTitle: 'Treatment response cohort',
      rowCount: 4,
      sampledRowCount: 4,
      columnCount: 4,
      columns: [
        { name: 'patient_id', type: 'text', missingCount: 0 },
        { name: 'site', type: 'text', missingCount: 0 },
        { name: 'age', type: 'numeric', missingCount: 1 },
        { name: 'response', type: 'text', missingCount: 0 },
      ],
    },
    contract: {
      scientificQuestion: '能否用入组时信息预测治疗响应？',
      sampleUnit: '单个患者',
      taskFamily: 'prediction',
      inputColumns: ['patient_id', 'site', 'age'],
      targetColumn: 'response',
      splitColumn: 'site',
    },
    dataQuality: {
      warnings: [
        'age 缺失 1 行，处理方式需在切分后确定。',
        'patient_id 看起来是标识列，默认不得作为预测特征。',
      ],
    },
    recommendation: {
      taskLabel: '监督预测',
      framework: '表格分类',
      baseline: '先用多数类和逻辑回归，再比较 RandomForest。',
      metrics: ['balanced accuracy', 'F1', 'PR-AUC', '校准'],
    },
    split: {
      rule: '按 site 做分组切分，确保同组样本不会同时进入训练和验证。',
      leakageRisks: ['目标列 response 不能出现在输入特征或其事后衍生字段中。'],
    },
    steps: ['锁定科研问题。', '复核数据质量。', '执行分组切分。'],
    boundary: '未执行模型训练、统计检验、图表生成或因果识别。',
    artifactMarkdown: '# 数据处理与 Baseline 方案\n\n## 数据合同\n真实字段\n\n## 数据质量\n缺失与标识风险\n\n## 切分与泄漏\n按 site 分组\n\n## Baseline 与评估\n逻辑回归\n\n## 可复现步骤\n1. 复核\n\n## 边界\n未执行模型训练、统计检验、图表生成或因果识别。',
    artifactFileName: 'cohort-data-plan.md',
  },
});

assert.equal(summary.rowCount, 4);
assert.equal(summary.columnCount, 4);
assert.equal(summary.missingColumnCount, 1);
assert.equal(summary.identifierWarningCount, 1);
assert.equal(summary.artifactFileName, 'cohort-data-plan.md');

assert.throws(
  () => validateDataProcessingResponse({ code: 0, msg: 'ok', data: { ...summary, artifactMarkdown: '模型已训练。' } }),
  /dataset|artifact|unexecuted/i,
);
assert.throws(
  () => validateDataProcessingResponse({ code: 42201, msg: 'invalid', data: null }),
  /code 0/i,
);

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts?.['smoke:live-data-processing'], 'node ./scripts/smoke-live-data-processing.mjs');
assert.equal(packageJson.scripts?.['test:live-data-processing-smoke'], 'node ./scripts/test-live-data-processing-smoke.mjs');
assert.match(packageJson.scripts?.validate || '', /test:live-data-processing-smoke/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'probe carries a deterministic real CSV table',
    'response validation checks data contract, quality, split, baseline, metrics, and artifact',
    'invalid and result-claiming responses fail closed',
    'runner and aggregate validation remain wired',
  ],
}, null, 2));
