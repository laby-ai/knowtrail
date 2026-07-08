'use client';

import { ClipboardPaste, FileText, Globe2, Lightbulb, Upload, X } from 'lucide-react';

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
}: {
  pastedSourceText: string;
  pastedSourceTitle: string;
  onClose: () => void;
  onPasteTextChange: (value: string) => void;
  onPasteTitleChange: (value: string) => void;
  onPasteSubmit: () => void;
  onUpload: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--bg-primary)]/62 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="liquid-glass-card max-h-[92vh] w-[min(560px,100%)] overflow-y-auto rounded-3xl p-6 animate-scale-in"
        onClick={(event) => event.stopPropagation()}
        data-testid="source-guide-modal"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-[var(--accent-blue)]">添加证据来源</p>
            <h3 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">先建立可溯源的文献本</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              上传论文 PDF、实验记录或粘贴文本后，系统会解析、切片、建立索引。之后问答、精读摘要、研究脉络和组会材料都会复用同一组证据来源。
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

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onUpload}
            className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4 text-left transition hover:border-[var(--accent-blue)] hover:bg-[var(--glass-active)]"
            data-testid="source-guide-upload"
          >
            <Upload className="mb-4 h-5 w-5 text-[var(--accent-blue)]" />
            <span className="block text-sm font-semibold text-[var(--text-primary)]">拖入 PDF / 文献</span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-tertiary)]">支持 PDF、Word、PPT、TXT、图片和表格，可用于后续证据溯源。</span>
          </button>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4">
            <ClipboardPaste className="mb-4 h-5 w-5 text-emerald-400" />
            <span className="block text-sm font-semibold text-[var(--text-primary)]">粘贴摘要/记录</span>
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
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">没有现成文献？先试一个科研示例</span>
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
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3 text-left transition hover:border-[var(--accent-blue)] hover:bg-[var(--glass-active)]"
                data-testid={`source-guide-example-${index}`}
              >
                <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">{example.title}</span>
                <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">{example.tag}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4 opacity-75">
            <Globe2 className="mb-4 h-5 w-5 text-cyan-400" />
            <span className="block text-sm font-semibold text-[var(--text-primary)]">网页/预印本文献</span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-tertiary)]">当前先用上传或粘贴保证来源可审计；后续可扩展 DOI、arXiv 或跨库检索。</span>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4">
            <FileText className="mb-4 h-5 w-5 text-violet-400" />
            <span className="block text-sm font-semibold text-[var(--text-primary)]">生成前先看证据</span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-tertiary)]">看来源片段数、索引状态和选中文献，再继续问答、文献速览或研究脉络。</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-4 py-3 text-sm font-semibold text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:bg-[var(--glass-hover)]"
          data-testid="source-guide-skip"
        >
          先进入文献本
        </button>
      </div>
    </div>
  );
}
