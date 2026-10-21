'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { notifyFailure, notifySuccess, notifyWarning, operationErrorMessage } from '@/lib/operation-feedback';
import type { PresentationMode } from './PresentationModeSelector';

export type StudioTask = {
  id: string; title: string; tool: 'presentation' | 'deep-research'; mode?: PresentationMode;
  status: 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled'; message: string; startedAt: number;
};
type TaskInput = Omit<StudioTask, 'startedAt'>;
const Context = createContext<{ tasks: StudioTask[]; update: (task: TaskInput) => void; dismiss: (id: string) => void }>({ tasks: [], update: () => {}, dismiss: () => {} });
export const useStudioTasks = () => useContext(Context);

export function StudioTaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<StudioTask[]>([]);
  const update = useCallback((task: TaskInput) => {
    setTasks(previous => {
      const existing = previous.find(item => item.id === task.id);
      const startedAt = task.status === 'running' && existing?.status !== 'running' ? Date.now() : existing?.startedAt ?? Date.now();
      return [...previous.filter(item => item.id !== task.id), { ...task, startedAt }];
    });
  }, []);
  const dismiss = useCallback((id: string) => setTasks(previous => previous.filter(task => task.id !== id)), []);
  const running = tasks.some(task => task.status === 'running');
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);
  return <Context.Provider value={{ tasks, update, dismiss }}>{children}</Context.Provider>;
}

export function useStudioTaskStatus(input: { id: string; title: string; tool: StudioTask['tool']; mode?: PresentationMode; running: boolean; message: string; error?: string | null; hasResult: boolean; partial?: boolean }) {
  const { update } = useStudioTasks();
  const started = useRef(false);
  const previousRunning = useRef(false);
  const { id, title, tool, mode, running, message, error, hasResult, partial } = input;
  useEffect(() => {
    if (running) started.current = true;
    if (!started.current || (!running && !previousRunning.current)) return;
    const status = running ? 'running' : partial ? 'partial' : error && /已停止|已取消/.test(error) ? 'cancelled' : error ? 'failed' : hasResult ? 'succeeded' : 'failed';
    const detail = running ? message || '正在等待服务端结果。' : (error ? operationErrorMessage(new Error(error), '任务未完成。') : '') || (status === 'succeeded' ? '已生成，可打开查看结果。' : status === 'partial' ? '已保留现有结果，仍需检查或补充。' : '任务未完成，请打开查看详情。');
    update({ id, title, tool, mode, status, message: detail });
    if (previousRunning.current && !running) {
      if (status === 'succeeded') notifySuccess(`${title}已完成`);
      else if (status === 'partial' || status === 'cancelled') notifyWarning(`${title}：${detail}`);
      else notifyFailure(new Error(detail), `${title}未完成`);
    }
    previousRunning.current = running;
  }, [id, title, tool, mode, running, message, error, hasResult, partial, update]);
}
