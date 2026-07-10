'use client';

import { accountAuthHeaders } from '@/lib/account-session-browser';
import type { FileType, Paper } from '@/types';

export type UploadRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DiscoveredSourceUploadOutcome {
  papers: Paper[];
  errors: string[];
}

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
  if (typeof result.year !== 'number' || !Number.isFinite(result.year)) return { error: '服务器返回的年份字段无效' };
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
}: {
  files: File[];
  notebookId?: string;
  request?: UploadRequest;
}): Promise<DiscoveredSourceUploadOutcome> {
  if (files.length === 0) return { papers: [], errors: [] };

  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  if (notebookId) formData.append('notebookId', notebookId);

  const response = await request('/api/upload', {
    method: 'POST',
    headers: accountAuthHeaders(),
    body: formData,
  });
  if (!response.ok) throw new Error(`上传失败(HTTP ${response.status})`);

  let payload: UploadResponse;
  try {
    payload = await response.json() as UploadResponse;
  } catch {
    throw new Error('上传服务返回了无法解析的响应');
  }

  const papers: Paper[] = [];
  const errors: string[] = [];
  for (const result of payload.results || []) {
    const normalized = paperFromUploadResult(result);
    if (normalized.paper) papers.push(normalized.paper);
    if (normalized.error) errors.push(normalized.error);
  }
  if (papers.length === 0 && errors.length === 0) {
    errors.push(payload.error || '上传服务没有返回来源记录');
  }
  return { papers, errors };
}
