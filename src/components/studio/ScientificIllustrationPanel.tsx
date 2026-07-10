'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextImage from 'next/image';
import { AlertTriangle, Download, Image as ImageIcon, Loader2, Square } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type {
  ScientificIllustrationAspectRatio,
  ScientificIllustrationKind,
} from '@/lib/scientific-illustration-contract';
import type { Paper } from '@/types';

type PanelStatus = 'idle' | 'running' | 'complete' | 'error';

interface ScientificIllustrationResult {
  id: string;
  imageUrl: string;
  downloadUrl: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  bytes: number;
  purpose: string;
  figureKind: ScientificIllustrationKind;
  aspectRatio: ScientificIllustrationAspectRatio;
  sourceLabels: string[];
  createdAt: string;
  reviewRequired: boolean;
  boundary: string;
}

const FIGURE_KINDS: Array<{ id: ScientificIllustrationKind; label: string; desc: string }> = [
  { id: 'conceptual-framework', label: '概念框架', desc: '概念、变量和关系' },
  { id: 'workflow', label: '研究流程', desc: '阶段、输入和输出' },
  { id: 'method-diagram', label: '方法示意', desc: '方法结构和操作路径' },
  { id: 'mechanism-schematic', label: '机制示意', desc: '来源支持的机制关系' },
];
const ASPECT_RATIOS: ScientificIllustrationAspectRatio[] = ['1:1', '4:3', '16:9'];

function toPaperRequest(paper: Paper) {
  return {
    id: paper.id,
    shortName: paper.shortName,
    title: paper.title,
    abstract: paper.abstract,
    content: paper.content || paper.rawContent,
  };
}

function parseLabels(value: string): string[] {
  return value.split(/[，,\n]/).map(label => label.trim()).filter(Boolean).slice(0, 7);
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: string; msg?: string } | null;
  return payload?.error || payload?.msg || `请求失败（HTTP ${response.status}）`;
}

export function ScientificIllustrationPanel() {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const selectedPapers = getSelectedPapers();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const controllerRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef('');
  const [purpose, setPurpose] = useState('');
  const [figureKind, setFigureKind] = useState<ScientificIllustrationKind>('workflow');
  const [aspectRatio, setAspectRatio] = useState<ScientificIllustrationAspectRatio>('16:9');
  const [requiredLabels, setRequiredLabels] = useState('');
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [message, setMessage] = useState('选定来源并说明作图目的后开始。');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScientificIllustrationResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');

  const labels = useMemo(() => parseLabels(requiredLabels), [requiredLabels]);
  const sourceSummary = useMemo(
    () => selectedPapers.slice(0, 3).map(paper => paper.shortName || paper.title).join('、'),
    [selectedPapers],
  );
  const formReady = selectedPapers.length > 0 && purpose.trim().length >= 8 && labels.length <= 6;

  const replacePreviewUrl = useCallback((next: string) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next;
    setPreviewUrl(next);
  }, []);

  useEffect(() => () => {
    controllerRef.current?.abort();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const fetchImageBlob = useCallback(async (url: string, signal?: AbortSignal) => {
    const response = await fetch(url, {
      headers: accountAuthHeaders(),
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error(await readError(response));
    const blob = await response.blob();
    if (!/^image\/(?:png|jpeg|webp)$/i.test(blob.type) || blob.size === 0) {
      throw new Error('服务未返回有效的 PNG、JPEG 或 WebP 图片。');
    }
    return blob;
  }, []);

  const startGeneration = useCallback(async () => {
    if (!formReady || status === 'running') return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 210_000);
    setStatus('running');
    setMessage('正在调用真实图片模型并检查返回文件。');
    setError(null);
    setResult(null);
    replacePreviewUrl('');

    try {
      const response = await fetch('/api/ai/scientific-illustration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          purpose: purpose.trim(),
          figureKind,
          aspectRatio,
          requiredLabels: labels,
          papers: getSelectedPapers().map(toPaperRequest),
          notebookId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { data?: ScientificIllustrationResult };
      if (!payload.data?.imageUrl || !payload.data.downloadUrl) {
        throw new Error('服务未返回可预览和下载的科研示意图。');
      }
      const blob = await fetchImageBlob(payload.data.imageUrl, controller.signal);
      replacePreviewUrl(URL.createObjectURL(blob));
      setResult(payload.data);
      setStatus('complete');
      setMessage('真实图片文件已生成；请复核科学含义、标签和文字后再用于论文或汇报。');
    } catch (requestError) {
      if (controller.signal.aborted) {
        setStatus('idle');
        setMessage(timedOut ? '生成超时，未展示未完成结果。' : '已停止生成，未展示未完成结果。');
      } else {
        setStatus('error');
        setError(requestError instanceof Error ? requestError.message : '科研示意图生成失败。');
        setMessage('本次没有形成可用图片文件。');
      }
    } finally {
      window.clearTimeout(timeout);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [aspectRatio, fetchImageBlob, figureKind, formReady, getSelectedPapers, labels, notebookId, purpose, replacePreviewUrl, status]);

  const downloadImage = useCallback(async () => {
    if (!result) return;
    try {
      const blob = await fetchImageBlob(result.downloadUrl);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `scientific-illustration-${result.id}.${result.mimeType === 'image/jpeg' ? 'jpg' : result.mimeType.split('/')[1]}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '图片下载失败。');
    }
  }, [fetchImageBlob, result]);

  return (
    <div className="space-y-4" data-testid="scientific-illustration-panel">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
          <ImageIcon className="h-4 w-4 text-cyan-300" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">科研绘图</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            生成科研示意图，不是数据图表。不会绘制显著性、坐标数据或真实测量结果。
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-3 text-[11px]">
        <p className="font-semibold text-[var(--text-secondary)]">来源范围</p>
        <p className="mt-1 text-[var(--text-tertiary)]" data-testid="scientific-illustration-source-status">
          {selectedPapers.length > 0 ? `已选 ${selectedPapers.length} 个来源：${sourceSummary}${selectedPapers.length > 3 ? ' 等' : ''}` : '尚未选择来源，请先从文献库勾选。'}
        </p>
      </div>

      <label className="block space-y-2">
        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">图像目的</span>
        <textarea
          data-testid="scientific-illustration-purpose"
          value={purpose}
          onChange={event => setPurpose(event.target.value)}
          rows={3}
          className="apple-textarea w-full"
          placeholder="例如：展示样本进入质控、特征提取和结果复核的研究流程"
        />
      </label>

      <div className="space-y-2">
        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">示意图类型</span>
        <div className="grid grid-cols-2 gap-2">
          {FIGURE_KINDS.map(option => (
            <button
              key={option.id}
              type="button"
              aria-pressed={figureKind === option.id}
              onClick={() => setFigureKind(option.id)}
              className={`rounded-lg border p-2 text-left transition-colors ${figureKind === option.id ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-[var(--border-subtle)] bg-[var(--glass-subtle)]'}`}
            >
              <span className="block text-[11px] font-semibold text-[var(--text-primary)]">{option.label}</span>
              <span className="mt-0.5 block text-[10px] text-[var(--text-tertiary)]">{option.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">画幅</span>
        <div className="grid grid-cols-3 gap-2">
          {ASPECT_RATIOS.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={aspectRatio === option}
              onClick={() => setAspectRatio(option)}
              className={`rounded-lg border px-3 py-2 text-[11px] font-semibold ${aspectRatio === option ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <label className="block space-y-2">
        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">必须标签（最多 6 个）</span>
        <input
          data-testid="scientific-illustration-labels"
          value={requiredLabels}
          onChange={event => setRequiredLabels(event.target.value)}
          className="apple-input w-full"
          placeholder="样本进入，质量控制，特征提取，结果复核"
        />
        {labels.length > 6 && <span className="text-[10px] text-rose-300">必须标签不能超过 6 个。</span>}
      </label>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/5 p-3 text-[11px] text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="scientific-illustration-start"
          onClick={startGeneration}
          disabled={!formReady || status === 'running'}
          className="btn-primary flex-1 py-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'running' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中</> : '生成科研示意图'}
        </button>
        {status === 'running' && (
          <button
            type="button"
            onClick={() => controllerRef.current?.abort()}
            className="btn-secondary px-3"
            aria-label="停止生成"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-[var(--text-quaternary)]" data-testid="scientific-illustration-status">{message}</p>

      {result && previewUrl && (
        <section className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3" data-testid="scientific-illustration-result">
          <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-white">
            <NextImage
              src={previewUrl}
              alt={result.purpose}
              width={result.width || 1600}
              height={result.height || 900}
              unoptimized
              className="h-auto w-full object-contain"
            />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[var(--text-primary)]">{result.purpose}</p>
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                {result.width && result.height ? `${result.width} x ${result.height} · ` : ''}{Math.max(1, Math.round(result.bytes / 1024))} KB · {result.sourceLabels.join('、')}
              </p>
            </div>
            <button
              type="button"
              data-testid="scientific-illustration-download"
              onClick={downloadImage}
              className="btn-secondary shrink-0 px-3 py-2 text-[11px]"
            >
              <Download className="h-3.5 w-3.5" /> 下载图片
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-amber-200/80">{result.boundary}</p>
        </section>
      )}
    </div>
  );
}
