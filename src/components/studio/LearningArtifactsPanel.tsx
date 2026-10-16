'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Layers3,
  ListChecks,
  Loader2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useScopedStudioState } from '@/hooks/use-scoped-studio-state';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { KnowledgeCardData } from '@/lib/knowledge-card-types';
import type { Citation, CitationAuditResult, Paper, RetrievalMetadata } from '@/types';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';

type LearningArtifactsMode = 'flashcards' | 'quiz';
type GenerationStatus = 'idle' | 'running' | 'error';

interface KnowledgeCardsPayload {
  cards?: KnowledgeCardData[];
  citations?: Citation[];
  retrieval?: RetrievalMetadata;
  citationAudit?: CitationAuditResult;
  error?: string;
}

interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

function toPaperRequest(paper: Paper) {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    shortName: paper.shortName,
    fileName: paper.fileName,
    fileType: paper.fileType,
    abstract: paper.abstract || '',
    content: (paper.rawContent || paper.content).slice(0, 8000),
    rawContent: paper.rawContent,
  };
}

function conciseOption(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  const sentence = text.split(/[。！？.!?]/)[0] || text;
  return sentence.length > 72 ? `${sentence.slice(0, 69)}…` : sentence;
}

function buildQuiz(cards: KnowledgeCardData[]): QuizQuestion[] {
  return cards.slice(0, 5).map((card, index) => {
    const correct = conciseOption(card.content);
    const distractors = cards
      .filter((_, cardIndex) => cardIndex !== index)
      .map(item => conciseOption(item.content))
      .filter((option, optionIndex, all) => option && option !== correct && all.indexOf(option) === optionIndex)
      .slice(0, 3);
    const baseOptions = [correct, ...distractors];
    const shift = baseOptions.length ? index % baseOptions.length : 0;
    const options = [...baseOptions.slice(shift), ...baseOptions.slice(0, shift)];
    return {
      id: `${index}-${card.title}`,
      prompt: `以下哪一项最符合“${card.title}”？`,
      options,
      correctIndex: options.indexOf(correct),
      explanation: card.extra || card.content,
    };
  });
}

export function LearningArtifactsPanel({ mode }: { mode: LearningArtifactsMode }) {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const selectedPapers = getSelectedPapers();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const [cards, setCards] = useScopedStudioState<KnowledgeCardData[]>(storageScopeKey, 'learning-artifacts', 'cards', []);
  const [citations, setCitations] = useScopedStudioState<Citation[]>(storageScopeKey, 'learning-artifacts', 'citations', []);
  const [retrieval, setRetrieval] = useScopedStudioState<RetrievalMetadata | null>(storageScopeKey, 'learning-artifacts', 'retrieval', null);
  const [citationAudit, setCitationAudit] = useScopedStudioState<CitationAuditResult | null>(storageScopeKey, 'learning-artifacts', 'citation-audit', null);
  const [cardIndex, setCardIndex] = useScopedStudioState(storageScopeKey, 'learning-artifacts', 'card-index', 0);
  const [quizIndex, setQuizIndex] = useScopedStudioState(storageScopeKey, 'learning-artifacts', 'quiz-index', 0);
  const [answers, setAnswers] = useScopedStudioState<Record<string, number>>(storageScopeKey, 'learning-artifacts', 'quiz-answers', {});
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const questions = useMemo(() => buildQuiz(cards), [cards]);
  const currentCard = cards[Math.min(cardIndex, Math.max(cards.length - 1, 0))];
  const currentQuestion = questions[Math.min(quizIndex, Math.max(questions.length - 1, 0))];
  const answeredCount = Object.keys(answers).length;
  const correctCount = questions.reduce(
    (total, question) => total + (answers[question.id] === question.correctIndex ? 1 : 0),
    0,
  );

  const generate = useCallback(async () => {
    const papers = getSelectedPapers();
    if (papers.length === 0 || status === 'running') return;
    setStatus('running');
    setError(null);
    try {
      const response = await clientApiRequest('/api/ai/knowledge-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          notebookId,
          papers: papers.map(toPaperRequest),
        }),
      });
      const payload = await response.json().catch(() => ({})) as KnowledgeCardsPayload;
      if (!response.ok) throw new Error(payload.error || `学习材料生成失败（HTTP ${response.status}）。`);
      const nextCards = Array.isArray(payload.cards) ? payload.cards : [];
      if (nextCards.length === 0) throw new Error('没有生成可展示的学习材料。');
      setCards(nextCards);
      setCitations(Array.isArray(payload.citations) ? payload.citations : []);
      setRetrieval(payload.retrieval || null);
      setCitationAudit(payload.citationAudit || null);
      setCardIndex(0);
      setQuizIndex(0);
      setAnswers({});
      setStatus('idle');
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : '学习材料暂时不可用，请稍后重试。');
    }
  }, [getSelectedPapers, notebookId, setAnswers, setCardIndex, setCards, setCitationAudit, setCitations, setQuizIndex, setRetrieval, status]);

  const copyCard = useCallback(async () => {
    if (!currentCard) return;
    await navigator.clipboard.writeText(`【${currentCard.category}】${currentCard.title}\n\n${currentCard.content}\n\n${currentCard.extra}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [currentCard]);

  const resetQuiz = useCallback(() => {
    setQuizIndex(0);
    setAnswers({});
  }, [setAnswers, setQuizIndex]);

  const noSources = selectedPapers.length === 0;
  const title = mode === 'flashcards' ? '学习卡' : '测验';
  const Icon = mode === 'flashcards' ? Layers3 : ListChecks;

  return (
    <div className="space-y-4" data-testid={`learning-artifacts-${mode}`}>
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Icon className="h-4 w-4 text-blue-500" />
          {title}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {mode === 'flashcards'
            ? '从已选来源提炼可复习的概念、方法和结论，每张卡片保留引用线索。'
            : '使用同一批来源学习卡进行即时自测，答题不会再次触发内容生成。'}
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
        {noSources
          ? '尚未选择来源。请先在左侧文献本选择论文或资料。'
          : `已选择 ${selectedPapers.length} 个来源；生成内容将保存到当前文献本会话。`}
      </div>

      {cards.length === 0 && status !== 'running' && (
        <button
          type="button"
          data-testid="learning-artifacts-generate"
          onClick={() => void generate()}
          disabled={noSources}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Sparkles className="h-4 w-4" />
          {noSources ? '先选择来源' : mode === 'flashcards' ? '生成学习卡' : '生成测验题目'}
        </button>
      )}

      {status === 'running' && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-8" data-testid="learning-artifacts-loading">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          <p className="text-xs text-[var(--text-secondary)]">正在核对来源并整理学习材料…</p>
        </div>
      )}

      {error && (
        <div className="space-y-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2" data-testid="learning-artifacts-error">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-200">{error}</p>
          </div>
          {!noSources && (
            <button type="button" onClick={() => void generate()} className="rounded-lg border border-rose-400/25 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-200">
              重试
            </button>
          )}
        </div>
      )}

      {mode === 'flashcards' && currentCard && (
        <div className="space-y-3" data-testid="learning-card-result">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-700 dark:text-blue-200">{currentCard.category}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">{cardIndex + 1} / {cards.length}</span>
            </div>
            <h3 className="mt-3 text-sm font-semibold leading-relaxed text-[var(--text-primary)]">{currentCard.title}</h3>
            <p className="mt-2 text-[11px] leading-6 text-[var(--text-secondary)]">{currentCard.content}</p>
            {currentCard.extra && <p className="mt-3 rounded-xl bg-[var(--glass-subtle)] px-3 py-2 text-[10px] leading-relaxed text-[var(--text-tertiary)]">{currentCard.extra}</p>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setCardIndex((cardIndex - 1 + cards.length) % cards.length)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)]" aria-label="上一张学习卡"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => void copyCard()} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]"><Copy className="h-3.5 w-3.5" />{copied ? '已复制' : '复制卡片'}</button>
            <button type="button" onClick={() => setCardIndex((cardIndex + 1) % cards.length)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)]" aria-label="下一张学习卡"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {mode === 'quiz' && currentQuestion && (
        <div className="space-y-3" data-testid="learning-quiz-question">
          <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
            <span>第 {quizIndex + 1} / {questions.length} 题</span>
            <span>已答 {answeredCount} · 答对 {correctCount}</span>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
            <h3 className="text-sm font-semibold leading-relaxed text-[var(--text-primary)]">{currentQuestion.prompt}</h3>
            <div className="mt-3 space-y-2">
              {currentQuestion.options.map((option, optionIndex) => {
                const selected = answers[currentQuestion.id] === optionIndex;
                const revealed = answers[currentQuestion.id] !== undefined;
                const correct = optionIndex === currentQuestion.correctIndex;
                return (
                  <button
                    key={`${currentQuestion.id}-${optionIndex}`}
                    type="button"
                    onClick={() => setAnswers(current => ({ ...current, [currentQuestion.id]: optionIndex }))}
                    disabled={revealed}
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-[11px] leading-relaxed transition ${
                      revealed && correct
                        ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                        : selected
                          ? 'border-rose-400/35 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                          : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--glass-subtle)]'
                    }`}
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[9px]">{String.fromCharCode(65 + optionIndex)}</span>
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>
            {answers[currentQuestion.id] !== undefined && (
              <div className="mt-3 rounded-xl bg-[var(--glass-subtle)] px-3 py-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                {answers[currentQuestion.id] === currentQuestion.correctIndex ? '回答正确。' : '这次没有答对。'}
                {' '}{currentQuestion.explanation}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={resetQuiz} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]"><RotateCcw className="h-3.5 w-3.5" />重新开始</button>
            <button type="button" onClick={() => setQuizIndex((quizIndex + 1) % questions.length)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-[11px] font-medium text-white">下一题<ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      {citationAudit && (
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] ${
          citationAudit.status === 'pass'
            ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
            : 'border-amber-400/25 bg-amber-500/10 text-amber-800 dark:text-amber-200'
        }`}>
          <Check className="h-3.5 w-3.5" />
          {citationAudit.status === 'pass' ? '学习材料的引用编号检查通过。' : citationAudit.warning || '学习材料仍需核对引用编号。'}
        </div>
      )}

      <StudioEvidenceStatusPanel citations={citations} retrieval={retrieval} compact />
    </div>
  );
}
