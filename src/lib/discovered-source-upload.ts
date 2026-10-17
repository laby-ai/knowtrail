'use client';

import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiPath } from '@/lib/client-api';
import type { FileType, Paper } from '@/types';

export type UploadRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DiscoveredSourceUploadOutcome {
  papers: Paper[];
  errors: string[];
  successfulFileIndexes: number[];
}

export interface DiscoveredSourceIngestResult { added: number; errors: string[]; successfulFileIndexes: number[] }

interface UploadResponse {
  results?: unknown[];
  error?: string;
}

const FILE_TYPES = new Set<FileType>([
  'pdf', 'doc', 'docx', 'txt', 'md', 'jpg', 'jpeg', 'png', 'gif', 'webp',
  'csv', 'xlsx', 'ppt', 'pptx', 'other',
]);

function paperFromUploadResult(value: unknown): { paper?: Paper; error?: string } {
  if (!value || typeof value !== 'object') return { error: '服务器未返回有效来源记录' };
  const result = value as Partial<Paper> & { error?: unknown };
  if (typeof result.error === 'string' && result.error.trim()) return { error: result.error.trim() };

  const requiredStrings = [
    result.id,
    result.title,
    result.content,
    result.shortName,
    result.fileName,
    result.fileType,
    result.uploadTime,
  ];
  if (requiredStrings.some(item => typeof item !== 'string' || !item.trim())) {
    return { error: '服务器返回的来源字段不完整' };
  }
  if (!FILE_TYPES.has(result.fileType as FileType)) return { error: '服务器返回了不支持的来源类型' };
  if (!Array.isArray(result.authors) || !result.authors.every(author => typeof author === 'string')) {
    return { error: '服务器返回的作者字段无效' };
  }
  if (!Array.isArray(result.keywords) || !result.keywords.every(keyword => typeof keyword === 'string')) {
    return { error: '服务器返回的关键词字段无效' };
  }
  if (result.year !== undefined && (typeof result.year !== 'number' || !Number.isFinite(result.year))) return { error: '服务器返回的年份字段无效' };
  if (typeof result.fileSize !== 'number' || !Number.isFinite(result.fileSize)) return { error: '服务器返回的文件大小无效' };

  return {
    paper: {
      id: result.id!,
      title: result.title!,
      authors: result.authors,
      year: result.year,
      keywords: result.keywords,
      abstract: result.abstract,
      content: result.content!,
      rawContent: result.rawContent,
      shortName: result.shortName!,
      fileName: result.fileName!,
      fileType: result.fileType as FileType,
      fileSize: result.fileSize,
      fileUrl: result.fileUrl,
      fileKey: result.fileKey,
      uploadTime: result.uploadTime!,
      journal: result.journal,
      doi: result.doi,
      mineruFigures: result.mineruFigures || [],
      mineruStatus: result.mineruStatus,
      mineru: result.mineru,
      ingestionStatus: result.ingestionStatus,
      ingestionStages: result.ingestionStages,
      ingestionChunkCount: result.ingestionChunkCount,
      vectorIndex: result.vectorIndex,
    },
  };
}

export async function uploadDiscoveredSourceFiles({
  files,
  notebookId,
  request = fetch,
  signal,
}: {
  files: File[];
  notebookId?: string;
  request?: UploadRequest;
  signal?: AbortSignal;
}): Promise<DiscoveredSourceUploadOutcome> {
  if (files.length === 0) return { papers: [], errors: [], successfulFileIndexes: [] };

  signal?.throwIfAborted();
  const auth = accountAuthHeaders();
  const papers: Paper[] = [];
  const errors: string[] = [];
  const successfulFileIndexes: number[] = [];
  // The existing upload endpoint accepts at most five files per request.
  for (let offset = 0; offset < files.length; offset += 5) {
    signal?.throwIfAborted();
    const batch = files.slice(offset, offset + 5);
    const formData = new FormData();
    batch.forEach(file => formData.append('files', file));
    if (notebookId) formData.append('notebookId', notebookId);
    let payload: UploadResponse;
    try {
      const response = await request(clientApiPath('/api/upload'), { method: 'POST', headers: auth, signal, body: formData });
      if (!response.ok) throw new Error(`上传失败(HTTP ${response.status})`);
      try { payload = await response.json() as UploadResponse; }
      catch { throw new Error('上传服务返回了无法解析的响应'); }
    } catch (error) {
      signal?.throwIfAborted();
      if (!papers.length && !errors.length) throw error;
      const message = error instanceof Error ? error.message : '上传未完成，请重试剩余资料。';
      errors.push(...files.slice(offset).map((file, index) => `${file.name}：${index < batch.length ? message : '上一批未完成，尚未上传。'}`));
      break;
    }
    signal?.throwIfAborted();
    for (let index = 0; index < batch.length; index++) {
      const result = payload.results?.[index];
      const normalized = paperFromUploadResult(result);
      if (normalized.paper) { papers.push(normalized.paper); successfulFileIndexes.push(offset + index); }
      if (normalized.error) errors.push(result === undefined ? payload.error || '上传服务没有返回来源记录' : normalized.error);
    }
  }
  return { papers, errors, successfulFileIndexes };
}
