'use client';

import { useEffect, useRef, useState } from 'react';
import { clientApiRequest, clientApiDownloadBlob } from '@/lib/client-api';
import type { DataColumnSummary } from '@/lib/data-table-preview';
import type { DataAnalysisMethod, StoredDataAnalysis } from '@/lib/data-analysis-contract';
import type { Paper } from '@/types';

const METHODS: Array<{ id: DataAnalysisMethod; label: string }> = [
  { id: 'auto', label: '根据分组数量推荐' }, { id: 'descriptive', label: '描述统计' }, { id: 'welch-t', label: 'Welch 独立样本 t 检验' },
  { id: 'welch-anova', label: 'Welch 单因素 ANOVA' }, { id: 'linear-regression', label: '简单线性回归' },
];
const format = (value: number | null | undefined) => value == null ? '—' : Number(value.toPrecision(5)).toString();
export function DataExecutionPanel({ source, columns, question, sampleUnit, notebookId, sheetName }: {
  source: Paper | null; columns: DataColumnSummary[]; question: string; sampleUnit: string; notebookId?: string; sheetName?: string;
}) {
  const [method, setMethod] = useState<DataAnalysisMethod>('auto');
  const [target, setTarget] = useState(''); const [group, setGroup] = useState('');
  const [independent, setIndependent] = useState(false);
  const [result, setResult] = useState<StoredDataAnalysis | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [figureUrl, setFigureUrl] = useState('');
  const firstNumeric = columns.find(column => column.type === 'numeric')?.name || '';
  useEffect(() => { controller.current?.abort(); setResult(null); setTarget(firstNumeric); setGroup(''); setIndependent(false); setError(''); }, [source?.id, firstNumeric]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!result) { setFigureUrl(''); return; }
    const url = URL.createObjectURL(new Blob([result.chartSvg], { type: 'image/svg+xml' }));
    setFigureUrl(url); return () => URL.revokeObjectURL(url);
  }, [result]);
  async function execute() {
    if (!source || !notebookId || busy) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setResult(null);
    try {
      const response = await clientApiRequest('/api/data-processing/execute', { method: 'POST', timeoutMs: 120_000, signal: abort.signal,
        body: JSON.stringify({ sourceId: source.id, notebookId, question, sampleUnit, method, targetColumn: target || undefined,
          groupColumn: group || undefined, sheetName, independentObservations: independent }) });
      const payload = await response.json() as { error?: string; data?: StoredDataAnalysis };
      if (!response.ok || !payload.data) throw new Error(payload.error || '统计执行失败。');
      if (!abort.signal.aborted) setResult(payload.data);
    } catch (failure) { setError(abort.signal.aborted ? '已取消统计执行。' : failure instanceof Error ? failure.message : '统计执行失败。'); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  async function download(kind: string, name: string) {
    if (!result) return;
    try {
      const blob = await clientApiDownloadBlob(`/api/data-processing/results/${result.id}?format=${kind}`);
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '结果下载失败。'); }
  }
  return <section className="space-y-3 rounded-xl border border-[var(--glass-border)] p-4" data-testid="data-execution-panel">
    <h3 className="text-sm font-semibold">执行统计分析</h3>
    <p className="text-xs text-[var(--text-secondary)]">读取已上传的原文件，执行 Python 统计脚本，生成灰度论文图表与 Results 草稿。使用上方研究问题和样本单位。</p>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block text-xs">统计方法<select className="liquid-glass-input mt-1" value={method} onChange={event => setMethod(event.target.value as DataAnalysisMethod)} data-testid="analysis-method">{METHODS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="block text-xs">数值型目标列<input className="liquid-glass-input mt-1" list="analysis-column-names" value={target} onChange={event => setTarget(event.target.value)} placeholder="输入原文件中的列名" data-testid="analysis-target" /></label>
      <label className="block text-xs">{method === 'linear-regression' ? '数值型自变量' : '分组列（不分组可留空）'}<input className="liquid-glass-input mt-1" list="analysis-column-names" value={group} onChange={event => setGroup(event.target.value)} data-testid="analysis-group" /></label>
      <datalist id="analysis-column-names">{columns.map(column => <option key={column.name} value={column.name} />)}</datalist>
      <label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={independent} onChange={event => setIndependent(event.target.checked)} className="mt-1" />已确认每行观测独立；不是配对、重复测量或同一对象的多次记录。</label>
    </fieldset>
    <p className="text-xs text-[var(--text-secondary)]">自动建议：不分组为描述统计，两组为 Welch t 检验，三组及以上为 Welch ANOVA。需要复核研究设计与分布条件；分类结局请勿作为连续变量均值检验。</p>
    <button className="liquid-glass-btn w-full px-3 py-3" disabled={busy || !source || !target || !question.trim() || !sampleUnit.trim()} onClick={() => void execute()} data-testid="analysis-execute">{busy ? '正在读取原文件并执行计算…' : '执行并生成统计结果'}</button>
    {busy && <button className="text-xs text-rose-600" onClick={() => controller.current?.abort()}>取消统计执行</button>}
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    {result && <div className="space-y-3" data-testid="analysis-result">
      <p className="text-xs">原文件 {result.sourceRows} 行 · 有效观测 {result.usedRows} 行 · 排除 {result.removedRows} 行</p>
      <p className="text-xs text-[var(--text-secondary)]">分析问题：{result.request.question} · 样本单位：{result.request.sampleUnit}</p>
      {figureUrl && <img src={figureUrl} alt={`${result.targetColumn} 的真实统计图表`} className="w-full rounded-lg border bg-white" />}
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['分组', 'n', '均值', 'SD', '95% CI'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{result.summaries.map(row => <tr key={row.group}><td className="p-2">{row.group}</td><td className="p-2">{row.n}</td><td className="p-2">{format(row.mean)}</td><td className="p-2">{format(row.sd)}</td><td className="p-2">{format(row.ciLow)} — {format(row.ciHigh)}</td></tr>)}</tbody></table></div>
      {result.test && <p className="text-xs">{result.test.name} · 统计量 {format(result.test.statistic)} · p {result.test.pValue === 0 ? '<1e-300' : format(result.test.pValue)}</p>}
      <h4 className="text-xs font-semibold">Results 草稿</h4><p className="whitespace-pre-wrap text-xs leading-relaxed">{result.resultsDraft}</p>
      <ul className="list-disc space-y-1 pl-4 text-xs text-[var(--text-secondary)]">{result.notes.map(note => <li key={note}>{note}</li>)}</ul>
      <div className="grid grid-cols-2 gap-2">{[
        ['figure', 'statistical-figure.svg', '论文图表 SVG'], ['summary', 'statistical-summary.csv', '统计结果 CSV'],
        ['results', 'results-draft.txt', 'Results 草稿'], ['script', 'analyze.py', 'Python 脚本'],
        ['config', 'analysis-config.json', '分析配置'], ['requirements', 'requirements.txt', '依赖版本'],
      ].map(([kind, name, label]) => <button key={kind} onClick={() => void download(kind, name)} className="liquid-glass-btn px-2 py-2 text-xs">{label}</button>)}</div>
      <p className="text-xs text-[var(--text-secondary)]">复现：安装依赖后执行 python analyze.py 原文件.csv analysis-config.json。Excel 可使用同样命令替换文件名。</p>
    </div>}
  </section>;
}
