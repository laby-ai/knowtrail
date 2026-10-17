'use client';

import { ClipboardPaste, Globe2, Lightbulb, Loader2, Search, Upload, X } from 'lucide-react';
import { useState } from 'react';

type SourceMode = 'upload' | 'paste' | 'url';

const SOURCE_EXAMPLES = [
  {
    title: '组会文献速览',
    tag: '文献速览',
    body: [
      '研究主题：近期多模态模型在科学图像理解中的应用进展。',
      '文献要点：先把论文和研究笔记放进同一个文献本，再围绕方法、数据集、指标和局限提出具体问题。',
      '待追问问题：哪些结论有原文支持？哪些部分还需要补充证据来源？这组文献适合整理成怎样的组会材料？',
    ].join('\n\n'),
  },
  {
    title: '实验数据分析记录',
    tag: '实验记录',
    body: [
      '实验场景：一组处理前后样本需要整理统计方法、图表和结果描述。',
      '主要问题：数据、图表和实验记录分散在多个文件里，复盘时很难回到原始依据。',
      '可用线索：按实验条件、样本量、统计方法和主要差异整理，后续更容易生成 Results 初稿和图注。',
    ].join('\n\n'),
  },
  {
    title: '论文精读记录',
    tag: '精读摘要',
    body: [
      '研究问题：这篇论文想解决什么问题，为什么重要？',
      '方法摘要：作者使用了哪些数据、模型或实验设计？对照组和评估指标是什么？',
      '主要发现：哪些结论可以直接引用，哪些只是推断？局限和后续方向分别是什么？',
    ].join('\n\n'),
  },
];

export function SourceGuideModal({
  pastedSourceText,
  pastedSourceTitle,
  onClose,
  onPasteTextChange,
  onPasteTitleChange,
  onPasteSubmit,
  onUpload,
  sourceUrl,
  urlState,
  urlError,
  onUrlChange,
  onUrlSubmit,
  onDiscover,
}: {
  pastedSourceText: string;
  pastedSourceTitle: string;
  onClose: () => void;
  onPasteTextChange: (value: string) => void;
  onPasteTitleChange: (value: string) => void;
  onPasteSubmit: () => void;
  onUpload: () => void;
  sourceUrl: string;
  urlState: 'idle' | 'loading';
  urlError: string | null;
  onUrlChange: (value: string) => void;
  onUrlSubmit: () => void;
  onDiscover: () => void;
}) {
  const [activeMode, setActiveMode] = useState<SourceMode>('upload');

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--bg-primary)]/62 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="liquid-glass-card w-[min(620px,100%)] rounded-3xl p-6 animate-scale-in"
        onClick={(event) => event.stopPropagation()}
        data-testid="source-guide-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-guide-title"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-[var(--accent-blue)]">添加证据来源</p>
            <h3 id="source-guide-title" className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">选择一种添加方式</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
              添加后会自动解析并用于问答、引用和研究产物。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="liquid-glass-btn !p-2"
            aria-label="关闭添加证据来源"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="来源类型">
          <button
            type="button"
            onClick={() => setActiveMode('upload')}
            aria-pressed={activeMode === 'upload'}
            className={`flex min-h-16 items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition ${
              activeMode === 'upload'
                ? 'border-[var(--accent-blue)] bg-[var(--glass-active)] text-[var(--text-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
            }`}
            data-testid="source-guide-mode-upload"
          >
            <Upload className="h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
            <span className="text-xs font-semibold sm:text-sm">上传文件</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('paste')}
            aria-pressed={activeMode === 'paste'}
            className={`flex min-h-16 items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition ${
              activeMode === 'paste'
                ? 'border-[var(--accent-blue)] bg-[var(--glass-active)] text-[var(--text-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
            }`}
            data-testid="source-guide-mode-paste"
          >
            <ClipboardPaste className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="text-xs font-semibold sm:text-sm">粘贴文本</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('url')}
            aria-pressed={activeMode === 'url'}
            className={`flex min-h-16 items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition ${
              activeMode === 'url'
                ? 'border-[var(--accent-blue)] bg-[var(--glass-active)] text-[var(--text-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
            }`}
            data-testid="source-guide-mode-url"
          >
            <Globe2 className="h-4 w-4 shrink-0 text-cyan-400" />
            <span className="text-xs font-semibold sm:text-sm">网页链接</span>
          </button>
        </div>

        <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4">
          {activeMode === 'upload' && (
            <button
              type="button"
              onClick={onUpload}
              className="flex min-h-56 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-hover)] bg-[var(--bg-card)] px-6 text-center transition hover:border-[var(--accent-blue)] hover:bg-[var(--glass-active)]"
              data-testid="source-guide-upload"
            >
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[var(--glass-active)]">
                <Upload className="h-5 w-5 text-[var(--accent-blue)]" />
              </span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">选择文件或拖到这里</span>
              <span className="mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--text-tertiary)]">
                支持 PDF、Word、PPT、TXT、图片和表格；上传后会显示解析进度。
              </span>
            </button>
          )}

          {activeMode === 'paste' && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <ClipboardPaste className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">粘贴摘要、实验记录或研究笔记</span>
              </div>
              <input
                value={pastedSourceTitle}
                onChange={(event) => onPasteTitleChange(event.target.value)}
                placeholder="文献或实验记录标题，可选"
                className="liquid-glass-input mt-3 text-xs"
              />
              <textarea
                value={pastedSourceText}
                onChange={(event) => onPasteTextChange(event.target.value)}
                placeholder="把论文摘要、实验记录、网页片段或研究笔记粘贴到这里，也可以先点下方示例体验。"
                className="liquid-glass-input mt-2 min-h-24 resize-none text-xs leading-relaxed"
              />
              <button
                type="button"
                onClick={onPasteSubmit}
                disabled={!pastedSourceText.trim()}
                className="liquid-glass-btn-primary mt-3 w-full rounded-xl py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                data-testid="source-guide-paste-submit"
              >
                加入文献本
              </button>

              <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                <div className="mb-2 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">没有现成内容？填入一个示例</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {SOURCE_EXAMPLES.map((example, index) => (
                    <button
                      key={example.title}
                      type="button"
                      onClick={() => {
                        onPasteTitleChange(example.title);
                        onPasteTextChange(example.body);
                      }}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-left transition hover:border-[var(--accent-blue)] hover:bg-[var(--glass-active)]"
                      data-testid={`source-guide-example-${index}`}
                    >
                      <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">{example.title}</span>
                      <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">{example.tag}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeMode === 'url' && (
            <div data-testid="source-guide-url">
              <div className="flex items-center gap-2">
                <Globe2 className="h-4 w-4 text-cyan-400" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">添加网页链接</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-tertiary)]">
                系统会读取网页正文并保存为可追溯来源，不只保留链接。
              </p>
              <input
                value={sourceUrl}
                onChange={(event) => onUrlChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') onUrlSubmit(); }}
                placeholder="https://example.com/article"
                className="liquid-glass-input mt-4 text-xs"
                aria-label="网页链接"
              />
              {urlError && <p className="mt-2 text-xs leading-relaxed text-red-400">{urlError}</p>}
              <button
                type="button"
                onClick={onUrlSubmit}
                disabled={!sourceUrl.trim() || urlState === 'loading'}
                className="liquid-glass-btn-primary mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-45"
              >
                {urlState === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {urlState === 'loading' ? '正在读取网页' : '读取并加入文献本'}
              </button>
              <button
                type="button"
                onClick={onDiscover}
                className="mt-3 flex w-full items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 text-left transition hover:border-[var(--accent-blue)] hover:bg-[var(--glass-active)]"
                data-testid="source-guide-discover"
              >
                <span>
                  <span className="block text-xs font-semibold text-[var(--text-primary)]">还没有链接？检索学术与网页来源</span>
                  <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">先核验结果，再选择加入文献本</span>
                </span>
                <Search className="h-4 w-4 shrink-0 text-violet-400" />
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-2xl px-4 py-2 text-xs font-semibold text-[var(--text-tertiary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-secondary)]"
          data-testid="source-guide-skip"
        >
          暂不添加
        </button>
      </div>
    </div>
  );
}
