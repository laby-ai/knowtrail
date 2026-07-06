'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Send,
  Loader2,
  Sparkles,
  MessageSquare,
  ChevronDown,
  FileSearch,
  Square,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import type { ChatMessage, Citation, CitationAuditResult, RetrievalMetadata } from '@/types';
import { MessageItem } from './MessageItem';
import { QUICK_QUESTIONS, type QuickQuestion } from './quickQuestions';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';

const CHAT_RESPONSE_MAX_TOKENS = 260;
const CHAT_RESPONSE_TIMEOUT_MS = 45_000;

export function EditorPanel() {
  const {
    folders, chatMessages, addChatMessage, updateChatMessage, getSelectedPapers, aiConfig,
    queuedStudioPrompt, consumeStudioPrompt, storageScopeKey, revealPaper,
  } = useApp();

  const [inputMessage, setInputMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const _msgSeq = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const userStoppedRef = useRef(false);
  const selectedSourceCount = getSelectedPapers().length;
  const totalSourceCount = folders.reduce((sum, folder) => sum + folder.papers.length, 0);
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chatMessages]);

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
  const sendQuestion = useCallback(async (question: string) => {
    if (!question.trim() || isGenerating) return;
    const userMsgId = `msg-${Date.now()}-${++_msgSeq.current}`;
    addChatMessage({ id: userMsgId, role: 'user', content: question, timestamp: new Date().toISOString() });

    const selectedPapers = getSelectedPapers();
    if (selectedPapers.length === 0) {
      addChatMessage({ id: `msg-${Date.now()}-${++_msgSeq.current}`, role: 'assistant', content: '请先在左侧资料区选择要分析的来源。', timestamp: new Date().toISOString() });
      return;
    }

    setIsGenerating(true);
    let assistantMsgId: string | null = null;
    let streamedContent = '';
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    userStoppedRef.current = false;
    const timeoutId = window.setTimeout(() => abortController.abort(), CHAT_RESPONSE_TIMEOUT_MS);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        signal: abortController.signal,
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          message: question,
          notebookId,
          aiConfig,
          maxTokens: CHAT_RESPONSE_MAX_TOKENS,
          papers: selectedPapers.map(p => ({
            id: p.id,
            title: p.title, authors: p.authors, year: p.year,
            abstract: p.abstract, content: p.content, rawContent: p.rawContent, shortName: p.shortName,
            fileName: p.fileName, fileType: p.fileType,
          })),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.error === 'string' ? payload.error : 'AI 请求失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';
      assistantMsgId = `msg-${Date.now()}-${++_msgSeq.current}`;
      let serverCitations: Citation[] = [];
      let serverRetrieval: RetrievalMetadata | undefined;
      let serverCitationAudit: CitationAuditResult | undefined;
      addChatMessage({ id: assistantMsgId, role: 'assistant', content: '', timestamp: new Date().toISOString() });

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
              if (payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload);
                if (parsed.error) {
                  throw new Error(String(parsed.error));
                }
                if (parsed.content) {
                  accumulatedContent += parsed.content;
                  streamedContent = accumulatedContent;
                  updateChatMessage(assistantMsgId, { content: accumulatedContent });
                }
                if (Array.isArray(parsed.citations)) {
                  serverCitations = parsed.citations as Citation[];
                  updateChatMessage(assistantMsgId, { citations: serverCitations });
                }
                if (parsed.retrieval) {
                  serverRetrieval = parsed.retrieval as RetrievalMetadata;
                  updateChatMessage(assistantMsgId, { retrieval: serverRetrieval });
                }
                if (parsed.citationAudit) {
                  serverCitationAudit = parsed.citationAudit as CitationAuditResult;
                  updateChatMessage(assistantMsgId, { citationAudit: serverCitationAudit });
                }
              } catch { /* ignore */ }
            }
          }
        }
        if (accumulatedContent) {
          const citations = serverCitations.length > 0
            ? serverCitations
            : selectedPapers.map((p) => ({ paperId: p.id, paperShortName: p.shortName, excerpt: p.abstract || '' }));
          updateChatMessage(assistantMsgId, {
            content: accumulatedContent,
            citations,
            retrieval: serverRetrieval,
            citationAudit: serverCitationAudit,
            followUps: generateFollowUps(question),
          });
        }
      }
      if (!accumulatedContent) {
        updateChatMessage(assistantMsgId, { content: '抱歉，未能获取到 AI 回答，请重试。' });
      }
    } catch (error) {
      const aborted = abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      const stoppedByUser = aborted && userStoppedRef.current;
      const errorMessage = error instanceof Error ? error.message : '';
      const quotaBlocked = /额度|积分|充值|分配|预占|quota|billing/i.test(errorMessage);
      const content = stoppedByUser
        ? '已停止生成。可以换个问法继续提问。'
        : aborted
          ? `真实模型生成超过 ${Math.round(CHAT_RESPONSE_TIMEOUT_MS / 1000)} 秒，已停止等待。上方检索证据已返回，但回答尚未生成完成。请稍后重试，或把问题缩短为更具体的一问。`
          : quotaBlocked
            ? '账号积分不足，请先充值，或联系管理员分配积分后再使用灵笔。'
            : '抱歉，AI 服务暂时不可用，请稍后重试。';
      if (assistantMsgId) {
        // Keep whatever streamed before the user hit stop; only replace if nothing arrived.
        if (stoppedByUser && streamedContent) {
          updateChatMessage(assistantMsgId, { content: `${streamedContent}\n\n*(已停止生成)*` });
        } else {
          updateChatMessage(assistantMsgId, { content });
        }
      } else {
        addChatMessage({ id: `msg-${Date.now()}-${++_msgSeq.current}`, role: 'assistant', content, timestamp: new Date().toISOString() });
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (chatAbortRef.current === abortController) chatAbortRef.current = null;
      setIsGenerating(false);
    }
  }, [isGenerating, addChatMessage, updateChatMessage, getSelectedPapers, aiConfig, notebookId, generateFollowUps]);

  const stopGeneration = useCallback(() => {
    if (!chatAbortRef.current) return;
    userStoppedRef.current = true;
    chatAbortRef.current.abort();
  }, []);

  // Re-ask the question that produced the last assistant answer.
  const regenerateLastAnswer = useCallback(() => {
    if (isGenerating) return;
    const lastUserMessage = [...chatMessages].reverse().find(message => message.role === 'user');
    if (lastUserMessage?.content) void sendQuestion(lastUserMessage.content);
  }, [isGenerating, chatMessages, sendQuestion]);

  useEffect(() => {
    if (!queuedStudioPrompt || isGenerating) return;
    const request = queuedStudioPrompt;
    consumeStudioPrompt(request.id);
    void sendQuestion(request.prompt);
  }, [queuedStudioPrompt, isGenerating, consumeStudioPrompt, sendQuestion]);

  // Generate report directly in chat
  const handleGenerateReport = useCallback(async () => {
    const selectedPapers = getSelectedPapers();
    if (selectedPapers.length === 0) {
      addChatMessage({
        id: `msg-${Date.now()}-${++_msgSeq.current}`,
        role: 'assistant',
        content: '请先在左侧资料区上传或选择来源，再生成资料报告。',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    setIsGenerating(true);

    const reportTitle = selectedPapers.length === 1
      ? `请为《${selectedPapers[0].title}》生成资料综述报告`
      : `请为以下 ${selectedPapers.length} 个资料来源生成综合报告`;

    const userMsgId = `msg-${Date.now()}-${++_msgSeq.current}`;
    addChatMessage({ id: userMsgId, role: 'user', content: reportTitle, timestamp: new Date().toISOString() });

    try {
      const paperObjects = selectedPapers.map((p, i) => ({
        index: i + 1, id: p.id, title: p.title, authors: p.authors, year: p.year,
        abstract: p.abstract, content: p.content, rawContent: p.rawContent,
        shortName: p.shortName, keywords: p.keywords, fileName: p.fileName, fileType: p.fileType,
      }));

      const response = await fetch('/api/ai/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          aiConfig,
          notebookId,
          papers: paperObjects,
          paperList: paperObjects.map((p) => ({ index: p.index, shortName: p.shortName, title: p.title, authors: p.authors, year: p.year })),
        }),
      });

      if (!response.ok) throw new Error('报告生成失败');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let reportText = '';
      const assistantMsgId = `msg-${Date.now()}-${++_msgSeq.current}`;
      addChatMessage({ id: assistantMsgId, role: 'assistant', content: '', timestamp: new Date().toISOString() });

      if (reader) {
        let buffer = '';
        let serverCitations: Citation[] = [];
        let serverRetrieval: RetrievalMetadata | undefined;
        let serverCitationAudit: CitationAuditResult | undefined;
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
              if (payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload);
                if (Array.isArray(parsed.citations)) {
                  serverCitations = parsed.citations as Citation[];
                  updateChatMessage(assistantMsgId, { citations: serverCitations });
                }
                if (parsed.retrieval) {
                  serverRetrieval = parsed.retrieval as RetrievalMetadata;
                  updateChatMessage(assistantMsgId, { retrieval: serverRetrieval });
                }
                if (parsed.citationAudit) {
                  serverCitationAudit = parsed.citationAudit as CitationAuditResult;
                  updateChatMessage(assistantMsgId, { citationAudit: serverCitationAudit });
                }
                if (parsed.content) {
                  reportText += parsed.content;
                  updateChatMessage(assistantMsgId, { content: reportText });
                }
              } catch { /* ignore */ }
            }
          }
        }
        if (reportText) {
          const citations = serverCitations.length > 0
            ? serverCitations
            : selectedPapers.map((p) => ({ paperId: p.id, paperShortName: p.shortName, excerpt: p.abstract || '' }));
          updateChatMessage(assistantMsgId, {
            content: reportText,
            citations,
            retrieval: serverRetrieval,
            citationAudit: serverCitationAudit,
            followUps: generateFollowUps('综述报告'),
          });
        }
      }
      if (!reportText) {
        updateChatMessage(assistantMsgId, { content: '抱歉，报告生成失败，请重试。' });
      }
    } catch {
      addChatMessage({ id: `msg-${Date.now()}-${++_msgSeq.current}`, role: 'assistant', content: '抱歉，报告生成服务暂时不可用，请稍后重试。', timestamp: new Date().toISOString() });
    } finally {
      setIsGenerating(false);
    }
  }, [addChatMessage, updateChatMessage, getSelectedPapers, aiConfig, notebookId, generateFollowUps]);

  const toggleCitation = useCallback((citationId: string) => {
    setExpandedCitations(prev => { const next = new Set(prev); if (next.has(citationId)) next.delete(citationId); else next.add(citationId); return next; });
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <MessageSquare className="h-4 w-4 text-blue-500" />
              资料对话
            </div>
            <p className="mt-1 truncate text-[11px] text-[var(--text-tertiary)]">
              {selectedSourceCount > 0
                ? `已选择 ${selectedSourceCount} 个来源，可以继续提问或生成报告。`
                : totalSourceCount > 0
                  ? `资料库已有 ${totalSourceCount} 个来源，请先选择要分析的资料。`
                  : '先添加资料，再围绕来源提问。'}
            </p>
          </div>
          <button
            type="button"
            data-testid="chat-generate-report"
            onClick={handleGenerateReport}
            disabled={isGenerating || selectedSourceCount === 0}
            aria-label={selectedSourceCount > 0 ? '生成资料报告' : '先选择资料再生成报告'}
            title={selectedSourceCount > 0 ? `基于 ${selectedSourceCount} 个已选资料生成报告` : '请先在左侧资料卡片圆点处选择来源'}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-blue-500/20 bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 transition hover:bg-blue-500 disabled:border-[var(--border-subtle)] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-tertiary)] disabled:shadow-none disabled:cursor-not-allowed"
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {selectedSourceCount > 0 ? '生成报告' : '选择资料'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatView
          messages={chatMessages}
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          onSend={() => sendQuestion(inputMessage)}
          onStop={stopGeneration}
          onQuickQuestion={sendQuestion}
          isGenerating={isGenerating}
          expandedCitations={expandedCitations}
          onToggleCitation={toggleCitation}
          onScrollAreaReady={(node) => { scrollRef.current = node; }}
          quickQuestions={QUICK_QUESTIONS}
          selectedSourceCount={selectedSourceCount}
          totalSourceCount={totalSourceCount}
          onCitationClick={revealPaper}
          onRegenerate={regenerateLastAnswer}
        />
      </div>
    </div>
  );
}

interface ChatViewProps {
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
  onCitationClick: (paperId: string) => void;
  onRegenerate: () => void;
}

function ChatView({ messages, inputMessage, setInputMessage, onSend, onStop, onQuickQuestion, isGenerating, expandedCitations, onToggleCitation, onScrollAreaReady, quickQuestions, selectedSourceCount, totalSourceCount, onCitationClick, onRegenerate }: ChatViewProps) {
  // --- Liquid pull physics ---
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const pathRef = useRef<SVGPathElement>(null);

  const pullDistance = useRef(0);
  const currentPull = useRef(0);
  const velocity = useRef(0);
  const isOpen = useRef(false);
  const [panelOpenState, setPanelOpenState] = useState(false);

  const PANEL_HEIGHT = 200;
  const PULL_THRESHOLD = 80;
  const panelHeightRef = useRef<HTMLDivElement>(null);
  const hasSelectedSources = selectedSourceCount > 0;

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
  }, []);

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
      <div ref={scrollAreaCallbackRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="space-y-6 max-w-2xl mx-auto">
          {messages.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl liquid-glass-inset flex items-center justify-center mx-auto mb-5">
                <MessageSquare className="h-7 w-7 text-[var(--text-tertiary)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">开始资料问答</h3>
              <p className="text-sm text-[var(--text-tertiary)] max-w-xs mx-auto">
                {hasSelectedSources
                  ? `已选择 ${selectedSourceCount} 个资料来源，可以开始问答、对比和证据追溯。`
                  : totalSourceCount > 0
                    ? `资料库已有 ${totalSourceCount} 个来源，请先点选左侧资料卡片的圆点。`
                    : '先上传或粘贴资料，再基于来源内容进行问答、对比和证据追溯。'}
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
                {hasSelectedSources ? `已选 ${selectedSourceCount} 个资料` : '未选择资料'}
              </div>
              <div className="mt-8 grid grid-cols-4 gap-3 max-w-2xl mx-auto">
                {quickQuestions.map((q) => {
                  const Icon = q.icon;
                  return (
                    <button
                      key={q.label}
                      onClick={() => onQuickQuestion(q.question)}
                      disabled={!hasSelectedSources}
                      title={hasSelectedSources ? q.question : '请先在左侧选择资料'}
                      className="quick-question-button liquid-glass-static flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-[13px] font-semibold leading-tight text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:!border-[var(--border-hover)] transition-all disabled:cursor-not-allowed disabled:text-[var(--text-secondary)] disabled:hover:text-[var(--text-secondary)]"
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
                  message={message}
                  isExpanded={expandedCitations.has(message.id)}
                  isPending={isGenerating && idx === messages.length - 1}
                  onToggleExpand={() => onToggleCitation(message.id)}
                  onCitationClick={onCitationClick}
                  onRegenerate={message.role === 'assistant' && idx === messages.length - 1 && !isGenerating ? onRegenerate : undefined}
                />
                {message.role === 'assistant' && message.followUps && message.followUps.length > 0 && !isGenerating && idx === messages.length - 1 && (
                  <div className="flex flex-wrap gap-2 mt-3 ml-12 animate-fade-in">
                    {message.followUps.map((q, qi) => (
                      <button
                        key={qi}
                        onClick={() => onQuickQuestion(q)}
                        className="liquid-glass-chip text-[12px] cursor-pointer"
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
                  <span className="text-sm">正在分析资料...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Liquid pull quick questions panel (only when chat is active) */}
      {messages.length > 0 && (
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
              {quickQuestions.map((q) => {
                const Icon = q.icon;
                return (
                  <button
                    key={q.label}
                    onClick={() => {
                      onQuickQuestion(q.question);
                      closePanel();
                    }}
                    className="quick-question-button liquid-glass-card flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2.5 py-3 text-[12px] font-medium leading-tight text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
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
      <div className="px-6 pb-5 pt-3 border-t border-[var(--border-subtle)]">
        <div className="max-w-3xl mx-auto flex items-end gap-3">
            <textarea
              placeholder={hasSelectedSources ? '输入你的问题...(Shift+Enter 换行)' : '先选择左侧资料来源...'}
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
                  setInputMessage('');
                  (e.target as HTMLTextAreaElement).style.height = 'auto';
                }
              }}
              disabled={isGenerating || !hasSelectedSources}
              aria-label="输入资料问题"
              className="liquid-glass-input min-h-[48px] max-h-[140px] flex-1 resize-none rounded-2xl px-4 py-3 !text-[14px] leading-relaxed"
            />
          {isGenerating ? (
            <button
              onClick={onStop}
              aria-label="停止生成"
              data-testid="chat-stop"
              className="liquid-glass-btn flex h-12 w-[52px] items-center justify-center !rounded-2xl !border-red-400/40 !bg-red-500/10 !text-red-400 hover:!bg-red-500/20"
              title="停止生成"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button onClick={() => { onSend(); setInputMessage(''); }} disabled={!hasSelectedSources || !inputMessage.trim()} aria-label="发送问题" className="liquid-glass-btn flex h-12 w-[52px] items-center justify-center !rounded-2xl !bg-gradient-to-r !from-blue-500 !to-blue-600 hover:!from-blue-400 hover:!to-blue-500 !text-white !border-0 disabled:!from-zinc-500/20 disabled:!to-zinc-500/20 disabled:!text-[var(--text-tertiary)] disabled:cursor-not-allowed">
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
