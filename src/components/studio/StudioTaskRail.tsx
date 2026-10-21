'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { useStudioTasks, type StudioTask } from './StudioTaskContext';

export function StudioTaskRail({ onOpen }: { onOpen: (task: StudioTask) => void }) {
  const { tasks, dismiss } = useStudioTasks();
  const [now, setNow] = useState(0);
  const running = tasks.some(task => task.status === 'running');
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!tasks.length) return null;
  return <section className="mb-4 space-y-3 rounded-xl border border-[var(--glass-border)] bg-[var(--bg-card)] p-3" data-testid="studio-task-rail">
    <h3 className="text-sm font-semibold">生成任务</h3>
    <p className="text-xs leading-5 text-[var(--text-secondary)]">关闭弹窗可继续处理。请保留当前页面；刷新或离开文献本可能中断。</p>
    {tasks.map(task => <div key={task.id} className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] p-2" data-testid={`studio-task-${task.id}`} data-status={task.status}>
      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left" aria-label={`查看${task.title}任务`}>
        <span className="flex items-center gap-2 text-sm font-medium">{task.status === 'running' ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : task.status === 'succeeded' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />}{task.title}</span>
        <span className="mt-1 block break-words text-xs leading-5 text-[var(--text-secondary)]">{task.message}</span>
        <span className="mt-1 block text-xs text-[var(--text-secondary)]">{task.status === 'running' ? `处理中 · ${Math.max(0, Math.floor((now - task.startedAt) / 1000))} 秒 · 点击查看` : '点击查看结果或重试'}</span>
      </button>
      {task.status !== 'running' && <button type="button" aria-label={`收起${task.title}任务提示`} onClick={() => dismiss(task.id)} className="rounded p-1"><X className="h-4 w-4" /></button>}
    </div>)}
  </section>;
}
