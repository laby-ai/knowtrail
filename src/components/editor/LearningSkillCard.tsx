'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { isGeneratedLearning } from '@/lib/research-agent-learning';
import { learningCardExtra, type LearningMaterials } from '@/lib/learning-materials';
import { buildQuiz } from '@/lib/learning-quiz';
import type { LearningProgress, PendingLearning, ResearchLearningReference, ResearchToolCall } from '@/lib/research-agent-contract';
import { StudioEvidenceStatusPanel } from '@/components/studio/StudioEvidenceStatusPanel';

export function RetryLearningSave({ pending, messageId, callId }: { pending: PendingLearning; messageId: string; callId: string }) {
  const { storageScopeKey, chatPersistence } = useApp();
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), [storageScopeKey]);
  const retry = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try {
      const response = await clientApiRequest('/api/ai/knowledge-cards', { method: 'PUT', signal: controller.signal, redirectOnUnauthorized: false, headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() }, body: JSON.stringify({ notebookId: notebookIdFromStorageScopeKey(storageScopeKey), data: pending.data, expectedRevision: pending.expectedRevision }) });
      const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
      controller.signal.throwIfAborted();
      const saved = payload.document;
      if (!response.ok || !saved || !/^[a-f0-9]{64}$/.test(saved.revision) || !isGeneratedLearning(saved.data, pending.runId, pending)) throw new Error(payload.error || '尚未确认保存，请重试。');
      const learning: ResearchLearningReference = { kind: pending.kind, question: pending.question, sourceIds: pending.sourceIds, runId: pending.runId, revision: saved.revision, status: saved.data.citationAudit?.status === 'pass' ? 'complete' : 'incomplete' };
      chatPersistence.update(previous => ({ ...previous, messages: previous.messages.map(message => message.id !== messageId ? message : { ...message, toolCalls: message.toolCalls?.map(call => call.id === callId ? { ...call, status: 'ready', error: undefined, pendingLearning: undefined, learning } : call) }) }));
      if (!await chatPersistence.flush()) throw new Error('材料已保存，对话引用尚未保存。请使用对话上方的重试保存。');
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '保存失败，请重试。'); }
    finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };
  return <div><p>本轮材料已生成但尚未保存，重试只保存原内容。</p><button type="button" className="agent-plugin-open" disabled={busy} onClick={() => void retry()}>{busy ? '正在保存…' : '重试保存本轮复习材料'}</button>{error && <p role="alert">{error}</p>}</div>;
}

export function LearningSkillCard({ call, messageId }: { call: ResearchToolCall & { learning: ResearchLearningReference }; messageId: string }) {
  const reference = call.learning;
  const { storageScopeKey, chatPersistence } = useApp();
  const key = `${storageScopeKey}:${reference.revision}`;
  const [loaded, setLoaded] = useState<{ key: string; data: LearningMaterials } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openedKey, setOpenedKey] = useState('');
  const data = loaded?.key === key ? loaded.data : null;
  const error = failure?.key === key ? failure.message : '';
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ notebookId: notebookIdFromStorageScopeKey(storageScopeKey) || '', revision: reference.revision });
    void (async () => {
      try {
        const response = await clientApiRequest(`/api/ai/knowledge-cards?${query}`, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        const payload = await response.json() as { document?: { revision: string; data: unknown }; error?: string };
        if (controller.signal.aborted) return;
        const saved = payload.document;
        if (!response.ok || !saved || saved.revision !== reference.revision || !isGeneratedLearning(saved.data, reference.runId, reference)) throw new Error(payload.error || '本轮材料暂时无法读取，请重试。');
        setFailure(null); setLoaded({ key, data: saved.data });
      } catch (caught) { if (!controller.signal.aborted) setFailure({ key, message: caught instanceof Error ? caught.message : '读取失败，请重试。' }); }
    })();
    return () => controller.abort();
  }, [attempt, key, reference, storageScopeKey]);
  const progress = call.learningProgress || { cardIndex: 0, quizIndex: 0, answers: {} };
  const update = (next: LearningProgress) => chatPersistence.update(previous => ({ ...previous, messages: previous.messages.map(message => message.id !== messageId ? message : { ...message, toolCalls: message.toolCalls?.map(item => item.id === call.id && item.learning?.revision === reference.revision ? { ...item, learningProgress: next } : item) }) }));
  const card = data?.cards[Math.min(progress.cardIndex, data.cards.length - 1)];
  const questions = data ? buildQuiz(data.cards) : [];
  const question = questions[Math.min(progress.quizIndex, questions.length - 1)];
  const answer = question ? progress.answers[question.id] : undefined;
  const quiz = reference.kind === 'quiz';
  const label = quiz ? '本轮复习测验' : '本轮学习卡';
  return <div data-testid="agent-learning-artifact">
    {!data && !error && <p role="status">正在读取{label}…</p>}
    {error && <><p role="alert">{error}</p><button type="button" className="agent-plugin-open" onClick={() => setAttempt(n => n + 1)}>重新读取{label}</button></>}
    {data && <>
      <p className="text-xs text-[var(--text-secondary)]">{data.cards.length} 张卡片 · {data.citations.length} 条来源线索</p>
      {reference.status === 'incomplete' && <p role="status">引用尚未完整对齐，请核对原文。</p>}
      <button type="button" className="agent-plugin-open" aria-expanded={openedKey === key} onClick={() => setOpenedKey(openedKey === key ? '' : key)}>{openedKey === key ? `收起${label}` : `查看${label}`}</button>
      {openedKey === key && <div className="space-y-3 break-words text-sm leading-relaxed" data-testid="agent-learning-content">
        <p className="text-xs text-[var(--text-secondary)]">{quiz ? '按卡片内容进行匹配复习，不作科学真伪或能力评估。' : '卡片来自所选资料，请结合原文核对。'}</p>
        {quiz && question && question.options.length >= 2 ? <>
          <p>第 {progress.quizIndex + 1} / {questions.length} 题：{question.prompt}</p>
          {question.options.map((option, index) => <button key={index} type="button" className="agent-plugin-open text-left" disabled={answer !== undefined} aria-pressed={answer === index} onClick={() => update({ ...progress, answers: { ...progress.answers, [question.id]: index } })}>{String.fromCharCode(65 + index)}. {option}</button>)}
          {answer !== undefined && <p role="status">{answer === question.correctIndex ? '与卡片一致。' : '与卡片不一致。'} {question.explanation}</p>}
          <button type="button" className="agent-plugin-open" onClick={() => update({ ...progress, quizIndex: (progress.quizIndex + 1) % questions.length })}>下一题</button>
          <button type="button" className="agent-plugin-open" onClick={() => update({ ...progress, quizIndex: 0, answers: {} })}>重新复习</button>
        </> : <>
          {quiz && <p role="status">卡片内容不足以形成不同选项，先查看原文卡片。</p>}
          {card && <article><strong>{card.title}</strong><p>{card.content}</p>{card.extra && <p>{learningCardExtra(card.extra)}</p>}</article>}
          <p>第 {progress.cardIndex + 1} / {data.cards.length} 张</p>
          <button type="button" className="agent-plugin-open" onClick={() => update({ ...progress, cardIndex: (progress.cardIndex + 1) % data.cards.length })}>下一张</button>
        </>}
        <StudioEvidenceStatusPanel citations={data.citations} retrieval={data.retrieval} compact />
      </div>}
    </>}
  </div>;
}
