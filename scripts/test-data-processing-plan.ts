import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDataProcessingPlan,
  validateDataProcessingRequest,
} from '../src/lib/data-processing-plan';
import type { Paper } from '../src/types';

const csvPaper: Paper = {
  id: 'dataset-1',
  title: 'Treatment response cohort',
  authors: ['Research Team'],
  year: 2026,
  abstract: 'Structured cohort data.',
  content: 'patient_id,site,age,response\np1,A,20,yes\np2,A,,no\np3,B,42,yes\np4,B,37,no',
  rawContent: 'patient_id,site,age,response\np1,A,20,yes\np2,A,,no\np3,B,42,yes\np4,B,37,no',
  shortName: 'Cohort CSV',
  keywords: [],
  fileName: 'cohort.csv',
  fileType: 'csv',
  fileSize: 120,
  uploadTime: '2026-07-10T00:00:00.000Z',
};

const validRequest = {
  question: '能否用入组时信息预测治疗响应？',
  sampleUnit: '单个患者',
  taskFamily: 'prediction' as const,
  targetColumn: 'response',
  splitColumn: 'site',
};

assert.deepEqual(validateDataProcessingRequest(validRequest, csvPaper), []);
assert.match(validateDataProcessingRequest({ ...validRequest, taskFamily: 'unknown' as 'prediction' }, csvPaper).join(' '), /任务类型/);
assert.match(validateDataProcessingRequest({ ...validRequest, targetColumn: '' }, csvPaper).join(' '), /目标列/);
assert.match(validateDataProcessingRequest(validRequest, { ...csvPaper, fileType: 'pdf' }).join(' '), /CSV|XLSX/);

const plan = buildDataProcessingPlan(validRequest, csvPaper);
assert.equal(plan.dataset.rowCount, 4);
assert.equal(plan.dataset.columnCount, 4);
assert.equal(plan.contract.sampleUnit, '单个患者');
assert.equal(plan.contract.targetColumn, 'response');
assert.deepEqual(plan.contract.inputColumns, ['patient_id', 'site', 'age']);
assert.match(plan.dataQuality.warnings.join(' '), /age.*缺失 1/);
assert.match(plan.dataQuality.warnings.join(' '), /patient_id.*标识列|标识列.*patient_id/);
assert.match(plan.recommendation.baseline, /多数类|逻辑回归|RandomForest/);
assert.deepEqual(plan.recommendation.metrics, ['balanced accuracy', 'F1', 'PR-AUC', '校准']);
assert.match(plan.split.rule, /site.*分组切分|分组切分.*site/);
assert.match(plan.split.leakageRisks.join(' '), /response.*特征|目标列.*特征/);
assert.match(plan.boundary, /未执行模型训练/);
assert.match(plan.boundary, /因果/);
assert.match(plan.artifactMarkdown, /## 数据合同/);
assert.match(plan.artifactMarkdown, /## 数据质量/);
assert.match(plan.artifactMarkdown, /## Baseline 与评估/);
assert.match(plan.artifactMarkdown, /Treatment response cohort/);
assert.doesNotMatch(plan.artifactMarkdown, /模型已训练|显著优于|统计显著/);

const routePath = path.join(process.cwd(), 'src/app/api/data-processing/plan/route.ts');
assert.ok(fs.existsSync(routePath), 'Data processing should expose a dedicated server route.');
const routeSource = fs.readFileSync(routePath, 'utf8');
assert.match(routeSource, /resolveAccountNotebookScope/, 'Route should preserve account and notebook scope.');
assert.match(routeSource, /buildDataProcessingPlan/, 'Route should use the deterministic data plan contract.');
assert.match(routeSource, /Response\.json\(\{ code, msg, data \}/, 'Route responses should use the {code,msg,data} envelope.');
assert.match(routeSource, /response\(0, 'ok', plan\)/, 'Successful plans should use code 0 and return the plan as data.');
assert.match(routeSource, /Cache-Control[^\n]+no-store/, 'Route should disable response caching.');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'real CSV rows and columns become an explicit input-output contract',
    'missing values, identifier leakage, grouped split, baseline, and metrics are deterministic',
    'artifact states that training, significance, and causal claims were not executed',
    'new route follows account scope and {code,msg,data} response convergence',
  ],
}, null, 2));
