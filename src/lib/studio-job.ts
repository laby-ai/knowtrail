import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';

export type StudioJobType = 'podcast' | 'knowledge-cards' | 'report' | 'ppt' | 'ppt-v2';
export type StudioJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type StudioJobStage =
  | 'queued'
  | 'retrieving-context'
  | 'generating-script'
  | 'synthesizing-audio'
  | 'saving-artifact'
  | 'completed'
  | 'failed';

export interface StudioJobArtifact {
  kind: 'audio' | 'pptx' | 'markdown' | 'json';
  url?: string;
  contentType?: string;
  bytes?: number;
  meta?: Record<string, unknown>;
}

export interface StudioJobError {
  type: string;
  message: string;
  detail?: string;
  retryable: boolean;
  requestId?: string;
  upstreamStatus?: number;
}

export interface StudioJob {
  id: string;
  type: StudioJobType;
  ownerMemberId?: string;
  notebookId?: string;
  status: StudioJobStatus;
  stage: StudioJobStage;
  progress: number;
  message: string;
  sourceIds: string[];
  retrieval?: RetrievalMetadata;
  citations: Citation[];
  citationAudit?: CitationAuditResult;
  artifact?: StudioJobArtifact;
  error?: StudioJobError;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateStudioJobInput {
  type: StudioJobType;
  ownerMemberId?: string;
  notebookId?: string;
  stage?: StudioJobStage;
  progress?: number;
  message?: string;
  sourceIds?: string[];
  retrieval?: RetrievalMetadata;
  citations?: Citation[];
  citationAudit?: CitationAuditResult;
}

interface StudioJobStoreFile {
  version: 1;
  updatedAt: string;
  jobs: StudioJob[];
}

export interface StudioJobStoreStatus {
  provider: 'local-json';
  configured: boolean;
  path: string;
  ttlMs: number;
}

const DEFAULT_STUDIO_JOB_STORE_PATH = '.data/studio-jobs/jobs.json';
const JOB_TTL_MS = Number(process.env.STUDIO_JOB_TTL_MS || 6 * 60 * 60 * 1000);
const jobs = new Map<string, StudioJob>();
let loadedStorePath = '';

function nowIso() {
  return new Date().toISOString();
}

function studioJobStorePath(): string {
  const configured = process.env.STUDIO_JOB_STORE_PATH?.trim();
  return path.resolve(process.cwd(), configured || DEFAULT_STUDIO_JOB_STORE_PATH);
}

function isStudioJob(value: unknown): value is StudioJob {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StudioJob>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.startsWith('studio-') &&
    typeof candidate.type === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.stage === 'string' &&
    typeof candidate.progress === 'number' &&
    typeof candidate.message === 'string' &&
    Array.isArray(candidate.sourceIds) &&
    Array.isArray(candidate.citations) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function studioJobMatchesScope(job: StudioJob, scope: { ownerMemberId?: string; notebookId?: string }): boolean {
  const { ownerMemberId, notebookId } = scope;
  if (ownerMemberId && job.ownerMemberId !== ownerMemberId) return false;
  if (notebookId && (job.notebookId || 'default-workspace') !== notebookId) return false;
  return true;
}

function emptyStore(): StudioJobStoreFile {
  return { version: 1, updatedAt: nowIso(), jobs: [] };
}

function readJobsFromDisk(): StudioJobStoreFile {
  const targetPath = studioJobStorePath();
  try {
    if (!existsSync(targetPath)) return emptyStore();
    const raw = readFileSync(targetPath, 'utf-8');
    const parsed = JSON.parse(raw) as StudioJobStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.jobs)) {
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
        jobs: parsed.jobs.filter(isStudioJob),
      };
    }
  } catch {
    // Missing or corrupt job stores are treated as empty and rewritten on next mutation.
  }
  return emptyStore();
}

function writeJobsToDisk() {
  const targetPath = studioJobStorePath();
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const store: StudioJobStoreFile = {
    version: 1,
    updatedAt: nowIso(),
    jobs: Array.from(jobs.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, targetPath);
}

function loadJobsFromDiskIfNeeded() {
  const targetPath = studioJobStorePath();
  if (loadedStorePath === targetPath) return;
  jobs.clear();
  const store = readJobsFromDisk();
  for (const job of store.jobs) jobs.set(job.id, job);
  loadedStorePath = targetPath;
  pruneExpiredJobs({ persist: false });
}

function pruneExpiredJobs(options: { persist?: boolean } = {}) {
  const now = Date.now();
  let changed = false;
  for (const [id, job] of jobs.entries()) {
    const updatedAt = Date.parse(job.updatedAt);
    if (Number.isFinite(updatedAt) && now - updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
      changed = true;
    }
  }
  if (changed && options.persist !== false) writeJobsToDisk();
}

export function createStudioJob(input: CreateStudioJobInput): StudioJob {
  loadJobsFromDiskIfNeeded();
  pruneExpiredJobs();
  const timestamp = nowIso();
  const job: StudioJob = {
    id: `studio-${input.type}-${randomUUID()}`,
    type: input.type,
    ownerMemberId: input.ownerMemberId,
    notebookId: input.notebookId,
    status: 'queued',
    stage: input.stage || 'queued',
    progress: input.progress ?? 0,
    message: input.message || '任务已创建，等待开始。',
    sourceIds: input.sourceIds || [],
    retrieval: input.retrieval,
    citations: input.citations || [],
    citationAudit: input.citationAudit,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  jobs.set(job.id, job);
  writeJobsToDisk();
  return job;
}

export function getStudioJob(id: string, scope: { ownerMemberId?: string; notebookId?: string } = {}): StudioJob | undefined {
  loadJobsFromDiskIfNeeded();
  pruneExpiredJobs();
  const job = jobs.get(id);
  return job && studioJobMatchesScope(job, scope) ? job : undefined;
}

export function updateStudioJob(id: string, patch: Partial<Omit<StudioJob, 'id' | 'type' | 'createdAt'>>): StudioJob {
  loadJobsFromDiskIfNeeded();
  const existing = jobs.get(id);
  if (!existing) throw new Error(`Studio job not found: ${id}`);
  const status = patch.status || existing.status;
  const timestamp = nowIso();
  const updated: StudioJob = {
    ...existing,
    ...patch,
    status,
    updatedAt: timestamp,
    completedAt: status === 'succeeded' || status === 'failed'
      ? patch.completedAt || existing.completedAt || timestamp
      : patch.completedAt ?? existing.completedAt,
  };
  jobs.set(id, updated);
  writeJobsToDisk();
  return updated;
}

export function studioJobStoreStatus(): StudioJobStoreStatus {
  return {
    provider: 'local-json',
    configured: true,
    path: studioJobStorePath(),
    ttlMs: JOB_TTL_MS,
  };
}

export function reloadStudioJobsFromDiskForTest() {
  loadedStorePath = '';
  loadJobsFromDiskIfNeeded();
}

export function toStudioJobResponse(job: StudioJob) {
  const completed = job.status === 'succeeded';
  const failed = job.status === 'failed';
  const audioUrl = job.artifact?.kind === 'audio' ? job.artifact.url : undefined;
  const dialoguePreview = typeof job.artifact?.meta?.dialoguePreview === 'string'
    ? job.artifact.meta.dialoguePreview
    : undefined;

  return {
    success: !failed,
    status: completed ? 'completed' : failed ? 'failed' : 'running',
    taskId: job.id,
    job,
    message: failed ? job.error?.message || job.message : job.message,
    audioUrl,
    artifactUrl: job.artifact?.url,
    artifact: job.artifact,
    provider: typeof job.artifact?.meta?.provider === 'string' ? job.artifact.meta.provider : undefined,
    partial: job.artifact?.meta?.partial === true,
    segments: Array.isArray(job.artifact?.meta?.segments) ? job.artifact.meta.segments : undefined,
    dialoguePreview,
    citations: job.citations,
    retrieval: job.retrieval,
    citationAudit: job.citationAudit,
    error: job.error?.message,
    errorType: job.error?.type,
    retryable: job.error?.retryable,
    requestId: job.error?.requestId,
    upstreamStatus: job.error?.upstreamStatus,
    retryAfterSeconds: completed || failed ? undefined : 2,
  };
}
