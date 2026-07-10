import { buildDataTablePreviewForPaper, type DataColumnSummary } from '@/lib/data-table-preview';
import type { Paper } from '@/types';

export type DataTaskFamily = 'description' | 'prediction' | 'comparison' | 'trend';

export interface DataProcessingRequest {
  question: string;
  sampleUnit: string;
  taskFamily: DataTaskFamily;
  targetColumn?: string;
  splitColumn?: string;
}

export interface DataProcessingPlan {
  dataset: {
    sourceId: string;
    sourceTitle: string;
    sheetName?: string;
    rowCount: number;
    sampledRowCount: number;
    columnCount: number;
    columns: DataColumnSummary[];
  };
  contract: {
    scientificQuestion: string;
    sampleUnit: string;
    taskFamily: DataTaskFamily;
    inputColumns: string[];
    targetColumn?: string;
    splitColumn?: string;
  };
  dataQuality: {
    warnings: string[];
  };
  recommendation: {
    taskLabel: string;
    framework: string;
    baseline: string;
    metrics: string[];
  };
  split: {
    rule: string;
    leakageRisks: string[];
  };
  steps: string[];
  boundary: string;
  artifactMarkdown: string;
  artifactFileName: string;
}

const TASK_LABELS: Record<DataTaskFamily, string> = {
  description: '描述与数据质量检查',
  prediction: '监督预测',
  comparison: '组间比较',
  trend: '时序或纵向趋势',
};

const DATA_TASK_FAMILIES = new Set<DataTaskFamily>(['description', 'prediction', 'comparison', 'trend']);

function isIdentifierColumn(name: string): boolean {
  return /(^id$|_id$|uuid|编号|序号|样本号|patient_id|subject_id|record_id|filename|文件名)/i.test(name.trim());
}

function safeFileStem(value: string): string {
  const stem = value.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (stem || 'dataset').slice(0, 60);
}

export function validateDataProcessingRequest(input: DataProcessingRequest, paper: Paper): string[] {
  const errors: string[] = [];
  if (!DATA_TASK_FAMILIES.has(input.taskFamily)) errors.push('不支持的数据任务类型。');
  if (!input.question?.trim()) errors.push('请填写需要回答的科研问题。');
  if (!input.sampleUnit?.trim()) errors.push('请说明一行数据代表什么样本单位。');
  if (paper.fileType !== 'csv' && paper.fileType !== 'xlsx') errors.push('数据处理仅支持已解析的 CSV 或 XLSX 来源。');
  const preview = buildDataTablePreviewForPaper(paper);
  if (!preview) errors.push('当前来源没有可解析的表格结构。');
  const columnNames = preview?.columns.map(column => column.name) || [];
  if (input.taskFamily !== 'description' && !input.targetColumn?.trim()) errors.push('当前任务需要选择目标列。');
  if (input.targetColumn && !columnNames.includes(input.targetColumn)) errors.push('目标列不在当前表格字段中。');
  if ((input.taskFamily === 'comparison' || input.taskFamily === 'trend') && !input.splitColumn?.trim()) {
    errors.push(input.taskFamily === 'comparison' ? '组间比较需要选择分组列。' : '趋势任务需要选择时间列。');
  }
  if (input.splitColumn && !columnNames.includes(input.splitColumn)) errors.push('分组、时间或批次列不在当前表格字段中。');
  if (input.targetColumn && input.splitColumn && input.targetColumn === input.splitColumn) errors.push('目标列不能同时作为切分或分组列。');
  return errors;
}

function recommend(input: DataProcessingRequest, target?: DataColumnSummary) {
  if (input.taskFamily === 'description') {
    return {
      framework: '描述统计与可视化',
      baseline: '先报告缺失率、分布、重复与异常范围，不启动预测模型。',
      metrics: ['缺失率', '分布范围', '分组覆盖', '异常值复核率'],
    };
  }
  if (input.taskFamily === 'comparison') {
    return {
      framework: '分组描述与效应量估计',
      baseline: '先比较各组分布与效应量，再根据设计决定简单检验或回归调整。',
      metrics: ['效应量', '置信区间', '组内样本量', '缺失率'],
    };
  }
  if (input.taskFamily === 'trend') {
    return {
      framework: '时间感知的趋势或预测',
      baseline: '先用末值、历史均值或移动平均作为可复核基线，再评估 ARIMA/简单序列模型。',
      metrics: ['MAE', 'RMSE', '时间窗口覆盖', '漂移检查'],
    };
  }
  if (target?.type === 'numeric') {
    return {
      framework: '表格回归',
      baseline: '先用均值预测和线性回归，再比较 RandomForest；不先上深度模型。',
      metrics: ['MAE', 'RMSE', 'R2', '分组误差'],
    };
  }
  return {
    framework: '表格分类',
    baseline: '先用多数类和逻辑回归，再比较 RandomForest；类别不平衡时不只看 accuracy。',
    metrics: ['balanced accuracy', 'F1', 'PR-AUC', '校准'],
  };
}

function buildSplitRule(input: DataProcessingRequest): string {
  if (input.taskFamily === 'trend' && input.splitColumn) return `按 ${input.splitColumn} 做时间先后切分，禁止随机打散未来记录。`;
  if (input.splitColumn) return `按 ${input.splitColumn} 做分组切分，确保同组样本不会同时进入训练和验证。`;
  if (input.taskFamily === 'description') return '本轮不训练模型；统计时保留原始分组、时间和批次边界。';
  return '尚未指定分组、时间或批次列；在确认独立样本边界前不要直接采用行级随机切分。';
}

function markdownList(items: string[]): string {
  return items.map(item => `- ${item}`).join('\n');
}

export function buildDataProcessingPlan(input: DataProcessingRequest, paper: Paper): DataProcessingPlan {
  const errors = validateDataProcessingRequest(input, paper);
  if (errors.length > 0) throw new Error(errors.join(' '));
  const preview = buildDataTablePreviewForPaper(paper);
  if (!preview) throw new Error('当前来源没有可解析的表格结构。');

  const target = input.targetColumn ? preview.columns.find(column => column.name === input.targetColumn) : undefined;
  const inputColumns = preview.columns
    .map(column => column.name)
    .filter(name => name !== input.targetColumn);
  const warnings: string[] = [];
  for (const column of preview.columns) {
    if (column.missingCount > 0) warnings.push(`${column.name} 缺失 ${column.missingCount} 行，处理方式需在切分后确定。`);
    if (column.type === 'mixed') warnings.push(`${column.name} 同时包含数值和文本，需先核对单位、编码或异常输入。`);
    if (isIdentifierColumn(column.name)) warnings.push(`${column.name} 看起来是标识列，默认不得作为预测特征。`);
  }
  if (preview.sampledRowCount < preview.rowCount) {
    warnings.push(`字段统计只采样前 ${preview.sampledRowCount} 行，完整处理前需重新扫描全部 ${preview.rowCount} 行。`);
  }
  if (preview.rowCount < 30 && input.taskFamily !== 'description') warnings.push('当前行数较少，模型评估不稳定，应优先报告不确定性。');
  if (warnings.length === 0) warnings.push('采样范围内未发现明显缺失或混合类型；仍需核对重复、单位和异常范围。');

  const leakageRisks = [
    input.targetColumn ? `目标列 ${input.targetColumn} 不能出现在输入特征或其事后衍生字段中。` : '尚未指定目标列，本轮不构造监督学习特征。',
    '行号、对象 ID、文件名、数据库键和采集后字段默认不得作为预测特征。',
    input.splitColumn
      ? `${input.splitColumn} 必须在切分时保留边界，不能让同组信息泄漏到验证集。`
      : '需确认患者、材料、站点、实验批次或时间是否造成相关样本。',
  ];
  const recommendation = recommend(input, target);
  const splitRule = buildSplitRule(input);
  const steps = [
    '锁定科研问题、样本单位、目标列和字段含义，不先选择复杂模型。',
    '复核缺失、混合类型、重复记录、单位、异常范围和标识列。',
    `执行切分规则：${splitRule}`,
    `先运行最轻量 baseline：${recommendation.baseline}`,
    `使用 ${recommendation.metrics.join('、')} 评估，并按组别、时间或批次检查误差。`,
    '把结果重新对照科研问题；预测性能不能替代因果或机制证据。',
  ];
  const boundary = '本方案基于当前已解析表格生成，未执行模型训练、统计检验、图表生成或因果识别；任何结果性结论都需要实际运行和独立核验。';

  const artifactMarkdown = `# 数据处理与 Baseline 方案\n\n## 科研问题\n${input.question.trim()}\n\n## 数据合同\n- 来源：${paper.title}\n- 样本单位：${input.sampleUnit.trim()}\n- 任务类型：${TASK_LABELS[input.taskFamily]}\n- 表格规模：${preview.rowCount} 行 × ${preview.columnCount} 列${preview.sheetName ? `（工作表：${preview.sheetName}）` : ''}\n- 输入字段：${inputColumns.join('、') || '待确认'}\n- 目标列：${input.targetColumn || '未指定'}\n- 分组/时间/批次列：${input.splitColumn || '未指定'}\n\n## 数据质量\n${markdownList(warnings)}\n\n## 切分与泄漏\n- ${splitRule}\n${markdownList(leakageRisks)}\n\n## Baseline 与评估\n- 框架：${recommendation.framework}\n- Baseline：${recommendation.baseline}\n- 指标：${recommendation.metrics.join('、')}\n\n## 可复现步骤\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\n## 边界\n${boundary}\n`;

  return {
    dataset: {
      sourceId: paper.id,
      sourceTitle: paper.title,
      sheetName: preview.sheetName,
      rowCount: preview.rowCount,
      sampledRowCount: preview.sampledRowCount,
      columnCount: preview.columnCount,
      columns: preview.columns,
    },
    contract: {
      scientificQuestion: input.question.trim(),
      sampleUnit: input.sampleUnit.trim(),
      taskFamily: input.taskFamily,
      inputColumns,
      targetColumn: input.targetColumn || undefined,
      splitColumn: input.splitColumn || undefined,
    },
    dataQuality: { warnings },
    recommendation: {
      taskLabel: TASK_LABELS[input.taskFamily],
      ...recommendation,
    },
    split: { rule: splitRule, leakageRisks },
    steps,
    boundary,
    artifactMarkdown,
    artifactFileName: `${safeFileStem(paper.fileName || paper.title)}-data-plan.md`,
  };
}
