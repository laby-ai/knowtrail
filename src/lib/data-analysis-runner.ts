import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { DataAnalysisRequest, DataAnalysisResult } from './data-analysis-contract';

let running = 0;
export class AnalysisRuntimeError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
export async function executeDataAnalysis(request: DataAnalysisRequest, file: Buffer, fileType: 'csv' | 'xlsx', signal?: AbortSignal): Promise<DataAnalysisResult> {
  if (running >= 2) throw new AnalysisRuntimeError('当前统计任务较多，请稍后重试。', 429);
  const image = process.env.STATISTICS_RUNTIME_IMAGE?.trim();
  if (!image) throw new AnalysisRuntimeError('统计执行环境尚未部署，请联系服务方。');
  if (file.length > 25 * 1024 * 1024) throw new AnalysisRuntimeError('统计分析单文件上限为 25 MB。', 413);
  if (signal?.aborted) throw new AnalysisRuntimeError('分析已取消。', 499);
  const name = 'lingbi-stats-' + randomUUID();
  const command = process.env.STATISTICS_CONTAINER_COMMAND || 'docker';
  const input = JSON.stringify({ ...request, fileType, fileBase64: file.toString('base64') });
  const args = ['run', '--rm', '--pull=never', '--name', name, '--network', 'none', '--read-only', '--user', '65534:65534',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1', '--pids-limit', '32',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--log-driver', 'none', '-i', image];
  running++;
  try {
    return await new Promise<DataAnalysisResult>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      const chunks: Buffer[] = []; let bytes = 0; let timedOut = false; let exceeded = false;
      const cancel = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => { timedOut = true; cancel(); }, 75_000);
      child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { exceeded = true; cancel(); } else chunks.push(chunk); });
      // Drain stderr without publishing data or interpreter traces to application logs.
      child.stderr.resume(); child.stdin.on('error', () => undefined);
      child.on('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new AnalysisRuntimeError('无法启动统计执行环境。')); });
      child.on('close', (code: number | null) => {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (signal?.aborted) return reject(new AnalysisRuntimeError('分析已取消。', 499));
        if (timedOut) return reject(new AnalysisRuntimeError('分析超过执行时限，请减少数据量后重试。', 504));
        if (exceeded) return reject(new AnalysisRuntimeError('分析结果过大，请减少分组或数据量。', 413));
        try {
          const output = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ok?: boolean; error?: string; data?: DataAnalysisResult };
          if (code !== 0 || !output.ok || !output.data) return reject(new AnalysisRuntimeError(output.error || '统计执行失败，请检查数据及方法。', 422));
          if (!Array.isArray(output.data.summaries) || typeof output.data.chartSvg !== 'string' || !Number.isFinite(output.data.usedRows)) throw new Error('invalid_result');
          resolve(output.data);
        } catch { reject(new AnalysisRuntimeError('统计环境未返回有效结果，可能已达到资源限制，请减少数据量后重试。')); }
      });
      child.stdin.end(input);
    });
  } finally {
    await new Promise<void>(resolve => execFile(command, ['rm', '-f', name], { timeout: 10_000, maxBuffer: 1024 }, () => resolve()));
    running--;
  }
}
