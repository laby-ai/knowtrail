'use client';

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import {
  Send,
  Loader2,
  Sparkles,
  MessageSquare,
  Link as LinkIcon,
  ChevronDown,
  BookOpen,
  Lightbulb,
  Scale,
  TrendingUp,
  AlertTriangle,
  FlaskConical,
  GitCompare,
  FileSearch,
  ThumbsUp,
  Copy,
  Check,
  Clock,
} from 'lucide-react';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { useApp } from '@/contexts/AppContext';
import type { ChatMessage } from '@/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { CHAT_SKILLS } from '@/lib/chat-skills';
import { useResearchPreferences } from '@/components/research/ResearchPreferencesProvider';
import { createPulseScheduler } from '@/lib/pulse-scheduler';

export function EditorPanel() {
  const { preferences } = useResearchPreferences();
  const {
    storageScopeKey, selectedChatSkills, chatMessages, addChatMessage, updateChatMessage, getSelectedPapers,
  } = useApp();

  const [inputMessage, setInputMessage] = useState('');
  useEffect(() => {
    const insert = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (typeof detail === 'string') setInputMessage(current => current ? `${current}\n\n${detail}` : detail);
    };
    window.addEventListener('lingbi:insert-citation', insert);
    return () => window.removeEventListener('lingbi:insert-citation', insert);
  }, []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const _msgSeq = useRef(0);
  const messageQueue = useRef<string[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [queueBubbleVisible, setQueueBubbleVisible] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chatMessages]);

  // Generate contextual follow-up questions
  const generateFollowUps = useCallback((): string[] => {
    const pools: Record<string, string[]> = {
      method: ['该研究采用了什么实验设计？', '样本量是否足够支撑结论？', '对照组设置是否合理？', '数据收集方法是否可靠？', '统计方法选择是否恰当？'],
      finding: ['最关键的发现是什么？', '结果是否与前人研究一致？', '效应量大小如何？', '有哪些意外发现？', '结果是否具有可重复性？'],
      limitation: ['研究有哪些潜在偏倚？', '样本代表性是否存在问题？', '是否有未控制的混淆变量？', '结论的推广性如何？', '测量工具是否有局限性？'],
      future: ['后续研究可以如何改进？', '有哪些值得深入的方向？', '能否在不同人群中验证？', '技术路线可以如何优化？', '如何解决当前研究的不足？'],
      comparison: ['与同类研究结论有何异同？', '不同方法学路径各有什么优劣？', '领域内是否存在争议？', '该研究在学术脉络中的位置？', '有哪些相互印证的发现？'],
      application: ['研究结果有何实际应用价值？', '对政策制定有什么启示？', '能否转化为临床或工程实践？', '有哪些潜在的商业化方向？', '对社会有什么影响？'],
    };
    const poolKeys = Object.keys(pools);
    // Pick 3 random pools, and from each pick 1 random question
    const shuffledPools = poolKeys.sort(() => Math.random() - 0.5).slice(0, 3);
    return shuffledPools.map((key) => {
      const qs = pools[key];
      return qs[Math.floor(Math.random() * qs.length)];
    });
  }, []);

  // Send a message (used by input and quick buttons)
  const sendQuestion = useCallback(async (question: string) => {
    if (!question.trim()) return;

    // If currently generating, queue the message instead
    if (isGenerating) {
      messageQueue.current.push(question.trim());
      setQueueCount(messageQueue.current.length);
      setQueueBubbleVisible(true);
      return;
    }

    const selectedPapers = getSelectedPapers();
    if (selectedPapers.length === 0) {
      addChatMessage({ id: `msg-${Date.now()}-${++_msgSeq.current}`, role: 'assistant', content: '请先在左侧文献库中选择要分析的文献资料。', timestamp: new Date().toISOString() });
      return;
    }

    const userMsgId = `msg-${Date.now()}-${++_msgSeq.current}`;
    addChatMessage({ id: userMsgId, role: 'user', content: question, timestamp: new Date().toISOString() });
    setIsGenerating(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          message: question,
          skills: selectedChatSkills,
          researchMode: preferences.researchMode,
          notebookId: notebookIdFromStorageScopeKey(storageScopeKey),
          papers: selectedPapers.map(p => ({
            id: p.id, title: p.title, authors: p.authors, year: p.year,
            abstract: p.abstract, content: p.content, rawContent: p.rawContent, shortName: p.shortName,
          })),
        }),
      });

      if (!response.ok) throw new Error('AI 请求失败');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';
      const assistantMsgId = `msg-${Date.now()}-${++_msgSeq.current}`;
      addChatMessage({ id: assistantMsgId, role: 'assistant', content: '', timestamp: new Date().toISOString() });

      if (reader) {
        let buffer = '';
        // Create pulse scheduler: buffers tokens, emits in rhythmic pulses
        const pulse = createPulseScheduler({
          emit: (text: string) => updateChatMessage(assistantMsgId, { content: text }),
        });
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
                if (parsed.content) {
                  accumulatedContent += parsed.content;
                  pulse.push(parsed.content);
                }
              } catch { /* ignore */ }
            }
          }
        }
        // Flush remaining buffered content
        pulse.finish();
        if (accumulatedContent) {
          updateChatMessage(assistantMsgId, {
            content: accumulatedContent,
            citations: selectedPapers.map((p) => ({ paperId: p.id, paperShortName: p.shortName, excerpt: p.abstract || '' })),
            followUps: generateFollowUps(),
          });
        }
      }
      if (!accumulatedContent) {
        updateChatMessage(assistantMsgId, { content: '抱歉，未能获取到 AI 回答，请重试。' });
      }
    } catch {
      addChatMessage({ id: `msg-${Date.now()}-${++_msgSeq.current}`, role: 'assistant', content: '抱歉，AI 服务暂时不可用，请稍后重试。', timestamp: new Date().toISOString() });
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, addChatMessage, updateChatMessage, getSelectedPapers, storageScopeKey, selectedChatSkills, generateFollowUps, preferences.researchMode]);

  // Process queued messages when generation finishes
  useEffect(() => {
    if (!isGenerating && messageQueue.current.length > 0) {
      const nextMessage = messageQueue.current.shift()!;
      setQueueCount(messageQueue.current.length);
      if (messageQueue.current.length === 0) {
        // Hide bubble after a short delay
        setTimeout(() => setQueueBubbleVisible(false), 600);
      }
      // Use setTimeout to avoid calling sendQuestion while it's still the previous invocation
      setTimeout(() => sendQuestion(nextMessage), 50);
    }
  }, [isGenerating, sendQuestion]);

  // Generate report directly in chat
  const handleGenerateReport = useCallback(async () => {
    const selectedPapers = getSelectedPapers();
    if (selectedPapers.length === 0) return;
    setIsGenerating(true);

    const reportTitle = selectedPapers.length === 1
      ? `请为《${selectedPapers[0].title}》生成文献综述报告`
      : `请为以下 ${selectedPapers.length} 篇文献生成研究荟萃综述报告`;

    const userMsgId = `msg-${Date.now()}-${++_msgSeq.current}`;
    addChatMessage({ id: userMsgId, role: 'user', content: reportTitle, timestamp: new Date().toISOString() });

    try {
      const paperObjects = selectedPapers.map((p, i) => ({
        id: p.id, index: i + 1, title: p.title, authors: p.authors, year: p.year,
        abstract: p.abstract, content: p.content, rawContent: p.rawContent,
        shortName: p.shortName, keywords: p.keywords,
      }));

      const response = await fetch('/api/ai/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          notebookId: notebookIdFromStorageScopeKey(storageScopeKey),
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
        // Create pulse scheduler for report streaming
        const pulse = createPulseScheduler({
          emit: (text: string) => updateChatMessage(assistantMsgId, { content: text }),
        });
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
                if (parsed.content) {
                  reportText += parsed.content;
                  pulse.push(parsed.content);
                }
              } catch { /* ignore */ }
            }
          }
        }
        // Flush remaining buffered content
        pulse.finish();
        if (reportText) {
          updateChatMessage(assistantMsgId, {
            content: reportText,
            citations: selectedPapers.map((p) => ({ paperId: p.id, paperShortName: p.shortName, excerpt: p.abstract || '' })),
            followUps: generateFollowUps(),
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
  }, [addChatMessage, updateChatMessage, getSelectedPapers, storageScopeKey, selectedChatSkills, generateFollowUps]);

  const toggleCitation = useCallback((citationId: string) => {
    setExpandedCitations(prev => { const next = new Set(prev); if (next.has(citationId)) next.delete(citationId); else next.add(citationId); return next; });
  }, []);

  // Quick question presets
  const QUICK_QUESTIONS = [
    { label: '核心论点', icon: Lightbulb, question: '这些文献的核心论点是什么？' },
    { label: '方法对比', icon: Scale, question: '对比各论文的研究方法差异' },
    { label: '研究发现', icon: TrendingUp, question: '总结这些文献的主要研究发现' },
    { label: '研究局限', icon: AlertTriangle, question: '这些研究存在哪些局限性？' },
    { label: '实验设计', icon: FlaskConical, question: '分析各论文的实验设计与评估方法' },
    { label: '未来方向', icon: BookOpen, question: '基于这些文献，未来研究方向是什么？' },
    { label: '异同对比', icon: GitCompare, question: '这些论文在结论上有何异同？' },
    { label: '关键数据', icon: FileSearch, question: '提取文献中的关键数据与统计结果' },
  ];

  return (
    <div className="h-full w-full min-w-0 flex flex-col">
      {/* Top bar */}
      <div className="px-6 pt-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <MessageSquare className="h-4 w-4 text-blue-400" />
              学术对话
            </div>
            <ThemeToggle />
          </div>
          <button onClick={handleGenerateReport} disabled={isGenerating} className="liquid-glass-btn !bg-gradient-to-r !from-blue-500 !to-blue-600 hover:!from-blue-400 hover:!to-blue-500 !text-white !border-0 text-xs">
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 生成综述报告
          </button>
        </div>
      </div>

      {selectedChatSkills.length > 0 && <div className="flex flex-wrap gap-1.5 px-6 py-2" aria-label="已选分析技能">
        {CHAT_SKILLS.filter(skill => selectedChatSkills.includes(skill.id)).map(skill => <span key={skill.id} className="liquid-glass-chip text-[10px]">{skill.label}</span>)}
      </div>}
      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatView
          messages={chatMessages}
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          onSend={() => sendQuestion(inputMessage)}
          onQuickQuestion={sendQuestion}
          isGenerating={isGenerating}
          expandedCitations={expandedCitations}
          onToggleCitation={toggleCitation}
          scrollRef={scrollRef}
          quickQuestions={QUICK_QUESTIONS}
          queueCount={queueCount}
          queueBubbleVisible={queueBubbleVisible}
        />
      </div>
    </div>
  );
}

// Chat view
interface QuickQuestion {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  question: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  inputMessage: string;
  setInputMessage: (value: string) => void;
  onSend: () => void;
  onQuickQuestion: (question: string) => void;
  isGenerating: boolean;
  expandedCitations: Set<string>;
  onToggleCitation: (id: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  quickQuestions: QuickQuestion[];
  queueCount: number;
  queueBubbleVisible: boolean;
}

function ChatView({ messages, inputMessage, setInputMessage, onSend, onQuickQuestion, isGenerating, expandedCitations, onToggleCitation, scrollRef, quickQuestions, queueCount, queueBubbleVisible }: ChatViewProps) {
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

  // Merge scrollRef with scrollAreaRef
  const scrollAreaCallbackRef = useCallback((node: HTMLDivElement | null) => {
    scrollAreaRef.current = node;
    if (scrollRef) {
      scrollRef.current = node;
    }
  }, [scrollRef]);

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
    <div className="h-full w-full min-w-0 flex flex-col">
      {/* Messages */}
      <div ref={scrollAreaCallbackRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="space-y-6">
          {messages.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl liquid-glass-inset flex items-center justify-center mx-auto mb-5">
                <MessageSquare className="h-7 w-7 text-[var(--text-tertiary)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">开始学术问答</h3>
              <p className="text-sm text-[var(--text-tertiary)] max-w-xs mx-auto">选择左侧文献库中的论文，基于文献内容进行学术问答与对比分析</p>
              <div className="mt-8 grid grid-cols-4 gap-2 max-w-lg mx-auto">
                {quickQuestions.map((q) => {
                  const Icon = q.icon;
                  return (
                    <button
                      key={q.label}
                      onClick={() => onQuickQuestion(q.question)}
                      className="liquid-glass-static flex flex-col items-center gap-1.5 py-3 px-2 text-[11px] text-[var(--text-tertiary)] rounded-xl hover:text-[var(--text-primary)] hover:!border-[var(--border-medium)] transition-all"
                    >
                      <Icon className="h-4 w-4" />
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            messages.map((message, idx) => (
              <div key={message.id}>
                <MessageItem message={message} isExpanded={expandedCitations.has(message.id)} onToggleExpand={() => onToggleCitation(message.id)} isStreaming={isGenerating && message.role === 'assistant' && idx === messages.length - 1} />
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
          {isGenerating && (
            <div className="flex items-start gap-4 animate-fade-in">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Sparkles className="h-4 w-4 text-blue-400" />
              </div>
              <div className="liquid-glass-card px-5 py-4">
                <div className="flex items-center gap-2.5 text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                  <span className="text-sm">正在分析文献...</span>
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
            <div className="grid grid-cols-4 gap-2 max-w-lg mx-auto">
              {quickQuestions.map((q) => {
                const Icon = q.icon;
                return (
                  <button
                    key={q.label}
                    onClick={() => {
                      onQuickQuestion(q.question);
                      closePanel();
                    }}
                    className="liquid-glass-card flex flex-col items-center gap-1.5 py-3 px-2 text-[11px] text-[var(--text-tertiary)] rounded-xl hover:text-[var(--text-primary)] transition-all"
                  >
                    <Icon className="h-4 w-4" />
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
        <div className="max-w-2xl mx-auto flex items-center gap-3 relative">
          <input
            type="text"
            placeholder={isGenerating ? "输入问题加入等待队列..." : "输入你的问题..."}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && inputMessage.trim()) { onSend(); setInputMessage(''); } }}
            className="liquid-glass-input flex-1"
          />
          <button onClick={() => { if (inputMessage.trim()) { onSend(); setInputMessage(''); } }} disabled={!inputMessage.trim()} className="liquid-glass-btn !bg-gradient-to-r !from-blue-500 !to-blue-600 hover:!from-blue-400 hover:!to-blue-500 !text-white !border-0 py-2.5 px-4">
            <Send className="h-4 w-4" />
          </button>

          {/* Queue bubble - Bezier curve spring animation */}
          <div
            className="absolute -top-12 right-0 pointer-events-none"
            style={{
              transform: queueBubbleVisible
                ? 'translateY(0) scale(1)'
                : 'translateY(8px) scale(0.6)',
              opacity: queueBubbleVisible ? 1 : 0,
              transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease',
            }}
          >
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.18))',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(99,102,241,0.25)',
                color: 'var(--text-secondary)',
                boxShadow: '0 4px 16px rgba(99,102,241,0.15), inset 0 1px 1px rgba(255,255,255,0.1)',
              }}
            >
              <Clock className="h-3 w-3 text-indigo-400" />
              <span>{queueCount} 条消息等待中</span>
            </div>
            {/* Bubble tail pointer */}
            <div
              className="mx-auto -mt-px"
              style={{
                width: 0, height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '5px solid rgba(99,102,241,0.25)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Message item
function MessageItem({ message, isExpanded, onToggleExpand, isStreaming }: { message: ChatMessage; isExpanded: boolean; onToggleExpand: () => void; isStreaming: boolean }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const animatedSet = useRef(new WeakSet<Element>());

  // After each DOM update during streaming, animate new block-level elements
  useLayoutEffect(() => {
    const container = streamContainerRef.current;
    if (!container) return;

    let newCount = 0;
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && !animatedSet.current.has(child) && !child.classList.contains('wave-cursor')) {
        animatedSet.current.add(child);
        if (isStreaming) {
          child.classList.add('stream-block-enter');
          child.style.animationDelay = `${newCount * 0.06}s`;
          newCount++;
        }
      }
    }
  }, [message.content, isStreaming]);

  // Reset animation tracking when message id changes
  useEffect(() => {
    animatedSet.current = new WeakSet();
  }, [message.id]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback: do nothing */ }
  };

  return (
    <div className={`flex items-start gap-4 ${isUser ? 'flex-row-reverse' : ''} animate-fade-in-up`}>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
        isUser ? 'liquid-glass-inset' : 'bg-blue-500/10'
      }`}>
        {isUser ? <span className="text-xs font-semibold text-[var(--text-tertiary)]">U</span> : <Sparkles className="h-4 w-4 text-blue-400" />}
      </div>
      <div className={`flex-1 ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block text-left rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed max-w-[85%] relative ${
          isUser
            ? 'liquid-glass-static text-[var(--text-primary)]'
            : 'ai-bubble-gradient text-[var(--text-primary)]'
        }`}>
          <div ref={streamContainerRef}>
            {renderFormattedText(message.content)}
            {isStreaming && <span className="wave-cursor active" />}
          </div>
        </div>

        {/* Action buttons for assistant messages */}
        {!isUser && (
          <div className="flex items-center gap-1 mt-1.5 ml-1">
            <button
              className="p-1.5 rounded-lg text-zinc-600 hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition-all"
              title="点赞"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition-all flex items-center gap-1"
              title="复制"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied && <span className="text-[10px] text-green-400">已复制</span>}
            </button>
          </div>
        )}

        {/* Citations */}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-2">
            <button onClick={onToggleExpand} className="text-[11px] text-zinc-600 hover:text-blue-400 transition-colors flex items-center gap-1">
              <LinkIcon className="h-3 w-3" />
              {isExpanded ? '隐藏来源' : `${message.citations.length} 个引用来源`}
              <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
            {isExpanded && (
              <div className="mt-2 space-y-2 animate-fade-in">
                {message.citations.map((citation, idx) => (
                  <div key={idx} className="bg-black/5 rounded-xl px-4 py-3 border-l-2 border-[var(--accent-blue)]/40">
                    <div className="text-[11px] text-[var(--accent-blue)] font-semibold mb-1">{citation.paperShortName}</div>
                    {citation.excerpt && <p className="text-[11px] text-[var(--text-secondary)] italic leading-relaxed">&ldquo;{citation.excerpt}&rdquo;</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Pre-process content: ensure references are on separate lines
function preprocessReferences(content: string): string {
  // Pattern: detect lines containing multiple inline references like [1] ... [2] ... [3] ...
  // This commonly happens when LLM puts all references on a single line
  return content.replace(
    /^(\s*\[[\d]+\][^\n]*)/gm,
    (line) => {
      // If a line contains multiple [N] patterns (N=1,2,3...), split them
      // Match: [1] text [2] text [3] text  →  [1] text\n[2] text\n[3] text
      const refs = line.split(/\s+(?=\[\d+\])/);
      if (refs.length > 1) {
        return refs.join('\n');
      }
      return line;
    }
  );
}

// Render markdown text with LaTeX math support
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
