'use client';

import { ClipboardPaste, FileText, Globe2, Lightbulb, Upload, X } from 'lucide-react';

const SOURCE_EXAMPLES = [
  {
    title: 'AI 课程学习笔记',
    tag: '课程资料',
    body: [
      '课程目标：理解大模型如何帮助我们整理资料、提出问题和复盘结论。',
      '课堂要点：先把资料放进同一个工作本，再围绕来源提出具体问题；回答需要尽量回到原文，并保留可以复核的依据。',
      '待追问问题：哪些建议有原文支持？哪些部分还需要补充资料？这组资料适合生成怎样的学习清单？',
    ].join('\n\n'),
  },
  {
    title: '用户访谈摘录',
    tag: '产品资料',
    body: [
      '访谈场景：一名产品经理每周需要整理会议纪要、客户反馈和竞品材料。',
      '主要痛点：资料分散在多个文档里，复盘时很难回到原始表达；团队讨论时也容易混淆事实和判断。',
      '可用线索：按场景、问题、影响程度和期望结果整理，可以更快生成后续问题、行动清单和汇报摘要。',
    ].join('\n\n'),
  },
  {
    title: '论文精读记录',
    tag: '科研资料',
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
            <p className="mb-2 text-xs font-semibold text-[var(--accent-blue)]">添加来源</p>
            <h3 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">先把资料放进工作台</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              上传文件或粘贴文本后，系统会解析、切片、建立索引。之后问答、语音摘要、资料脉络和课堂都会复用同一组来源。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="liquid-glass-btn !p-2"
            aria-label="关闭添加来源"
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
            <span className="block text-sm font-semibold text-[var(--text-primary)]">上传文件</span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-tertiary)]">支持 PDF、Word、PPT、TXT、图片和表格。</span>
          </button>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4">
            <ClipboardPaste className="mb-4 h-5 w-5 text-emerald-400" />
            <span className="block text-sm font-semibold text-[var(--text-primary)]">粘贴文本</span>
            <input
              value={pastedSourceTitle}
              onChange={(event) => onPasteTitleChange(event.target.value)}
              placeholder="资料标题，可选"
              className="liquid-glass-input mt-3 text-xs"
            />
            <textarea
              value={pastedSourceText}
              onChange={(event) => onPasteTextChange(event.target.value)}
              placeholder="把会议纪要、网页片段或研究笔记粘贴到这里，也可以先点下方示例体验。"
              className="liquid-glass-input mt-2 min-h-24 resize-none text-xs leading-relaxed"
            />
            <button
              type="button"
              onClick={onPasteSubmit}
              disabled={!pastedSourceText.trim()}
              className="liquid-glass-btn-primary mt-3 w-full rounded-xl py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="source-guide-paste-submit"
            >
              添加为资料
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">没有现成资料？先试一个示例</span>
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
            <span className="block text-sm font-semibold text-[var(--text-primary)]">网页资料</span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-tertiary)]">后续会接入网页采集；当前先用上传或粘贴保证来源可审计。</span>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-4">
            <FileText className="mb-4 h-5 w-5 text-violet-400" />
            <span className="block text-sm font-semibold text-[var(--text-primary)]">生成前可检查</span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-tertiary)]">看来源片段数、索引状态和选中来源，再继续问答、摘要或资料脉络。</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-4 py-3 text-sm font-semibold text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:bg-[var(--glass-hover)]"
          data-testid="source-guide-skip"
        >
          先进入工作台
        </button>
      </div>
    </div>
  );
}
