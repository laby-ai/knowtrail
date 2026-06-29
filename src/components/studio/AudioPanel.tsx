'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Volume2,
  Download,
  Mic,
  Play,
  Pause,
  Loader2,
  Radio,
  Headphones,
  FileSearch,
  BookOpen,
  Check,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { Citation, RetrievalMetadata } from '@/types';
import { StudioJobProgress, type StudioJobProgressStage } from './StudioJobProgress';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';

type PodcastSegmentStatus = {
  index: number;
  status: 'succeeded' | 'failed';
  audioUrl?: string;
  error?: string;
  text?: string;
  provider?: string;
};
const PODCAST_POLL_INTERVAL_MS = 3000;
const PODCAST_MAX_POLL_ATTEMPTS = 100;
const PODCAST_JOB_STAGES: StudioJobProgressStage[] = [
  { key: 'retrieving-context', label: '检索资料上下文', icon: FileSearch },
  { key: 'generating-script', label: '生成双人播客脚本', icon: BookOpen },
  { key: 'synthesizing-audio', label: '合成豆包语音', icon: Headphones },
  { key: 'saving-artifact', label: '保存音频产物', icon: Download },
  { key: 'completed', label: '产物可播放', icon: Check },
];

function PodcastSegmentsPanel({
  segments,
  dialoguePreview,
}: {
  segments: PodcastSegmentStatus[];
  dialoguePreview?: string | null;
}) {
  if (segments.length === 0 && !dialoguePreview) return null;
  const succeeded = segments.filter(segment => segment.status === 'succeeded').length;

  return (
    <div className="liquid-glass-card p-3 space-y-2" data-testid="podcast-segments">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
          <Headphones className="h-3.5 w-3.5" />
          <span>音频分段与脚本证据</span>
        </div>
        {segments.length > 0 && (
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {succeeded}/{segments.length} 已生成
          </span>
        )}
      </div>
      {segments.length > 0 && (
        <div className="space-y-1.5">
          {segments.slice(0, 4).map(segment => (
            <div
              key={`${segment.index}-${segment.status}-${segment.audioUrl || segment.error || ''}`}
              className="rounded-lg border border-[var(--glass-border)] bg-black/5 px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                  片段 {segment.index + 1}
                </span>
                <span className={segment.status === 'succeeded' ? 'text-[10px] text-emerald-300' : 'text-[10px] text-amber-300'}>
                  {segment.status === 'succeeded' ? '已生成' : '待重试'}
                </span>
              </div>
              {segment.error && (
                <p className="mt-1 text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                  {segment.error}
                </p>
              )}
              {segment.text && (
                <p className="mt-1 line-clamp-2 text-[10px] text-[var(--text-quaternary)] leading-relaxed">
                  {segment.text}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {dialoguePreview && (
        <div className="rounded-lg border-l-2 border-purple-400/50 bg-purple-500/10 px-3 py-2">
          <div className="text-[10px] font-semibold text-purple-300">播客脚本预览</div>
          <p className="mt-1 line-clamp-4 text-[10px] text-[var(--text-secondary)] leading-relaxed">
            {dialoguePreview}
          </p>
        </div>
      )}
    </div>
  );
}

export function AudioPanel() {
  const { audioConfig, setAudioConfig, voiceClones, activeVoiceCloneId, setActiveVoiceClone, currentReport, getSelectedPapers, aiConfig, storageScopeKey } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPodcast, setIsGeneratingPodcast] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);
  const [podcastStatus, setPodcastStatus] = useState<string>('');
  const [podcastCitations, setPodcastCitations] = useState<Citation[]>([]);
  const [podcastRetrieval, setPodcastRetrieval] = useState<RetrievalMetadata | null>(null);
  const [podcastSegments, setPodcastSegments] = useState<PodcastSegmentStatus[]>([]);
  const [podcastDialoguePreview, setPodcastDialoguePreview] = useState<string | null>(null);
  const [podcastJobStage, setPodcastJobStage] = useState<string>('retrieving-context');
  const [podcastJobProgress, setPodcastJobProgress] = useState<number | undefined>(undefined);
  const [podcastElapsedSeconds, setPodcastElapsedSeconds] = useState(0);
  const [podcastJobFailed, setPodcastJobFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const podcastAbortControllerRef = useRef<AbortController | null>(null);
  const podcastPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasSelectedPapers = getSelectedPapers().length > 0;

  const buildPodcastErrorMessage = useCallback((payload: unknown, fallback: string) => {
    if (!payload || typeof payload !== 'object') return fallback;
    const data = payload as { error?: string; errorType?: string; requestId?: string; retryable?: boolean; upstreamStatus?: number; dialoguePreview?: string; job?: { error?: { message?: string; type?: string; retryable?: boolean }, artifact?: { meta?: { dialoguePreview?: string } } } };
    const preview = data.dialoguePreview || data.job?.artifact?.meta?.dialoguePreview;
    const parts = [
      data.error || data.job?.error?.message || fallback,
      preview ? '播客脚本已生成，但音频合成未完成。' : '',
      data.errorType || data.job?.error?.type ? `类型：${data.errorType || data.job?.error?.type}` : '',
      data.upstreamStatus ? `上游状态：${data.upstreamStatus}` : '',
      data.requestId ? `请求ID：${data.requestId}` : '',
      (data.retryable ?? data.job?.error?.retryable) === false ? '需要更新配置后再试。' : '可以稍后重试。',
    ].filter(Boolean);
    return parts.join(' ');
  }, []);

  const podcastProgressMessage = useCallback((payload: unknown, fallback: string) => {
    if (!payload || typeof payload !== 'object') return fallback;
    const data = payload as {
      message?: string;
      job?: { stage?: string; progress?: number; message?: string };
    };
    const base = data.message || data.job?.message || fallback;
    const progress = typeof data.job?.progress === 'number' ? ` · ${Math.round(data.job.progress)}%` : '';
    const stage = data.job?.stage && data.job.stage !== 'completed' ? `（${data.job.stage}${progress}）` : progress;
    return `${base}${stage}`;
  }, []);

  const updatePodcastJobProgress = useCallback((payload: unknown, fallbackStage = 'retrieving-context') => {
    if (!payload || typeof payload !== 'object') {
      setPodcastJobStage(fallbackStage);
      setPodcastJobProgress(undefined);
      return;
    }
    const data = payload as {
      status?: string;
      job?: { stage?: string; progress?: number; status?: string };
    };
    const stage = data.job?.stage || fallbackStage;
    setPodcastJobStage(stage === 'queued' ? 'retrieving-context' : stage);
    setPodcastJobProgress(typeof data.job?.progress === 'number' ? data.job.progress : undefined);
    setPodcastJobFailed(data.status === 'failed' || data.job?.status === 'failed');
  }, []);

  useEffect(() => {
    if (!isGeneratingPodcast) return;
    const timer = window.setInterval(() => {
      setPodcastElapsedSeconds(seconds => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isGeneratingPodcast]);

  useEffect(() => () => {
    podcastAbortControllerRef.current?.abort();
    if (podcastPollIntervalRef.current) {
      clearInterval(podcastPollIntervalRef.current);
      podcastPollIntervalRef.current = null;
    }
  }, []);

  // Generate TTS audio from report content
  const handleGenerateTTS = useCallback(async () => {
    setIsGenerating(true);
    try {
      const text = currentReport
        ? currentReport.blocks.filter(b => b.type !== 'heading').map(b => b.content).join('\n').substring(0, 2000)
        : '请先生成报告内容后再生成音频。';

      if (!currentReport) {
        alert('请先生成报告内容');
        setIsGenerating(false);
        return;
      }

      const response = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: audioConfig.voiceId,
          speed: audioConfig.speed,
        }),
      });

      if (!response.ok) throw new Error('TTS 生成失败');

      const data = await response.json();
      if (data.audioUrl) {
        setAudioUrl(data.audioUrl);
      }
    } catch {
      // Fallback to browser speech
      const text = currentReport?.blocks.filter(b => b.type !== 'heading').map(b => b.content).join('\n') || '';
      if ('speechSynthesis' in window && text) {
        const utterance = new SpeechSynthesisUtterance(text.substring(0, 500));
        utterance.lang = 'zh-CN';
        utterance.rate = audioConfig.speed;
        window.speechSynthesis.speak(utterance);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [currentReport, audioConfig]);

  // Generate podcast audio through the configured grounded audio provider.
  const handleGeneratePodcast = useCallback(async () => {
    const selectedPapers = getSelectedPapers();
    if (selectedPapers.length === 0) {
      alert('请先选择资料');
      return;
    }

    setIsGeneratingPodcast(true);
    setPodcastStatus('正在准备播客内容...');
    setPodcastElapsedSeconds(0);
    setPodcastJobStage('retrieving-context');
    setPodcastJobProgress(0);
    setPodcastJobFailed(false);
    setPodcastUrl(null);
    setPodcastCitations([]);
    setPodcastRetrieval(null);
    setPodcastSegments([]);
    setPodcastDialoguePreview(null);
    podcastAbortControllerRef.current?.abort();
    if (podcastPollIntervalRef.current) {
      clearInterval(podcastPollIntervalRef.current);
      podcastPollIntervalRef.current = null;
    }
    const abortController = new AbortController();
    podcastAbortControllerRef.current = abortController;

    try {
      const paperContent = selectedPapers.map((p, i) =>
        `[资料${i + 1}] ${p.shortName}: ${p.title}\n${p.abstract || ''}\n${(p.content || '').substring(0, 1500)}`
      ).join('\n\n');
      const podcastPapers = selectedPapers.map(p => ({
        id: p.id,
        title: p.title,
        authors: p.authors,
        year: p.year,
        shortName: p.shortName,
        fileName: p.fileName,
        fileType: p.fileType,
        abstract: p.abstract,
        content: p.content,
        rawContent: p.rawContent,
      }));

      setPodcastStatus('AI 正在生成播客脚本...');
      setPodcastJobStage('generating-script');
      setPodcastJobProgress(20);

      const response = await fetch('/api/ai/podcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({ content: paperContent, papers: podcastPapers, aiConfig, notebookId }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        if (err && typeof err === 'object') {
          const payload = err as { citations?: unknown; retrieval?: RetrievalMetadata };
          if (Array.isArray(payload.citations)) setPodcastCitations(payload.citations as Citation[]);
          if (payload.retrieval) setPodcastRetrieval(payload.retrieval);
        }
        throw new Error(buildPodcastErrorMessage(err, '播客生成失败'));
      }

      const data = await response.json();
      const initialCitations = Array.isArray(data.citations) ? data.citations as Citation[] : [];
      setPodcastCitations(initialCitations);
      setPodcastRetrieval(data.retrieval || null);
      if (Array.isArray(data.segments)) setPodcastSegments(data.segments as PodcastSegmentStatus[]);
      if (typeof data.dialoguePreview === 'string') setPodcastDialoguePreview(data.dialoguePreview);
      updatePodcastJobProgress(data, data.taskId ? 'synthesizing-audio' : 'generating-script');
      setPodcastStatus(podcastProgressMessage(data, data.taskId ? '播客任务已提交，正在等待音频生成。' : '播客生成中，请稍候...'));

      if (data.taskId) {
        // Poll for result
        let attempts = 0;
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            const statusParams = new URLSearchParams({ taskId: data.taskId });
            if (notebookId) statusParams.set('notebookId', notebookId);
            const statusResp = await fetch(`/api/ai/podcast?${statusParams.toString()}`, {
              headers: accountAuthHeaders(),
              signal: abortController.signal,
            });
            const statusData = await statusResp.json();
            if (!statusResp.ok) {
              throw new Error(statusData.error || '状态查询失败');
            }
            updatePodcastJobProgress(statusData, 'synthesizing-audio');
            const statusAudioUrl = statusData.audioUrl || statusData.artifactUrl || statusData.job?.artifact?.url;
            const normalizedStatus = statusData.status || statusData.job?.status;
            if ((normalizedStatus === 'completed' || normalizedStatus === 'succeeded') && statusAudioUrl) {
              clearInterval(pollInterval);
              podcastPollIntervalRef.current = null;
              if (Array.isArray(statusData.citations)) setPodcastCitations(statusData.citations as Citation[]);
              if (statusData.retrieval) setPodcastRetrieval(statusData.retrieval as RetrievalMetadata);
              if (Array.isArray(statusData.segments)) setPodcastSegments(statusData.segments as PodcastSegmentStatus[]);
              if (typeof statusData.dialoguePreview === 'string') setPodcastDialoguePreview(statusData.dialoguePreview);
              setPodcastJobStage('completed');
              setPodcastJobProgress(100);
              setPodcastUrl(statusAudioUrl);
              setPodcastStatus(statusData.message || '播客已生成!');
              setIsGeneratingPodcast(false);
            } else if (normalizedStatus === 'failed') {
              clearInterval(pollInterval);
              podcastPollIntervalRef.current = null;
              if (Array.isArray(statusData.citations)) setPodcastCitations(statusData.citations as Citation[]);
              if (statusData.retrieval) setPodcastRetrieval(statusData.retrieval as RetrievalMetadata);
              if (Array.isArray(statusData.segments)) setPodcastSegments(statusData.segments as PodcastSegmentStatus[]);
              if (typeof statusData.dialoguePreview === 'string') setPodcastDialoguePreview(statusData.dialoguePreview);
              setPodcastJobFailed(true);
              setPodcastJobStage(statusData.job?.stage || 'synthesizing-audio');
              setPodcastStatus(buildPodcastErrorMessage(statusData, '播客生成失败，请重试'));
              setIsGeneratingPodcast(false);
            } else if (attempts > PODCAST_MAX_POLL_ATTEMPTS) {
              clearInterval(pollInterval);
              podcastPollIntervalRef.current = null;
              setPodcastStatus('生成超时，任务可能仍在后台运行；请稍后重试或重新生成。');
              setPodcastJobFailed(true);
              setIsGeneratingPodcast(false);
            } else {
              const elapsedSeconds = Math.round((attempts * PODCAST_POLL_INTERVAL_MS) / 1000);
              setPodcastStatus(podcastProgressMessage(statusData, `播客生成中... (${elapsedSeconds}s)`));
            }
          } catch (error) {
            clearInterval(pollInterval);
            podcastPollIntervalRef.current = null;
            const message = error instanceof Error ? error.message : '状态查询失败';
            setPodcastJobFailed(!abortController.signal.aborted);
            setPodcastStatus(abortController.signal.aborted ? '已取消生成，可以调整资料后重新开始。' : `${message}，可以稍后重试或重新生成。`);
            setIsGeneratingPodcast(false);
          }
        }, PODCAST_POLL_INTERVAL_MS);
        podcastPollIntervalRef.current = pollInterval;
      } else if (data.audioUrl) {
        setPodcastJobStage('completed');
        setPodcastJobProgress(100);
        setPodcastUrl(data.audioUrl);
        setPodcastStatus(data.message || '播客已生成!');
        setIsGeneratingPodcast(false);
      } else {
        setPodcastStatus(data.message || '播客生成中，请稍后查看');
        setIsGeneratingPodcast(false);
      }
    } catch (error) {
      const aborted = abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      const message = error instanceof Error ? error.message : '播客生成失败，请重试';
      setPodcastJobFailed(!aborted);
      setPodcastStatus(aborted ? '已取消生成，可以调整资料后重新开始。' : message);
      setIsGeneratingPodcast(false);
    } finally {
      if (podcastAbortControllerRef.current === abortController) {
        podcastAbortControllerRef.current = null;
      }
    }
  }, [getSelectedPapers, aiConfig, notebookId, buildPodcastErrorMessage, podcastProgressMessage, updatePodcastJobProgress]);

  const handleCancelPodcast = useCallback(() => {
    if (!isGeneratingPodcast) return;
    setPodcastStatus('正在取消播客生成...');
    podcastAbortControllerRef.current?.abort();
    if (podcastPollIntervalRef.current) {
      clearInterval(podcastPollIntervalRef.current);
      podcastPollIntervalRef.current = null;
    }
    setIsGeneratingPodcast(false);
    setPodcastStatus('已取消生成，可以调整资料后重新开始。');
  }, [isGeneratingPodcast]);

  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  return (
    <div className="space-y-5">
      {/* Podcast Section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Radio className="h-4 w-4 text-purple-400" />
          <p className="section-label">播客音频生成</p>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] mb-3 leading-relaxed">
          基于已选资料生成可播放摘要。
        </p>
        <button
          onClick={handleGeneratePodcast}
          disabled={isGeneratingPodcast || !hasSelectedPapers}
          data-testid="podcast-generate"
          className="w-full py-3 text-xs rounded-xl font-medium transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-purple-300 border border-purple-500/20 hover:from-purple-500/30 hover:to-blue-500/30 hover:border-purple-500/30 disabled:opacity-50"
          title={hasSelectedPapers ? '生成语音摘要' : '请先在左侧选择资料'}
        >
          {isGeneratingPodcast ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成语音摘要中...</>
          ) : !hasSelectedPapers ? (
            <><Headphones className="h-3.5 w-3.5" /> 先选择资料</>
          ) : (
            <><Headphones className="h-3.5 w-3.5" /> 生成语音摘要</>
          )}
        </button>

        {isGeneratingPodcast && (
          <div className="mt-3" data-testid="podcast-loading">
            <StudioJobProgress
              title="语音摘要生成中"
              message={podcastStatus || '正在准备脚本、证据和音频任务...'}
              stages={PODCAST_JOB_STAGES}
              currentStageKey={podcastJobStage || 'retrieving-context'}
              elapsedSeconds={podcastElapsedSeconds}
              progressPercent={podcastJobProgress}
              hint="播客生成可能需要较长时间；脚本、引用和分段会保留，失败后可以根据提示重试。"
              onCancel={handleCancelPodcast}
              testId="podcast-job-progress"
            />
          </div>
        )}

        {podcastStatus && !isGeneratingPodcast && !podcastUrl && (
          <div className="mt-3 space-y-3">
            {podcastJobFailed && (
              <StudioJobProgress
                title="语音摘要生成失败"
                message="脚本或引用证据会尽量保留，请根据下方错误恢复或重试。"
                stages={PODCAST_JOB_STAGES}
                currentStageKey={podcastJobStage || 'synthesizing-audio'}
                progressPercent={podcastJobProgress}
                status="failed"
                error={podcastStatus}
                testId="podcast-job-failed"
              />
            )}
            <div className="liquid-glass-card p-3 text-[11px] text-[var(--text-tertiary)] leading-relaxed" data-testid="podcast-status">
              {podcastStatus}
            </div>
            <PodcastSegmentsPanel segments={podcastSegments} dialoguePreview={podcastDialoguePreview} />
            <StudioEvidenceStatusPanel citations={podcastCitations} retrieval={podcastRetrieval} compact />
          </div>
        )}

        {podcastUrl && (
          <div className="mt-3 space-y-3">
            <div className="liquid-glass-card p-3" data-testid="podcast-player">
              <audio ref={audioRef} src={podcastUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
              <div className="flex items-center gap-3">
                <button onClick={togglePlay} className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 hover:bg-purple-500/30 transition-all">
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
                </button>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--text-primary)] font-medium">资料语音摘要</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    {podcastStatus || 'AI 双人对话讲解'}
                  </p>
                  {podcastSegments.length > 0 && (
                    <p className="mt-1 text-[10px] text-[var(--text-quaternary)]">
                      音频片段：{podcastSegments.filter(segment => segment.status === 'succeeded').length}/{podcastSegments.length} 已生成
                    </p>
                  )}
                </div>
                <a
                  href={podcastUrl}
                  download
                  title="下载语音摘要"
                  data-testid="podcast-download"
                  className="rounded-full p-1 text-[var(--glass-active)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
            <PodcastSegmentsPanel segments={podcastSegments} dialoguePreview={podcastDialoguePreview} />
            <StudioEvidenceStatusPanel citations={podcastCitations} retrieval={podcastRetrieval} compact />
          </div>
        )}
      </div>

      <details className="liquid-glass-card p-3">
        <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-secondary)]">
          高级语音工具
        </summary>
        <div className="mt-4 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Volume2 className="h-4 w-4 text-blue-400" />
              <p className="section-label">单段文字转语音</p>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-[11px] mb-2">
                  <span className="text-[var(--text-tertiary)]">语速</span>
                  <span className="text-[var(--text-quaternary)] font-mono">{audioConfig.speed}x</span>
                </div>
                <input
                  type="range"
                  min={50} max={200} step={10}
                  value={audioConfig.speed * 100}
                  onChange={(e) => setAudioConfig({ speed: Number(e.target.value) / 100 })}
                  className="apple-slider w-full"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <button onClick={handleGenerateTTS} disabled={isGenerating} className="btn-primary flex-1 py-2.5 text-xs">
                {isGenerating ? <><Loader2 className="h-3 w-3 animate-spin" /> 合成中...</> : <><Volume2 className="h-3 w-3" /> 生成讲解音频</>}
              </button>
              {audioUrl && (
                <button onClick={togglePlay} className="btn-secondary py-2.5 px-4 text-xs">
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>

            {audioUrl && (
              <div className="mt-3 liquid-glass-card p-3">
                <audio src={audioUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
                <p className="text-[11px] text-[var(--text-quaternary)]">讲解音频已生成，点击播放试听</p>
              </div>
            )}
          </div>

          <div className="h-px bg-[var(--glass-hover)]" />

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Mic className="h-4 w-4 text-amber-400" />
              <p className="section-label">声音样本</p>
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)] mb-3">可选，不影响默认摘要。</p>
            <button className="btn-secondary w-full py-2.5 text-xs">
              <Mic className="h-3 w-3" /> 上传声音样本
            </button>

            {voiceClones.length > 0 && (
              <div className="mt-3 space-y-2">
                {voiceClones.map(clone => (
                  <button
                    key={clone.id}
                    onClick={() => setActiveVoiceClone(clone.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-xs transition-all duration-300 ${
                      activeVoiceCloneId === clone.id
                        ? 'bg-blue-500/[0.08] border border-blue-500/20 text-[var(--text-primary)]'
                        : 'liquid-glass-card text-[var(--text-quaternary)]'
                    }`}
                  >
                    <Mic className="h-3.5 w-3.5" />
                    <span>{clone.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
