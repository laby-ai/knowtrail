'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { SavedToolStatus } from '@/components/studio/SavedToolStatus';
import { clientApiPath } from '@/lib/client-api';
import {
  Send,
  Loader2,
  Sparkles,
  MessageSquare,
  ChevronDown,
  Download,
  FileSearch,
  Square,
  Trash2,
  FolderPlus,
  MoreHorizontal,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { useApp } from '@/contexts/AppContext';
import type { ChatMessage, Citation, CitationAuditResult, RetrievalMetadata } from '@/types';
import { MessageItem } from './MessageItem';
import { QUICK_QUESTIONS, type QuickQuestion } from './quickQuestions';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import {
  classifyChatFailure,
  createPendingAssistantMessage,
  findRetryTarget,
  generationUpdate,
  parseChatStreamPayload,
} from '@/lib/chat-generation-lifecycle';
import { useStudioGenerationReadiness } from '@/hooks/use-studio-generation-readiness';
import type { StudioGenerationState } from '@/lib/studio-generation-readiness';
import {
  getResearchChatSkill,
  type ResearchChatSkillId,
} from '@/lib/research-chat-skills';
import { ResearchChatSkillSelector } from './ResearchChatSkillSelector';
import { isResearchToolCall, type ResearchToolCall } from '@/lib/research-agent-contract';

const CHAT_RESPONSE_MAX_TOKENS = 2048;
const CHAT_RESPONSE_TIMEOUT_MS = 180_000;

interface SendQuestionOptions {
  clearDraft?: boolean;
  appendUserMessage?: boolean;
  assistantMessageId?: string;
  skill?: ResearchChatSkillId | null;
}

export function EditorPanel({ compact = false }: { compact?: boolean }) {
  const {
    folders, chatMessages, addChatMessage, updateChatMessage, clearChat, getSelectedPapers, aiConfig,
    queuedStudioPrompt, consumeStudioPrompt, storageScopeKey, revealPaper, chatPersistence,
    sourceReadiness,
  } = useApp();

  const inputMessage = chatPersistence.data.draft;
  const selectedChatSkill = chatPersistence.data.mode;
  const setInputMessage = useCallback((draft: string) => chatPersistence.update(previous => ({ ...previous, draft })), [chatPersistence.update]);
  const setSelectedChatSkill = useCallback((mode: ResearchChatSkillId | null) => chatPersistence.update(previous => ({ ...previous, mode })), [chatPersistence.update]);
  const historyReady = !chatPersistence.loading && !chatPersistence.readFailed && !chatPersistence.conflict;
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const _msgSeq = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const userStoppedRef = useRef(false);
  const selectedSourceCount = getSelectedPapers().length;
  const totalSourceCount = folders.reduce((sum, folder) => sum + folder.papers.length, 0);
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const researchChatReadiness = useStudioGenerationReadiness('researchChat');

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chatMessages]);

  useEffect(() => () => chatAbortRef.current?.abort(), [storageScopeKey]);
  useEffect(() => {
    if (!chatPersistence.loading && !isGenerating) {
      for (const message of chatMessages) if (message.generation?.status === 'pending') updateChatMessage(message.id, { generation: { ...message.generation, status: 'stopped', updatedAt: new Date().toISOString() }, toolCalls: message.toolCalls?.map(call => call.status === 'running' ? { ...call, status: 'failed', error: '上次调用已停止，请重新发送。' } : call) });
    }
  }, [chatMessages, chatPersistence.loading, isGenerating, updateChatMessage]);

  // Generate lightweight follow-up questions after an answer.
  const generateFollowUps = useCallback((lastQuestion: string): string[] => {
    const pools: Record<string, string[]> = {
      method: ['该研究采用了什么实验设计？', '样本量是否足够支撑结论？', '对照组设置是否合理？', '数据收集方法是否可靠？', '统计方法选择是否恰当？'],
      finding: ['最关键的发现是什么？', '结果是否与前人研究一致？', '效应量大小如何？', '有哪些意外发现？', '结果是否具有可重复性？'],
      limitation: ['研究有哪些潜在偏倚？', '样本代表性是否存在问题？', '是否有未控制的混淆变量？', '结论的推广性如何？', '测量工具是否有局限性？'],
      future: ['后续研究可以如何改进？', '有哪些值得深入的方向？', '能否在不同人群中验证？', '技术路线可以如何优化？', '如何解决当前研究的不足？'],
      comparison: ['与同类资料结论有何异同？', '不同方法学路径各有什么优劣？', '领域内是否存在争议？', '这份资料在整体脉络中的位置？', '有哪些相互印证的发现？'],
      application: ['研究结果有何实际应用价值？', '对政策制定有什么启示？', '能否转化为临床或工程实践？', '有哪些潜在的商业化方向？', '对社会有什么影响？'],
    };
    const poolKeys = Object.keys(pools);
    const shuffledPools = poolKeys.sort(() => Math.random() - 0.5).slice(0, 3);
    return shuffledPools.map((key) => {
      const qs = pools[key];
      return qs[Math.floor(Math.random() * qs.length)];
    });
  }, []);

  // Send a message (used by input and quick buttons)
  const sendQuestion = useCallback(async (question: string, options: SendQuestionOptions = {}) => {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || chatAbortRef.current || isGenerating || !historyReady || !researchChatReadiness.ready || !sourceReadiness.ready) return;
    const selectedPapers = getSelectedPapers();
    const abortController = new AbortController(); chatAbortRef.current = abortController; setIsGenerating(true);
    if (!await chatPersistence.flush() || abortController.signal.aborted) { if (chatAbortRef.current === abortController) { chatAbortRef.current = null; setIsGenerating(false); } return; }
    if (options.clearDraft) setInputMessage('');
    if (options.appendUserMessage !== false) {
      const userMsgId = `msg-${Date.now()}-${++_msgSeq.current}`;
      addChatMessage({ id: userMsgId, role: 'user', content: normalizedQuestion, timestamp: new Date().toISOString() });
    }

    setIsGenerating(true);
    const startedAt = new Date().toISOString();
    const assistantMsgId = options.assistantMessageId || `msg-${Date.now()}-${++_msgSeq.current}`;
    const pendingMessage = createPendingAssistantMessage(assistantMsgId, normalizedQuestion, startedAt);
    if (options.assistantMessageId) {
      updateChatMessage(assistantMsgId, {
        content: '',
        toolCalls: [],
        citations: undefined,
        retrieval: undefined,
        citationAudit: undefined,
        followUps: undefined,
        generation: pendingMessage.generation,
        timestamp: startedAt,
      });
    } else {
      addChatMessage(pendingMessage);
    }
    let streamedContent = '';
    let serverError = '';
    const agentCalls = new Map<string, ResearchToolCall>();
    userStoppedRef.current = false;
    const timeoutId = window.setTimeout(() => abortController.abort(), CHAT_RESPONSE_TIMEOUT_MS);

    try {
      const response = await fetch(clientApiPath('/api/agent/chat'), {
        method: 'POST',
        signal: abortController.signal,
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          message: normalizedQuestion,
          notebookId,
          aiConfig,
          maxTokens: CHAT_RESPONSE_MAX_TOKENS,
          skill: options.skill || undefined,
          papers: selectedPapers.map(p => ({ id: p.id })),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        serverError = typeof payload.error === 'string' ? payload.error : 'AI 请求失败';
        throw new Error(serverError);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';
      let serverCitations: Citation[] = [];
      let serverRetrieval: RetrievalMetadata | undefined;
      let serverCitationAudit: CitationAuditResult | undefined;

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const payload = trimmed.slice(6);
              const parsedPayload = parseChatStreamPayload(payload);
              if (parsedPayload.kind === 'done' || parsedPayload.kind === 'ignore') continue;
              if (parsedPayload.kind === 'error') { serverError = parsedPayload.error; throw new Error(serverError); }
              const parsed = parsedPayload.event;
              if (isResearchToolCall(parsed.toolCall)) {
                agentCalls.set(parsed.toolCall.id, parsed.toolCall);
                updateChatMessage(assistantMsgId, { toolCalls: [...agentCalls.values()] });
              }
              if (typeof parsed.content === 'string') {
                  accumulatedContent += parsed.content;
                  streamedContent = accumulatedContent;
                  updateChatMessage(assistantMsgId, { content: accumulatedContent });
              }
              if (typeof parsed.replaceContent === 'string') {
                  accumulatedContent = parsed.replaceContent;
                  streamedContent = accumulatedContent;
                  updateChatMessage(assistantMsgId, { content: accumulatedContent });
              }
              if (Array.isArray(parsed.citations)) {
                  serverCitations = parsed.citations as Citation[];
                  updateChatMessage(assistantMsgId, { citations: serverCitations });
              }
              if (parsed.retrieval && typeof parsed.retrieval === 'object') {
                  serverRetrieval = parsed.retrieval as RetrievalMetadata;
                  updateChatMessage(assistantMsgId, { retrieval: serverRetrieval });
              }
              if (parsed.citationAudit && typeof parsed.citationAudit === 'object') {
                  serverCitationAudit = parsed.citationAudit as CitationAuditResult;
                  updateChatMessage(assistantMsgId, { citationAudit: serverCitationAudit });
              }
            }
          }
        }
        if (accumulatedContent || agentCalls.size) {
          if (!accumulatedContent) accumulatedContent = '工具已在本轮对话中打开。';
          const citations = serverCitations.length > 0
            ? serverCitations
            : [];
          updateChatMessage(assistantMsgId, {
            content: accumulatedContent,
            citations,
            retrieval: serverRetrieval,
            citationAudit: serverCitationAudit,
            followUps: generateFollowUps(normalizedQuestion),
            ...generationUpdate('completed', normalizedQuestion, new Date().toISOString()),
          });
        }
      }
      if (!accumulatedContent) {
        updateChatMessage(assistantMsgId, {
          content: '抱歉，未能获取到 AI 回答，请重试。',
          ...generationUpdate('failed', normalizedQuestion, new Date().toISOString()),
        });
      }
    } catch (error) {
      const aborted = abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      const stoppedByUser = aborted && userStoppedRef.current;
      const errorMessage = error instanceof Error ? error.message : '';
      const failure = classifyChatFailure({ aborted, stoppedByUser, errorMessage, timeoutMs: CHAT_RESPONSE_TIMEOUT_MS });
      const content = stoppedByUser && streamedContent
        ? `${streamedContent}\n\n*(已停止生成)*`
        : !aborted && serverError ? serverError : failure.content;
      updateChatMessage(assistantMsgId, {
        content,
        toolCalls: [...agentCalls.values()].map(call => call.status === 'running' ? { ...call, status: 'failed', error: stoppedByUser ? '本次调用已停止，请检查已保存结果后重试。' : '本次调用未完成，请检查已保存结果后重试。' } : call),
        ...generationUpdate(failure.status, normalizedQuestion, new Date().toISOString()),
      });
    } finally {
      window.clearTimeout(timeoutId);
      if (chatAbortRef.current === abortController) chatAbortRef.current = null;
      if (!abortController.signal.aborted) await chatPersistence.flush();
      setIsGenerating(false);
    }
  }, [historyReady, chatPersistence.flush, isGenerating, researchChatReadiness.ready, sourceReadiness.ready, setInputMessage, addChatMessage, updateChatMessage, getSelectedPapers, aiConfig, notebookId, generateFollowUps]);

  const stopGeneration = useCallback(() => {
    if (!chatAbortRef.current) return;
    userStoppedRef.current = true;
    chatAbortRef.current.abort();
  }, []);

  // Re-ask the question that produced the last assistant answer.
  const regenerateLastAnswer = useCallback(() => {
    if (isGenerating) return;
    const retryTarget = findRetryTarget(chatMessages);
    if (retryTarget) {
      void sendQuestion(retryTarget.question, {
        appendUserMessage: false,
        assistantMessageId: retryTarget.assistantMessageId,
        skill: selectedChatSkill,
      });
    }
  }, [isGenerating, chatMessages, selectedChatSkill, sendQuestion]);

  useEffect(() => {
    if (!queuedStudioPrompt || isGenerating || !historyReady || !researchChatReadiness.ready || !sourceReadiness.ready) return;
    const request = queuedStudioPrompt;
    consumeStudioPrompt(request.id);
    void sendQuestion(request.prompt);
  }, [queuedStudioPrompt, isGenerating, historyReady, researchChatReadiness.ready, sourceReadiness.ready, consumeStudioPrompt, sendQuestion]);

  // Generate report directly in chat
  const submitChatDraft = useCallback(() => {
    const draft = inputMessage.trim() || (selectedChatSkill === 'literature-review' ? '根据当前已选资料撰写文献综述，标注证据与不足。' : '');
    if (!draft) return;
    void sendQuestion(draft, { skill: selectedChatSkill, clearDraft: true });
  }, [inputMessage, selectedChatSkill, sendQuestion]);

  const clearChatSkill = useCallback(() => {
    setSelectedChatSkill(null);
  }, [setSelectedChatSkill]);

  const toggleCitation = useCallback((citationId: string) => {
    setExpandedCitations(prev => { const next = new Set(prev); if (next.has(citationId)) next.delete(citationId); else next.add(citationId); return next; });
  }, []);

  const handleClearChat = useCallback(() => {
    if (chatMessages.length === 0) return;
    if (window.confirm(`清空当前 ${chatMessages.length} 条对话记录?此操作不可撤销。`)) clearChat();
  }, [chatMessages.length, clearChat]);

  const handleExportChat = useCallback(() => {
    if (chatMessages.length === 0) return;
    const lines = chatMessages.map(message => {
      const role = message.role === 'user' ? '**提问**' : '**回答**';
      const citations = message.citations?.length
        ? `\n\n> 引用来源:${message.citations.map(c => c.paperShortName || c.sourceTitle || c.paperId).filter(Boolean).join('、')}`
        : '';
      return `${role}\n\n${message.content}${citations}`;
    });
    const markdown = `# 文献问答记录\n\n导出时间:${new Date().toLocaleString()}\n\n---\n\n${lines.join('\n\n---\n\n')}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `文献问答-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chatMessages]);

  return (
    <div className="quiet-chat h-full flex flex-col">
      {/* Top bar */}
      {compact ? (
        <div className="quiet-chat-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" aria-label="对话操作"><MoreHorizontal size={20} /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleExportChat} disabled={!chatMessages.length}><Download size={16} />导出对话</DropdownMenuItem>
              <DropdownMenuItem onSelect={handleClearChat} disabled={!chatMessages.length}><Trash2 size={16} />清空对话</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : <div className="quiet-chat-header border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <MessageSquare className="h-4 w-4 text-blue-500" />
              文献问答
            </div>
            <p className="mt-1 truncate text-[11px] text-[var(--text-tertiary)]">
              {selectedSourceCount > 0
                ? `已选 ${selectedSourceCount} 份资料`
                : totalSourceCount > 0
                  ? `文献库已有 ${totalSourceCount} 个来源，请先选择要分析的证据来源。`
                  : '先添加文献或实验记录，再围绕证据来源提问。'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {chatMessages.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleExportChat}
                  data-testid="chat-export"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-tertiary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
                  title="导出对话为 Markdown"
                  aria-label="导出对话"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleClearChat}
                  data-testid="chat-clear"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-tertiary)] transition hover:border-red-400/40 hover:text-red-400"
                  title="清空对话记录"
                  aria-label="清空对话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>}

      <div data-testid="chat-save-status"><SavedToolStatus saved={chatPersistence} guest={storageScopeKey.startsWith('guest:')} /></div>
      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatView
          compact={compact}
          messages={chatMessages}
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          onSend={submitChatDraft}
          onStop={stopGeneration}
          onQuickQuestion={(question) => sendQuestion(question, { skill: selectedChatSkill })}
          isGenerating={isGenerating}
          expandedCitations={expandedCitations}
          onToggleCitation={toggleCitation}
          onScrollAreaReady={(node) => { scrollRef.current = node; }}
          quickQuestions={QUICK_QUESTIONS}
          selectedSourceCount={selectedSourceCount}
          totalSourceCount={totalSourceCount}
          researchChatReadiness={historyReady ? researchChatReadiness : { ...researchChatReadiness, ready: false, message: '请先读取已保存对话。' }}
          sourceReadiness={sourceReadiness}
          onCitationClick={revealPaper}
          onRegenerate={regenerateLastAnswer}
          selectedChatSkill={selectedChatSkill}
          onSelectChatSkill={setSelectedChatSkill}
          onClearChatSkill={clearChatSkill}
        />
      </div>
    </div>
  );
}

interface ChatViewProps {
  compact: boolean;
  messages: ChatMessage[];
  inputMessage: string;
  setInputMessage: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onQuickQuestion: (question: string) => void;
  isGenerating: boolean;
  expandedCitations: Set<string>;
  onToggleCitation: (id: string) => void;
  onScrollAreaReady: (node: HTMLDivElement | null) => void;
  quickQuestions: QuickQuestion[];
  selectedSourceCount: number;
  totalSourceCount: number;
  researchChatReadiness: StudioGenerationState;
  sourceReadiness: StudioGenerationState;
  onCitationClick: (paperId: string, citation?: Citation) => void;
  onRegenerate: () => void;
  selectedChatSkill: ResearchChatSkillId | null;
  onSelectChatSkill: (skillId: ResearchChatSkillId) => void;
  onClearChatSkill: () => void;
}

function ChatView({ compact, messages, inputMessage, setInputMessage, onSend, onStop, onQuickQuestion, isGenerating, expandedCitations, onToggleCitation, onScrollAreaReady, quickQuestions, selectedSourceCount, totalSourceCount, researchChatReadiness, sourceReadiness, onCitationClick, onRegenerate, selectedChatSkill, onSelectChatSkill, onClearChatSkill }: ChatViewProps) {
  const { storageScopeKey } = useApp();
  // --- Liquid pull physics ---
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const pathRef = useRef<SVGPathElement>(null);

  const pullDistance = useRef(0);
  const currentPull = useRef(0);
  const velocity = useRef(0);
  const isOpen = useRef(false);
  const [panelOpenState, setPanelOpenState] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const PANEL_HEIGHT = 200;
  const PULL_THRESHOLD = 80;
  const panelHeightRef = useRef<HTMLDivElement>(null);
  const hasSelectedSources = selectedSourceCount > 0;
  const activeChatSkill = getResearchChatSkill(selectedChatSkill);
  const canSubmit = researchChatReadiness.ready && sourceReadiness.ready
    && (Boolean(inputMessage.trim()) || activeChatSkill?.allowsEmptyPrompt === true);
  const visibleQuickQuestions = compact ? quickQuestions.slice(0, 4) : quickQuestions;
  useEffect(() => {
    chatInputRef.current?.focus();
  }, [selectedChatSkill]);
  useEffect(() => {
    const input = chatInputRef.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; }
  }, [inputMessage]);


  // Merge scrollRef with scrollAreaRef
  const scrollAreaCallbackRef = useCallback((node: HTMLDivElement | null) => {
    scrollAreaRef.current = node;
    onScrollAreaReady(node);
  }, [onScrollAreaReady]);

  // Spring physics render loop (single rAF, direct DOM mutations, zero React re-renders)
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const renderLoop = (now: number) => {
      const dt = Math.min((now - lastTime) / 16.667, 3); // normalize to 60fps, cap at 3x
      lastTime = now;

      const target = isOpen.current ? PANEL_HEIGHT : pullDistance.current;

      // Spring physics with delta-time scaling
      const diff = target - currentPull.current;
      velocity.current += diff * 0.14 * dt;   // Tension (stiffer for snappier)
      velocity.current *= Math.pow(0.72, dt);  // Friction (exponential decay)
      currentPull.current += velocity.current * dt;

      // Snap to target when close enough (eliminates micro-oscillation)
      if (Math.abs(diff) < 0.3 && Math.abs(velocity.current) < 0.3) {
        currentPull.current = target;
        velocity.current = 0;
      }

      // Prevent negative
      if (currentPull.current < 0) {
        currentPull.current = 0;
        velocity.current = 0;
      }

      const pull = currentPull.current;

      // Direct DOM: update container height (bypasses React render)
      if (panelHeightRef.current) {
        panelHeightRef.current.style.height = `${Math.max(0, pull)}px`;
      }

      // Direct DOM: draw liquid SVG bezier curve
      if (pathRef.current && containerRef.current) {
        const W = containerRef.current.clientWidth;
        const H = PANEL_HEIGHT;

        const svg = pathRef.current.parentElement;
        if (svg) svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

        let d = '';
        if (isOpen.current) {
          const remain = H - pull;
          d = `M 0,${H} L 0,0 Q ${W / 2},${remain} ${W},0 L ${W},${H} Z`;
        } else if (pull > 0.5) {
          const base = pull * 0.15;
          const peak = pull * 1.6;
          d = `M 0,${H} L 0,${H - base} Q ${W / 2},${H - peak} ${W},${H - base} L ${W},${H} Z`;
        } else {
          d = `M 0,${H} L 0,${H} Q ${W / 2},${H} ${W},${H} L ${W},${H} Z`;
        }
        pathRef.current.setAttribute('d', d);
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // Wheel + touch events on scroll area
  useEffect(() => {
    if (compact) return;
    const scroller = scrollAreaRef.current;
    if (!scroller) return;

    let wheelTimeout: ReturnType<typeof setTimeout>;

    const openPanel = () => {
      isOpen.current = true;
      pullDistance.current = PANEL_HEIGHT;
      setPanelOpenState(true);
    };

    const closePanelFn = () => {
      isOpen.current = false;
      pullDistance.current = 0;
      setPanelOpenState(false);
    };

    const handleWheel = (e: WheelEvent) => {
      if (isOpen.current) {
        // Panel is open: scroll up to close
        if (e.deltaY < 0) {
          if (e.cancelable) e.preventDefault();
          closePanelFn();
        }
        return;
      }

      // Panel is closed: scroll down at bottom to open
      const isAtBottom = Math.ceil(scroller.scrollHeight - scroller.scrollTop) <= scroller.clientHeight + 4;

      if (isAtBottom && e.deltaY > 0) {
        if (e.cancelable) e.preventDefault();

        pullDistance.current += e.deltaY * 0.4;

        if (pullDistance.current > PULL_THRESHOLD) {
          openPanel();
        }

        clearTimeout(wheelTimeout);
        wheelTimeout = setTimeout(() => {
          if (!isOpen.current) pullDistance.current = 0;
        }, 150);
      }
    };

    scroller.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      scroller.removeEventListener('wheel', handleWheel);
      clearTimeout(wheelTimeout);
    };
  }, [compact]);

  // Global wheel listener: any scroll-up closes the panel when open
  useEffect(() => {
    if (!panelOpenState) return;

    const handleGlobalWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        isOpen.current = false;
        pullDistance.current = 0;
        setPanelOpenState(false);
      }
    };
    window.addEventListener('wheel', handleGlobalWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleGlobalWheel);
  }, [panelOpenState]);

  const closePanel = () => {
    isOpen.current = false;
    pullDistance.current = 0;
    setPanelOpenState(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Messages */}
      <div ref={scrollAreaCallbackRef} data-testid="chat-scroll" className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="space-y-6 max-w-2xl mx-auto">
          {messages.length === 0 ? (
            <div
              className={`relative isolate overflow-hidden border border-sky-100/80 bg-[var(--bg-primary)] px-5 text-center shadow-[0_24px_64px_rgba(66,111,150,0.09)] ${
                compact ? 'rounded-[26px] py-10' : 'rounded-[30px] py-16'
              }`}
              data-testid="chat-empty-hero"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-20 bg-cover bg-center"
                style={{ backgroundImage: "url('/assets/research/question-ambient-v1.webp')" }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-white/15 via-white/60 to-white/95"
              />
              <div className={`${compact ? 'h-12 w-12 rounded-xl' : 'h-16 w-16 rounded-2xl'} liquid-glass-inset mx-auto mb-5 flex items-center justify-center`}>
                <MessageSquare className="h-7 w-7 text-[var(--text-tertiary)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">开始文献问答</h3>
              <p className="text-sm text-[var(--text-tertiary)] max-w-xs mx-auto">
                {hasSelectedSources
                  ? `已选择 ${selectedSourceCount} 个证据来源，可以开始问答、对比和证据追溯。`
                  : totalSourceCount > 0
                    ? `文献库已有 ${totalSourceCount} 个来源，请先勾选要使用的资料。`
                    : '先上传论文、实验记录或粘贴研究笔记，再基于证据来源进行问答、对比和证据追溯。'}
              </p>
              <div
                data-testid="chat-source-readiness"
                className={`mx-auto mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium ${
                  hasSelectedSources
                    ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-400/25 bg-amber-500/10 text-amber-300'
                }`}
              >
                <FileSearch className="h-3.5 w-3.5" />
                {hasSelectedSources ? `已选 ${selectedSourceCount} 个证据来源` : '未选择证据来源'}
              </div>
              <div className={`${compact ? 'mt-5 grid-cols-2 gap-2' : 'mt-8 grid-cols-4 gap-3'} mx-auto grid max-w-2xl`}>
                {visibleQuickQuestions.map((q) => {
                  const Icon = q.icon;
                  return (
                    <button
                      key={q.label}
                      onClick={() => onQuickQuestion(q.question)}
                      disabled={!hasSelectedSources || !sourceReadiness.ready || !researchChatReadiness.ready}
                      title={!researchChatReadiness.ready ? researchChatReadiness.message : hasSelectedSources ? q.question : '请先在左侧选择证据来源'}
                      className={`quick-question-button liquid-glass-static flex flex-col items-center justify-center gap-1.5 px-3 text-[13px] font-semibold leading-tight text-[var(--text-secondary)] transition-all hover:!border-[var(--border-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:text-[var(--text-secondary)] disabled:hover:text-[var(--text-secondary)] ${compact ? 'min-h-[52px] rounded-xl py-2' : 'min-h-[64px] rounded-2xl py-3'}`}
                    >
                      <Icon className="h-[19px] w-[19px]" />
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            messages.map((message, idx) => (
              <div key={message.id}>
                <MessageItem
                  compact={compact}
                  message={message}
                  isExpanded={expandedCitations.has(message.id)}
                  isPending={isGenerating && idx === messages.length - 1}
                  onToggleExpand={() => onToggleCitation(message.id)}
                  onCitationClick={onCitationClick}
                  onRegenerate={message.role === 'assistant' && idx === messages.length - 1 && !isGenerating && researchChatReadiness.ready && sourceReadiness.ready ? onRegenerate : undefined}
                />
                {!compact && message.role === 'assistant' && message.followUps && message.followUps.length > 0 && !isGenerating && idx === messages.length - 1 && (
                  <div className="flex flex-wrap gap-2 mt-3 ml-12 animate-fade-in">
                    {message.followUps.map((q, qi) => (
                      <button
                        key={qi}
                        onClick={() => onQuickQuestion(q)}
                        disabled={!hasSelectedSources || !sourceReadiness.ready || !researchChatReadiness.ready}
                        title={!researchChatReadiness.ready ? researchChatReadiness.message : hasSelectedSources ? q : '请先在左侧选择证据来源'}
                        className="liquid-glass-chip text-[12px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          {isGenerating && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex items-start gap-4 animate-fade-in">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Sparkles className="h-4 w-4 text-blue-400" />
              </div>
              <div className="liquid-glass-card px-5 py-4">
                <div className="flex items-center gap-2.5 text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                  <span className="text-sm">正在分析证据来源...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Liquid pull quick questions panel (only when chat is active) */}
      {!compact && messages.length > 0 && (
        <div
          ref={(node: HTMLDivElement | null) => {
            containerRef.current = node;
            panelHeightRef.current = node;
          }}
          className="relative flex-shrink-0 overflow-hidden"
          style={{ height: 0 }}
        >
          {/* SVG liquid shape background */}
          <svg
            className="absolute inset-0 w-full"
            style={{ height: PANEL_HEIGHT }}
            preserveAspectRatio="none"
          >
            <path
              ref={pathRef}
              d={`M 0,${PANEL_HEIGHT} L 0,${PANEL_HEIGHT} Q 0,${PANEL_HEIGHT} 0,${PANEL_HEIGHT} L 0,${PANEL_HEIGHT} Z`}
              fill="transparent"
              style={{
                stroke: 'var(--border-subtle)',
                strokeWidth: 0.5,
              }}
            />
          </svg>

          {/* Content overlay */}
          <div
            className="absolute inset-x-0 top-0 z-10 px-4 pt-2 pb-3"
            style={{ height: PANEL_HEIGHT }}
          >
            {/* Close button row */}
            <div className="flex justify-center mb-2">
              <button
                onClick={closePanel}
                className="w-7 h-7 rounded-full liquid-glass-btn flex items-center justify-center"
              >
                <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              </button>
            </div>

            {/* Quick questions grid */}
            <div className="grid grid-cols-4 gap-2.5 max-w-xl mx-auto">
              {visibleQuickQuestions.map((q) => {
                const Icon = q.icon;
                return (
                  <button
                    key={q.label}
                    onClick={() => {
                      onQuickQuestion(q.question);
                      closePanel();
                    }}
                    disabled={!hasSelectedSources || !sourceReadiness.ready || !researchChatReadiness.ready}
                    title={!researchChatReadiness.ready ? researchChatReadiness.message : hasSelectedSources ? q.question : '请先在左侧选择证据来源'}
                    className="quick-question-button liquid-glass-card flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2.5 py-3 text-[12px] font-medium leading-tight text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    {q.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="quiet-composer-region px-6 pb-5 pt-3 border-t border-[var(--border-subtle)]">
        {!sourceReadiness.ready && <p role="status" data-testid="chat-source-loading" className="px-1 pb-2 text-xs text-[var(--text-secondary)]">{sourceReadiness.message}</p>}
        {!researchChatReadiness.ready && (
          <div data-testid="chat-model-readiness" className="mx-auto mb-2 max-w-3xl rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-200">
            {researchChatReadiness.message}
          </div>
        )}
        {compact && <ResearchChatSkillSelector inline={compact} selectedSkillId={selectedChatSkill} onSelect={onSelectChatSkill} onClear={onClearChatSkill} disabled={isGenerating} />}
        <>
        <div
          data-testid="chat-composer-shell"
          className={`${compact ? 'quiet-composer' : ''} mx-auto w-full rounded-[22px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 shadow-[0_10px_28px_rgba(70,96,128,0.08)] transition focus-within:border-blue-400/55 focus-within:shadow-[0_12px_34px_rgba(59,130,246,0.12)]`}
          data-workspace-skill="false"
        >
          {(
            <textarea
              ref={chatInputRef}
              placeholder={!researchChatReadiness.ready
                ? '文献问答服务配置中...'
                : activeChatSkill?.placeholder || '输入研究问题…'}
              value={inputMessage}
              rows={1}
              onChange={(e) => {
                setInputMessage(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSend();
                  (e.target as HTMLTextAreaElement).style.height = 'auto';
                }
              }}
              disabled={isGenerating || !researchChatReadiness.ready}
              aria-label="输入研究问题"
              className="min-h-[54px] max-h-[140px] w-full resize-none bg-transparent px-3 py-2 text-[14px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          )}

          <div className="flex items-end gap-2 px-1 pb-0.5 pt-1">
            {!compact && <ResearchChatSkillSelector
              selectedSkillId={selectedChatSkill}
              onSelect={onSelectChatSkill}
              onClear={onClearChatSkill}
              disabled={isGenerating}
            />}
            {compact && <ChatSourceSelector disabled={isGenerating} />}
            {isGenerating ? (
              <button
                onClick={onStop}
                aria-label="停止生成"
                data-testid="chat-stop"
                className="liquid-glass-btn flex h-9 w-9 shrink-0 items-center justify-center !rounded-full !border-red-400/40 !bg-red-500/10 !text-red-400 hover:!bg-red-500/20"
                title="停止生成"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={onSend}
                disabled={!canSubmit}
                aria-label={activeChatSkill ? `使用${activeChatSkill.label}发送` : '发送问题'}
                className="liquid-glass-btn flex h-9 w-9 shrink-0 items-center justify-center !rounded-full !border-0 !bg-gradient-to-r !from-blue-500 !to-blue-600 !text-white hover:!from-blue-400 hover:!to-blue-500 disabled:cursor-not-allowed disabled:!from-zinc-500/20 disabled:!to-zinc-500/20 disabled:!text-[var(--text-tertiary)]"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        </>
      </div>
    </div>
  );
}

function ChatSourceSelector({ disabled }: { disabled: boolean }) {
  const { folders, selectedPapers, togglePaperSelection, clearSelection } = useApp();
  const papers = folders.flatMap(folder => folder.papers);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="quiet-chat-sources" data-testid="chat-source-menu" disabled={disabled}>
          <FolderPlus size={19} /><span>已选 {selectedPapers.length} 份资料</span><ChevronDown size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="max-h-80 w-72 overflow-y-auto">
        {papers.map(paper => <DropdownMenuCheckboxItem key={paper.id} checked={selectedPapers.includes(paper.id)} onSelect={event => event.preventDefault()} onCheckedChange={() => togglePaperSelection(paper.id)}><span className="truncate">{paper.title}</span></DropdownMenuCheckboxItem>)}
        {!papers.length && <DropdownMenuItem disabled>请先添加资料</DropdownMenuItem>}
        {selectedPapers.length > 0 && <DropdownMenuItem onSelect={clearSelection}>清除选择</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

