import type { NotebookDocument } from './private-notebook-document';
import { isResearchReportDocument, type ResearchReportDocument } from './research-report-document';

// Consume the existing generator's durable acknowledgement, not an unverified text delta.
export async function readGeneratedReport(response: Response, runId: string, signal: AbortSignal): Promise<NotebookDocument<ResearchReportDocument>> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || '报告未能生成，请重试。');
  }
  if (!response.body) throw new Error('报告没有返回内容，请重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let document: NotebookDocument<ResearchReportDocument> | undefined;
  let error: string | undefined;
  const accept = (frame: string) => {
    const raw = frame.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
    if (!raw || raw === '[DONE]') return;
    const payload = JSON.parse(raw) as { document?: NotebookDocument<ResearchReportDocument>; error?: string };
    if (payload.error) error = payload.error;
    const saved = payload.document;
    if (saved && /^[a-f0-9]{64}$/.test(saved.revision) && isResearchReportDocument(saved.data) && saved.data.report?.runId === runId) document = saved;
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      frames.forEach(accept);
    }
    buffer += decoder.decode();
    if (buffer.trim()) accept(buffer);
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!document || error && document.data.report?.status !== 'incomplete') throw new Error(error || '报告尚未确认保存，请从右侧报告重试读取。');
  return document;
}
