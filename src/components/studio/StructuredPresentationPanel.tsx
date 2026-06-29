'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Presentation,
  BookOpen,
  ImageIcon,
  Layout,
  Lightbulb,
  Sparkles,
  Cpu,
  Download,
  Check,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';
import {
  buildStructuredPresentationOutlineDraft,
  StructuredPresentationOutlineDraft,
  type StructuredPresentationOutlineItem,
} from './StructuredPresentationOutlineDraft';

export function StructuredPresentationPanel() {
  const { getSelectedPapers, aiConfig, storageScopeKey } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressStep, setProgressStep] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pptxUrl, setPptxUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qualityWarning, setQualityWarning] = useState<string | null>(null);
  const [qualitySummary, setQualitySummary] = useState<string | null>(null);
  // Options
  const [institution, setInstitution] = useState<string>('generic');
  const [closingStyle, setClosingStyle] = useState<string>('blue');
  const [presenterName, setPresenterName] = useState<string>('');
  const [advisorName, setAdvisorName] = useState<string>('');
  const [duration, setDuration] = useState<number>(20);
  const [audience, setAudience] = useState<string>('researchers');
  const [speakerNotes, setSpeakerNotes] = useState<boolean>(false);
  const [outlineDraft, setOutlineDraft] = useState<StructuredPresentationOutlineItem[]>([]);
  const [outlineConfirmed, setOutlineConfirmed] = useState(false);
  // MinerU state
  const [mineruStatus, setMineruStatus] = useState<string>('');
  const selectedPapers = getSelectedPapers();
  const hasSelectedPapers = selectedPapers.length > 0;
  const selectedPaperKey = selectedPapers.map(paper => paper.id).join('|');
  const abortControllerRef = useRef<AbortController | null>(null);
  const suggestedOutline = useMemo(
    () => buildStructuredPresentationOutlineDraft(selectedPapers, duration),
    [selectedPaperKey, duration],
  );

  useEffect(() => {
    setOutlineDraft(suggestedOutline);
    setOutlineConfirmed(false);
  }, [suggestedOutline]);

  // User-facing generation stages.
  const PIPELINE_STAGES: StudioJobProgressStage[] = [
    { key: 'discourse', label: '论证分析', icon: BookOpen },
    { key: 'figures', label: '图表匹配', icon: ImageIcon },
    { key: 'planning', label: '大纲规划', icon: Layout },
    { key: 'critic', label: '质量审查', icon: Lightbulb },
    { key: 'refine', label: '优化改进', icon: Sparkles },
    { key: 'building', label: '构建PPTX', icon: Cpu },
    { key: 'exporting', label: '导出文件', icon: Download },
  ];

  const handleGenerate = async () => {
    const papers = getSelectedPapers();
    if (papers.length === 0) {
      setError('请先在左侧资料区选择来源');
      return;
    }
    if (!outlineConfirmed) {
      setError('请先检查并确认下方简报大纲，再生成演示文稿。');
      return;
    }
    setIsGenerating(true);
    setError(null);
    setQualityWarning(null);
    setQualitySummary(null);
    setPptxUrl(null);
    setElapsedSeconds(0);
    setProgressMsg('正在准备结构化简报生成...');
    setProgressStep('discourse');
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Build papers payload with fileUrl/fileType/fileName for MinerU enrichment on backend
    const papersPayload = papers.map(p => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      year: p.year,
      abstract: p.abstract,
      content: p.content,
      rawContent: p.rawContent,
      shortName: p.shortName,
      fileUrl: p.fileUrl,
      fileKey: p.fileKey,
      fileType: p.fileType,
      fileName: p.fileName,
      journal: p.journal,
      doi: p.doi,
      mineruFigures: p.mineruFigures,
      mineruStatus: p.mineruStatus,
    }));

    // Check MinerU figure availability for status display
    let totalFigures = 0;
    for (const p of papers) {
      if (p.fileType === 'pdf') {
        try {
          const res = await fetch(`/api/mineru/extract?paperId=${encodeURIComponent(p.id)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.figures?.length > 0) {
              totalFigures += data.figures.length;
            }
          }
        } catch { /* ignore */ }
      }
    }

    // Show MinerU status
    if (totalFigures > 0) {
      setMineruStatus(`已提取 ${totalFigures} 张资料图表，将插入 PPT`);
    } else {
      setMineruStatus('正在通过 MinerU 提取资料图表，请稍候...');
    }

    const timers: number[] = [];
    try {
      timers.push(window.setInterval(() => {
        setElapsedSeconds(seconds => seconds + 1);
      }, 1000));

      // Simulate progress steps for UX while the backend runs the real long task.
      timers.push(
        window.setTimeout(() => { setProgressStep('figures'); setProgressMsg('正在匹配资料图表与论证结构...'); }, 4000),
        window.setTimeout(() => { setProgressStep('planning'); setProgressMsg('正在规划资料简报大纲...'); }, 8000),
        window.setTimeout(() => { setProgressStep('critic'); setProgressMsg('正在审查报告质量...'); }, 16000),
        window.setTimeout(() => { setProgressStep('refine'); setProgressMsg('正在优化幻灯片结构...'); }, 22000),
        window.setTimeout(() => { setProgressStep('building'); setProgressMsg('正在构建 PPTX 文件...'); }, 28000),
        window.setTimeout(() => { setProgressStep('exporting'); setProgressMsg('正在导出文件...'); }, 34000),
      );

      const res = await fetch('/api/ai/ppt-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          notebookId,
          papers: papersPayload,
          aiConfig,
          institution,
          closingStyle,
          presenterName: presenterName.trim() || undefined,
          advisorName: advisorName.trim() || undefined,
          duration,
          audience,
          speakerNotes,
          outlineDraft,
        }),
        signal: abortController.signal,
      });
      timers.forEach(clearTimeout);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '生成失败');
      }

      // Model observability: keep fallback warnings understandable.
      const llmHeader = res.headers.get('X-LLM-Observability');
      if (llmHeader) {
        try {
          const obs = JSON.parse(decodeURIComponent(llmHeader));
          const fallbackStages: string[] = obs.fallbackStages || [];
          const failedStages: string[] = obs.failedStages || [];
          if (failedStages.length > 0 || fallbackStages.length > 0) {
            const parts: string[] = [];
            if (failedStages.length > 0) parts.push(`生成环节失败: ${failedStages.join(', ')}`);
            if (fallbackStages.length > 0) parts.push(`降级兜底: ${fallbackStages.join(', ')}`);
            console.warn(`[Structured PPT] quality warning: ${parts.join('; ')}`);
            setQualityWarning(`部分环节降级处理：${parts.join('；')}。PPT 已生成，但建议下载后重点检查这些页面。`);
            setQualitySummary(null);
          } else {
            setQualitySummary(`生成完成：${obs.succeeded ?? obs.totalCalls ?? 0}/${obs.totalCalls ?? 0} 个生成环节成功，未触发降级。`);
          }
        } catch { /* ignore parse errors */ }
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPptxUrl(url);
      setProgressMsg('');
      setProgressStep('');
    } catch (e: unknown) {
      const aborted = abortController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError');
      setError(aborted ? '已取消生成，可以调整设置后重新开始。' : e instanceof Error ? e.message : '生成失败');
      setQualityWarning(null);
      setQualitySummary(null);
      setProgressMsg('');
      setProgressStep('');
    } finally {
      timers.forEach(clearTimeout);
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleCancelGenerate = () => {
    if (!isGenerating) return;
    setProgressMsg('正在取消生成...');
    abortControllerRef.current?.abort();
  };

  const handleDownload = () => {
    if (!pptxUrl) return;
    const a = document.createElement('a');
    a.href = pptxUrl;
    a.download = 'academic-presentation.pptx';
    a.click();
  };

  const longTaskHint = elapsedSeconds >= 120
    ? '演示文稿仍在生成，页面会继续等待；如需调整资料或参数，可以取消后重新开始。'
    : elapsedSeconds >= 60
      ? '生成可能持续数分钟，当前请求仍在处理中，不是页面卡死。'
      : '正在整理资料并构建演示文稿，生成期间可以随时取消。';

  const institutions = [
    { value: 'generic', label: '通用（无Logo）' },
    { value: 'ustc', label: '中国科学技术大学' },
    { value: 'ustc-suzhou', label: '中科大苏州研究所' },
    { value: 'ucas', label: '中国科学院大学' },
    { value: 'ipc', label: '中科院物理所' },
  ];

  const closingStyles = [
    { value: 'blue', label: '蓝色简约' },
    { value: 'campus', label: '校园背景' },
    { value: 'calligraphy', label: '书法致谢' },
    { value: 'emblem', label: '校徽徽章' },
  ];

  return (
    <div className="flex-1 flex flex-col items-center p-6 overflow-y-auto" data-testid="academic-ppt-panel">
      {/* Header */}
      <div className="w-full max-w-[420px] text-center mb-5">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 flex items-center justify-center mb-3 mx-auto border border-[var(--glass-border)]" style={{ boxShadow: 'var(--glass-shadow-sm)' }}>
          <Presentation className="w-7 h-7 text-amber-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">结构化资料简报</h3>
        <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
          先检查大纲，再生成可编辑演示文稿<br/>
          支持时长、受众、讲稿和资料图表
        </p>
      </div>

      {/* Options */}
      {!isGenerating && !pptxUrl && (
        <>
        <div className="w-full max-w-[420px] space-y-3 mb-5">
          {/* Institution selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-tertiary)] font-medium pl-0.5">机构标识</label>
            <div className="grid grid-cols-2 gap-1.5">
              {institutions.map((inst) => (
                <button
                  key={inst.value}
                  onClick={() => setInstitution(inst.value)}
                  className={`liquid-glass-chip ${institution === inst.value ? 'selected !text-[var(--accent-cyan)] !border-[var(--accent-cyan)]/30' : ''}`}
                >
                  {inst.label}
                </button>
              ))}
            </div>
          </div>

          {/* Closing style selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-tertiary)] font-medium pl-0.5">致谢页风格</label>
            <div className="grid grid-cols-4 gap-1.5">
              {closingStyles.map((style) => (
                <button
                  key={style.value}
                  onClick={() => setClosingStyle(style.value)}
                  className={`liquid-glass-chip ${closingStyle === style.value ? 'selected !text-[var(--accent-blue)] !border-[var(--accent-blue)]/30' : ''}`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          {/* Presenter & Advisor names */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-tertiary)] font-medium pl-0.5">封面信息（可选）</label>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                value={presenterName}
                onChange={(e) => setPresenterName(e.target.value)}
                placeholder="汇报人姓名"
                className="liquid-glass-input px-3 py-2 text-xs placeholder:text-[var(--text-tertiary)] focus:!border-teal-300/40"
              />
              <input
                type="text"
                value={advisorName}
                onChange={(e) => setAdvisorName(e.target.value)}
                placeholder="指导老师姓名"
                className="liquid-glass-input px-3 py-2 text-xs placeholder:text-[var(--text-tertiary)] focus:!border-teal-300/40"
              />
            </div>
          </div>

      {/* Presentation Duration Slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-[var(--text-tertiary)] font-medium pl-0.5">演讲时长</label>
              <span className="text-xs text-amber-400 font-semibold">{duration} 分钟</span>
            </div>
            <input
              type="range"
              min={5}
              max={40}
              step={5}
              data-testid="academic-ppt-duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full h-1.5 bg-[var(--glass-active)] rounded-full appearance-none cursor-pointer accent-amber-500
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(245,158,11,0.4)] [&::-webkit-slider-thumb]:cursor-pointer
                [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-amber-400 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-quaternary)] px-0.5">
              <span>5 min</span>
              <span>~{Math.round(duration / 1.5)} 页</span>
              <span>40 min</span>
            </div>
          </div>

      {/* Target Audience */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-tertiary)] font-medium pl-0.5">目标受众</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { value: 'researchers', label: '研究人员' },
                { value: 'students', label: '学生' },
                { value: 'industry', label: '业界' },
                { value: 'general', label: '一般听众' },
              ].map((a) => (
                <button
                  key={a.value}
                  onClick={() => setAudience(a.value)}
                  className={`liquid-glass-chip ${audience === a.value ? 'selected !text-[var(--accent-emerald)] !border-[var(--accent-emerald)]/30' : ''}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

      {/* Speaker Notes Toggle */}
          <div className="flex items-center justify-between px-1 py-1">
            <div className="flex flex-col">
              <span className="text-xs text-[var(--text-tertiary)] font-medium">生成演讲稿</span>
              <span className="text-[10px] text-[var(--text-quaternary)]">为每页幻灯片生成口语化讲解备注</span>
            </div>
            <button
              type="button"
              onClick={() => setSpeakerNotes(!speakerNotes)}
              className={`liquid-glass-toggle ${speakerNotes ? 'on' : ''}`}
            >
              <div className="toggle-knob" />
            </button>
          </div>
        </div>

          {hasSelectedPapers && (
            <StructuredPresentationOutlineDraft
              items={outlineDraft}
              confirmed={outlineConfirmed}
              onChange={setOutlineDraft}
              onConfirmChange={setOutlineConfirmed}
              onReset={() => {
                setOutlineDraft(suggestedOutline);
                setOutlineConfirmed(false);
              }}
            />
          )}
        </>
      )}

      {/* MinerU Figure Status */}
      {mineruStatus && (
        <div className="w-full max-w-[420px] mb-3 px-3 py-2 rounded-xl liquid-glass-static flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs text-emerald-400">{mineruStatus}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-red-400 text-xs mb-3 px-4 py-2.5 liquid-glass-static rounded-xl max-w-[420px] text-center !border-red-500/20">{error}</div>
      )}

      {/* Generating state with staged progress */}
      {isGenerating ? (
        <div className="flex flex-col items-center gap-4 max-w-[420px] w-full">
          <StudioJobProgress
            title="结构化 PPT 生成中"
            message={progressMsg || '正在整理资料并构建演示文稿...'}
            stages={PIPELINE_STAGES}
            currentStageKey={progressStep || 'discourse'}
            elapsedSeconds={elapsedSeconds}
            hint={longTaskHint}
            onCancel={handleCancelGenerate}
            testId="academic-ppt-job-progress"
          />
        </div>
      ) : pptxUrl ? (
        /* Success state */
        <div className="flex flex-col gap-3 w-full max-w-[340px]" data-testid="academic-ppt-success">
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl liquid-glass-static !border-emerald-500/20">
            <Check className="w-5 h-5 text-emerald-400" />
            <span className="text-sm text-emerald-400 font-medium">PPT生成完成</span>
          </div>
          {qualitySummary && (
            <div
              data-testid="academic-ppt-quality-summary"
              className="px-4 py-3 rounded-xl liquid-glass-static !border-emerald-500/25 text-emerald-300 text-xs leading-relaxed"
            >
              {qualitySummary}
            </div>
          )}
          {qualityWarning && (
            <div className="px-4 py-3 rounded-xl liquid-glass-static !border-amber-500/25 text-amber-300 text-xs leading-relaxed">
              {qualityWarning}
            </div>
          )}
          <button
            onClick={handleDownload}
            data-testid="academic-ppt-download"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-semibold text-sm transition-all active:scale-[0.97]"
          >
            下载PPT文件
          </button>
          <button
            onClick={() => { setPptxUrl(null); setQualityWarning(null); setQualitySummary(null); }}
            className="w-full py-2.5 rounded-xl liquid-glass-btn hover:bg-[var(--glass-hover)] text-[var(--text-tertiary)] text-sm"
          >
            返回
          </button>
        </div>
      ) : (
        /* Initial state - generate button */
        <button
          onClick={handleGenerate}
          disabled={!hasSelectedPapers}
          data-testid="academic-ppt-generate"
          className="liquid-glass-btn px-8 py-3.5 !rounded-xl !bg-gradient-to-r !from-amber-500 !to-amber-600 hover:!from-amber-400 hover:!to-amber-500 !text-black !font-semibold text-sm !border-0 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:!from-amber-500 disabled:hover:!to-amber-600"
          title={hasSelectedPapers ? outlineConfirmed ? '生成结构化资料简报' : '请先确认简报大纲' : '请先在左侧选择资料'}
        >
          {hasSelectedPapers ? outlineConfirmed ? '生成结构化简报' : '先确认大纲' : '先选择资料'}
        </button>
      )}
    </div>
  );
}
