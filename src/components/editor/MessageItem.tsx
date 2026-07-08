'use client';

import { useState } from 'react';
import {
  Sparkles,
  Loader2,
  Link as LinkIcon,
  ChevronDown,
  FileSearch,
  Copy,
  Check,
  CornerUpRight,
  RefreshCw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { ChatMessage, CitationAuditResult, RetrievalMetadata } from '@/types';

export function MessageItem({
  message,
  isExpanded,
  onToggleExpand,
  isPending = false,
  onCitationClick,
  onRegenerate,
}: {
  message: ChatMessage;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isPending?: boolean;
  onCitationClick?: (paperId: string) => void;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === 'user';
  const hasContent = message.content.trim().length > 0;
  const showPending = !isUser && isPending && !hasContent;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is optional in browser sandboxes.
    }
  };

  return (
    <div className={`flex items-start gap-4 ${isUser ? 'flex-row-reverse' : ''} animate-fade-in-up`}>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
        isUser ? 'liquid-glass-inset' : 'bg-blue-500/10'
      }`}>
        {isUser ? <span className="text-xs font-semibold text-[var(--text-tertiary)]">U</span> : <Sparkles className="h-4 w-4 text-blue-400" />}
      </div>
      <div className={`flex-1 ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block text-left rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed max-w-[85%] ${
          isUser
            ? 'liquid-glass-static text-[var(--text-primary)]'
            : 'ai-bubble-gradient text-[var(--text-primary)]'
        }`}>
          {showPending ? (
            <div className="flex items-center gap-2.5 text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-blue)]" />
              <span className="text-sm">正在分析证据来源...</span>
            </div>
          ) : (
            renderFormattedText(message.content)
          )}
        </div>

        {!isUser && hasContent && (
          <div className="flex items-center gap-1 mt-1.5 ml-1">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition-all flex items-center gap-1"
              title="复制"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied && <span className="text-[10px] text-green-400">已复制</span>}
            </button>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                data-testid="chat-regenerate"
                className="p-1.5 rounded-lg text-zinc-600 hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition-all flex items-center gap-1"
                title="重新生成这条回答"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="text-[10px]">重新生成</span>
              </button>
            )}
          </div>
        )}

        {!isUser && (message.retrieval || (message.citationAudit && message.citationAudit.status !== 'none')) && (
          <SourceStatusLine
            retrieval={message.retrieval}
            audit={message.citationAudit}
            citationCount={message.citations?.length || 0}
          />
        )}

        {message.citations && message.citations.length > 0 && (
          <div className="mt-2">
            <button onClick={onToggleExpand} className="text-[11px] text-zinc-600 hover:text-blue-400 transition-colors flex items-center gap-1">
              <LinkIcon className="h-3 w-3" />
              {isExpanded ? '隐藏来源' : `${message.citations.length} 个引用来源`}
              <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
            {isExpanded && (
              <div className="mt-2 space-y-2 animate-fade-in">
                {message.retrieval && (
                  <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)]/70 px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {getReadableRetrievalDetail(message.retrieval)}
                  </div>
                )}
                {message.citations.map((citation, idx) => {
                  const targetPaperId = citation.paperId || citation.sourceId;
                  const clickable = Boolean(targetPaperId && onCitationClick);
                  return (
                    <div
                      key={idx}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => onCitationClick?.(targetPaperId as string) : undefined}
                      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onCitationClick?.(targetPaperId as string); } : undefined}
                      data-testid="chat-citation-item"
                      className={`group bg-black/5 rounded-xl px-4 py-3 border-l-2 border-[var(--accent-blue)]/40 transition-all ${
                        clickable ? 'cursor-pointer hover:bg-blue-500/10 hover:border-[var(--accent-blue)]' : ''
                      }`}
                      title={clickable ? '在左侧文献库中定位这份来源' : undefined}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--accent-blue)] font-semibold mb-1">
                        <span>
                          {citation.paperShortName}
                          {citation.page ? ` · 第 ${citation.page} 页` : ''}
                        </span>
                        {clickable && (
                          <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100">
                            <CornerUpRight className="h-3 w-3" /> 定位来源
                          </span>
                        )}
                      </div>
                      {citation.sourceTitle && (
                        <div className="text-[10px] text-[var(--text-muted)] mb-1">{citation.sourceTitle}</div>
                      )}
                      {citation.excerpt && <p className="text-[11px] text-[var(--text-secondary)] italic leading-relaxed">&ldquo;{citation.excerpt}&rdquo;</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceStatusLine({
  retrieval,
  audit,
  citationCount,
}: {
  retrieval?: RetrievalMetadata;
  audit?: CitationAuditResult;
  citationCount: number;
}) {
  const auditText = getReadableAuditLabel(audit);
  const retrievalText = retrieval ? getReadableRetrievalLabel(retrieval) : undefined;
  const title = [
    audit ? getReadableAuditDetail(audit) : '',
    retrieval ? getReadableRetrievalDetail(retrieval) : '',
  ].filter(Boolean).join('；');

  return (
    <div
      data-testid="message-source-status"
      className="mt-2 flex max-w-[85%] flex-wrap items-center gap-1.5 text-[11px] leading-none text-[var(--text-tertiary)]"
      title={title}
    >
      {audit && audit.status !== 'none' && (
        <span
          data-testid="citation-audit-badge"
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--bg-card)]/55 px-2 py-1"
        >
          <FileSearch className="h-3 w-3 text-[var(--accent-blue)]" />
          {auditText}
        </span>
      )}
      {retrieval && (
        <span
          data-testid="retrieval-badge"
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--bg-card)]/55 px-2 py-1"
        >
          {retrievalText}
        </span>
      )}
      {citationCount > 0 && (
        <span className="inline-flex rounded-full bg-transparent px-1 py-1">
          {citationCount} 个引用
        </span>
      )}
    </div>
  );
}

function getReadableAuditLabel(audit?: CitationAuditResult) {
  if (!audit || audit.status === 'none') return '来源待校验';
  if (audit.status === 'pass') return '来源已校验';
  if (audit.status === 'invalid-markers') return '引用需检查';
  return '引用待补充';
}

function getReadableAuditDetail(audit: CitationAuditResult) {
  if (audit.warning) return audit.warning;
  if (audit.status === 'pass') return `回答中的引用标记已和 ${audit.citationCount} 个来源对应。`;
  if (audit.status === 'invalid-markers') return `有引用编号未匹配到来源：${audit.invalidNumbers.map(number => `[${number}]`).join('、')}`;
  if (audit.status === 'missing-markers') return '回答已找到来源，但正文里还缺少明确引用标记。';
  return '';
}

function getReadableRetrievalLabel(retrieval: RetrievalMetadata) {
  if (retrieval.degraded) return '来源可用，索引完善中';
  if (retrieval.mode === 'persisted-vector') return '已匹配证据索引';
  return '已匹配证据片段';
}

function getReadableRetrievalDetail(retrieval: RetrievalMetadata) {
  if (retrieval.mode === 'persisted-vector' && !retrieval.degraded) {
    return `已从 ${retrieval.vectorIndexedSourceCount || retrieval.persistedSourceCount} 个已索引来源中匹配相关证据片段。`;
  }
  if (retrieval.degraded) {
    return '当前先使用已解析的证据片段回答；来源索引完善后，会自动优先使用更精确的语义匹配。';
  }
  return `已从 ${retrieval.persistedSourceCount} 个来源中匹配相关证据片段。`;
}

function preprocessReferences(content: string): string {
  return content.replace(
    /^(\s*\[[\d]+\][^\n]*)/gm,
    (line) => {
      const refs = line.split(/\s+(?=\[\d+\])/);
      return refs.length > 1 ? refs.join('\n') : line;
    }
  );
}

function renderFormattedText(content: string) {
  const processed = preprocessReferences(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 text-[15px] leading-relaxed">{children}</p>,
        h1: ({ children }) => <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2 mt-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold text-[var(--text-primary)] mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-[15px] font-bold text-[var(--text-primary)] mb-1 mt-2">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc list-outside ml-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-outside ml-4 mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="text-[15px] leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="text-[var(--text-primary)] font-semibold">{children}</strong>,
        em: ({ children }) => <em className="text-[var(--text-secondary)]">{children}</em>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--accent-blue)]/40 pl-3 my-2 text-[var(--text-secondary)] italic">{children}</blockquote>,
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-');
          return isBlock
            ? <code className="block bg-[var(--glass-hover)] rounded-lg p-3 my-2 text-xs font-mono overflow-x-auto">{children}</code>
            : <code className="bg-[var(--glass-active)] px-1.5 py-0.5 rounded text-xs font-mono text-[var(--accent-blue)]">{children}</code>;
        },
        pre: ({ children }) => <pre className="bg-[var(--bg-tertiary)] rounded-lg p-3 my-2 overflow-x-auto text-xs">{children}</pre>,
        a: ({ children, href }) => <a href={href} className="text-[var(--accent-blue)] underline hover:opacity-80" target="_blank" rel="noopener noreferrer">{children}</a>,
        table: ({ children }) => <table className="w-full border-collapse my-2 text-xs">{children}</table>,
        th: ({ children }) => <th className="border border-[var(--border-subtle)] px-2 py-1 bg-[var(--glass-subtle)] text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-[var(--border-subtle)] px-2 py-1">{children}</td>,
        sup: ({ children }) => <sup className="citation-sup ml-0.5 text-[var(--accent-blue)]">{children}</sup>,
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}
