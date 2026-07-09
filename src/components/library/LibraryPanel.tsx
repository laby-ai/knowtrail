'use client';

import { useState, useCallback, useRef, useEffect, DragEvent } from 'react';
import {
  FolderPlus,
  Trash2,
  CheckCircle2,
  Circle,
  Search,
  ChevronDown,
  Copy,
  FileText,
  Upload,
  FileImage,
  FileSpreadsheet,
  File,
  Presentation,
  X,
  CheckCircle,
  AlertCircle,
  Globe2,
  Loader2,
  MoreHorizontal,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import type { CitationReveal } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { buildDataTablePreviewForPaper } from '@/lib/data-table-preview';
import { buildSourceMatrixFacets } from '@/lib/source-matrix';
import type { DataColumnSummary } from '@/lib/data-table-preview';
import type { SourceMatrixFacet } from '@/lib/source-matrix';
import type { Paper, FileType } from '@/types';
import { SourceGuideModal } from './SourceGuideModal';
import { DiscoverSourcesModal } from './DiscoverSourcesModal';

const SUPPORTED_TYPES: Record<string, FileType> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const ACCEPT_STRING = '.pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png,.gif,.webp,.csv,.xlsx,.ppt,.pptx';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatPreviewNumber(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function FileTypeIcon({ fileType }: { fileType: FileType }) {
  const cls = 'h-4 w-4 flex-shrink-0';
  switch (fileType) {
    case 'pdf': return <FileText className={`${cls} text-red-400`} />;
    case 'doc': case 'docx': return <FileText className={`${cls} text-blue-400`} />;
    case 'txt': case 'md': return <FileText className={`${cls} text-[var(--text-tertiary)]`} />;
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': return <FileImage className={`${cls} text-emerald-400`} />;
    case 'csv': case 'xlsx': return <FileSpreadsheet className={`${cls} text-teal-400`} />;
    case 'ppt': case 'pptx': return <Presentation className={`${cls} text-amber-400`} />;
    default: return <File className={`${cls} text-zinc-500`} />;
  }
}

function fileTypeBadgeStyle(fileType: FileType): string {
  const map: Record<string, string> = {
    pdf: 'bg-red-500/10 text-red-400 border-red-500/20',
    doc: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    docx: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    txt: 'bg-[var(--glass-hover)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
    md: 'bg-[var(--glass-hover)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
    jpg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    jpeg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    png: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    gif: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    webp: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    csv: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    xlsx: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    ppt: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    pptx: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  return map[fileType] || 'bg-[var(--glass-hover)] text-[var(--text-secondary)] border-[var(--border-subtle)]';
}

function formatCitationReveal(citation: CitationReveal): string {
  const parts: string[] = [];
  if (citation.page) parts.push(`第 ${citation.page} 页`);
  if (typeof citation.chunkIndex === 'number') parts.push(`片段 ${citation.chunkIndex + 1}`);
  return parts.length > 0 ? parts.join(' · ') : '对应证据片段';
}

function truncateEvidenceText(text: string, maxLength = 96): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

interface UploadItem {
  id: string;
  fileName: string;
  fileType: FileType;
  fileSize: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  paper?: Paper;
}

interface IngestionSourceSummary {
  id: string;
  fileName: string;
  fileType: FileType;
  fileSize?: number;
  title: string;
  shortName?: string;
  status: Paper['ingestionStatus'];
  stages?: Paper['ingestionStages'];
  chunkCount: number;
  tokenEstimate: number;
  vectorIndex: Paper['vectorIndex'];
  mineru?: Paper['mineru'];
  createdAt?: string;
  updatedAt: string;
  error?: string;
}

interface IngestionSourceDetail extends IngestionSourceSummary {
  chunks?: Array<{
    id?: string;
    text?: string;
    page?: number | null;
    chunkIndex?: number;
    paperShortName?: string;
    sourceTitle?: string;
  }>;
}

interface CitationContextSnippet {
  locator: string;
  text: string;
}

interface SourceCitationLead {
  id: string;
  locator: string;
  text: string;
}

type CitationContextState =
  | { paperId: string; status: 'loading' }
  | { paperId: string; status: 'ready'; snippet: CitationContextSnippet }
  | { paperId: string; status: 'missing' }
  | { paperId: string; status: 'error' };

type SourcePreviewState =
  | { paper: Paper; status: 'loading' }
  | { paper: Paper; status: 'ready'; source: IngestionSourceDetail }
  | { paper: Paper; status: 'missing' }
  | { paper: Paper; status: 'error' };

type SourceMatrixPreviewFocus = Pick<SourceMatrixFacet, 'key' | 'label' | 'excerpt'>;

function normalizeEvidenceText(text?: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function citationChunkLocator(chunk: NonNullable<IngestionSourceDetail['chunks']>[number], citation: CitationReveal): string {
  const parts: string[] = [];
  const page = typeof chunk.page === 'number' ? chunk.page : citation.page;
  const chunkIndex = typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : citation.chunkIndex;
  if (page) parts.push(`第 ${page} 页`);
  if (typeof chunkIndex === 'number') parts.push(`片段 ${chunkIndex + 1}`);
  return parts.length > 0 ? parts.join(' · ') : '原文片段';
}

function sourceChunkLocator(chunk: NonNullable<IngestionSourceDetail['chunks']>[number]): string {
  const parts: string[] = [];
  if (typeof chunk.page === 'number') parts.push(`第 ${chunk.page} 页`);
  if (typeof chunk.chunkIndex === 'number') parts.push(`片段 ${chunk.chunkIndex + 1}`);
  return parts.length > 0 ? parts.join(' · ') : '来源片段';
}

function buildSourceCitationLeads(chunks: NonNullable<IngestionSourceDetail['chunks']>[number][]): SourceCitationLead[] {
  const seen = new Set<string>();
  return chunks
    .map((chunk, index) => {
      const text = normalizeEvidenceText(chunk.text);
      return text ? {
        id: chunk.id || `lead-${index}`,
        locator: sourceChunkLocator(chunk),
        text,
      } : null;
    })
    .filter((lead): lead is SourceCitationLead => Boolean(lead))
    .filter((lead) => {
      const key = lead.text.slice(0, 120);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function dataColumnTypeLabel(column: DataColumnSummary): string {
  if (column.type === 'numeric') return '数值列';
  if (column.type === 'mixed') return '混合列';
  return '文本列';
}

function sourceMatrixEvidenceStatus(paper: Paper): string {
  const parts: string[] = [];
  if (paper.ingestionChunkCount) parts.push(`${paper.ingestionChunkCount} 个片段`);
  if (paper.vectorIndex?.status === 'succeeded') parts.push(`索引 ${paper.vectorIndex.count || 0} 条`);
  if (paper.mineru?.figureCount) parts.push(`${paper.mineru.figureCount} 张图表`);
  if (paper.ingestionStatus === 'failed') return '解析失败，需重新上传或检查格式';
  if (parts.length === 0) return '仅有基础元数据';
  return parts.join(' · ');
}

function findCitationContextSnippet(
  chunks: IngestionSourceDetail['chunks'] | undefined,
  citation: CitationReveal,
): CitationContextSnippet | null {
  if (!chunks || chunks.length === 0) return null;
  const excerpt = normalizeEvidenceText(citation.excerpt);
  const matched = chunks.find(chunk => (
    (citation.chunkId && chunk.id === citation.chunkId) ||
    (typeof citation.chunkIndex === 'number' && chunk.chunkIndex === citation.chunkIndex) ||
    (excerpt && normalizeEvidenceText(chunk.text).includes(excerpt.slice(0, Math.min(excerpt.length, 80))))
  ));
  if (!matched?.text) return null;
  return {
    locator: citationChunkLocator(matched, citation),
    text: matched.text,
  };
}

function sourceMatrixFocusMatchesChunk(
  chunk: NonNullable<IngestionSourceDetail['chunks']>[number],
  focus: SourceMatrixPreviewFocus | null,
): boolean {
  if (!focus?.excerpt || !chunk.text) return false;
  const chunkText = normalizeEvidenceText(chunk.text);
  const focusText = normalizeEvidenceText(focus.excerpt).replace(/\.\.\.$/, '');
  if (!focusText) return false;
  if (chunkText.includes(focusText)) return true;
  return chunkText.includes(focusText.slice(0, Math.min(focusText.length, 72)));
}

function legacyMinerUStatus(mineru?: Paper['mineru']): Paper['mineruStatus'] | undefined {
  if (!mineru || mineru.status === 'not_configured') return undefined;
  if (mineru.status === 'succeeded') return 'done';
  if (mineru.status === 'running' || mineru.status === 'pending') return mineru.status;
  return 'failed';
}

function ingestionBadge(paper: Paper): { label: string; className: string } | null {
  if (!paper.ingestionStatus) return null;
  if (paper.ingestionStatus === 'succeeded') {
    const indexed = paper.vectorIndex?.status === 'succeeded';
    return {
      label: indexed ? `索引 ${paper.vectorIndex?.count || paper.ingestionChunkCount || 0}` : `片段 ${paper.ingestionChunkCount || 0}`,
      className: indexed
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    };
  }
  if (paper.ingestionStatus === 'running' || paper.ingestionStatus === 'pending') {
    return { label: '索引中', className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  }
  return { label: '索引失败', className: 'bg-red-500/10 text-red-400 border-red-500/20' };
}

function mineruBadge(paper: Paper): { label: string; className: string } | null {
  if (paper.fileType !== 'pdf' || !paper.mineru || paper.mineru.status === 'not_configured') return null;
  if (paper.mineru.status === 'succeeded') {
    return {
      label: `图表 ${paper.mineru.figureCount || paper.mineruFigures?.length || 0}`,
      className: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
    };
  }
  if (paper.mineru.status === 'pending' || paper.mineru.status === 'running') {
    return { label: '图表提取中', className: 'bg-blue-500/10 text-blue-300 border-blue-500/20' };
  }
  return { label: '图表失败', className: 'bg-red-500/10 text-red-400 border-red-500/20' };
}

function sourceSortTime(paper: Paper): number {
  const value = paper.uploadTime || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function LibraryPanel({
  accountSession,
  accountAuthRequired = false,
  showSourceGuide = false,
  onSourceGuideDismiss,
}: {
  workspaceTitle?: string;
  onBackHome?: () => void;
  accountSession?: AccountAuthSession | null;
  accountAuthRequired?: boolean;
  showSourceGuide?: boolean;
  onSourceGuideDismiss?: () => void;
}) {
  const {
    folders,
    selectedPapers,
    activeFolderId,
    addFolder,
    deleteFolder,
    addPaper,
    removePaper,
    updatePaper,
    togglePaperSelection,
    selectAllPapers,
    clearSelection,
    setActiveFolder,
    aiConfig,
    storageScopeKey,
    revealPaperRequest,
  } = useApp();

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [showUploadProgress, setShowUploadProgress] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; paper: Paper } | null>(null);
  const [skippedFilesNotice, setSkippedFilesNotice] = useState<string | null>(null);
  const [ingestionSyncState, setIngestionSyncState] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [isSourceGuideOpen, setIsSourceGuideOpen] = useState(showSourceGuide);
  const [isDiscoverOpen, setIsDiscoverOpen] = useState(false);
  const [pastedSourceText, setPastedSourceText] = useState('');
  const [pastedSourceTitle, setPastedSourceTitle] = useState('');
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewState | null>(null);
  const [sourcePreviewFocus, setSourcePreviewFocus] = useState<SourceMatrixPreviewFocus | null>(null);
  const [isSourceMatrixOpen, setIsSourceMatrixOpen] = useState(false);
  const ingestionSyncInFlightRef = useRef(false);
  const lastIngestionSyncAtRef = useRef(0);
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);

  useEffect(() => {
    if (showSourceGuide) setIsSourceGuideOpen(true);
  }, [showSourceGuide]);

  useEffect(() => {
    if (folders.length === 0 || expandedFolders.size > 0) return;
    setExpandedFolders(new Set([activeFolderId || folders[0].id]));
  }, [activeFolderId, expandedFolders.size, folders]);

  // Citation click-through: expand the owning folder, scroll to the source and flash it.
  const [flashPaperId, setFlashPaperId] = useState<string | null>(null);
  const [citationFocus, setCitationFocus] = useState<{ paperId: string; citation: CitationReveal } | null>(null);
  const [citationContext, setCitationContext] = useState<CitationContextState | null>(null);
  useEffect(() => {
    if (!revealPaperRequest) return;
    const { paperId, citation } = revealPaperRequest;
    const ownerFolder = folders.find(folder => folder.papers.some(p => p.id === paperId));
    if (!ownerFolder) return;
    setExpandedFolders(prev => new Set([...prev, ownerFolder.id]));
    setSearchQuery('');
    setCitationContext(null);
    const timer = window.setTimeout(() => {
      const el = document.querySelector(`[data-testid="library-paper-${paperId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashPaperId(paperId);
      if (citation) setCitationFocus({ paperId, citation });
      window.setTimeout(() => {
        setFlashPaperId(null);
        setCitationFocus(prev => (prev?.paperId === paperId ? null : prev));
        setCitationContext(prev => (prev?.paperId === paperId ? null : prev));
      }, 8000);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [revealPaperRequest, folders]);

  useEffect(() => {
    if (!citationFocus) {
      setCitationContext(null);
      return;
    }
    const { paperId, citation } = citationFocus;
    const accountHeaders: Record<string, string> = accountSession?.token ? { Authorization: `Bearer ${accountSession.token}` } : {};
    if (accountAuthRequired && !accountHeaders.Authorization) {
      setCitationContext({ paperId, status: 'missing' });
      return;
    }

    let cancelled = false;
    const loadCitationContext = async () => {
      try {
        setCitationContext({ paperId, status: 'loading' });
        const detailParams = new URLSearchParams({ id: paperId });
        if (notebookId) detailParams.set('notebookId', notebookId);
        const response = await fetch(`/api/ingestion/sources?${detailParams.toString()}`, {
          cache: 'no-store',
          headers: accountHeaders,
        });
        if (!response.ok) {
          if (!cancelled) setCitationContext({ paperId, status: 'missing' });
          return;
        }
        const data = await response.json() as { source?: IngestionSourceDetail };
        const snippet = findCitationContextSnippet(data.source?.chunks, citation);
        if (cancelled) return;
        setCitationContext(snippet ? { paperId, status: 'ready', snippet } : { paperId, status: 'missing' });
      } catch {
        if (!cancelled) setCitationContext({ paperId, status: 'error' });
      }
    };

    void loadCitationContext();
    return () => {
      cancelled = true;
    };
  }, [accountAuthRequired, accountSession?.token, citationFocus, notebookId]);

  const syncIngestionSources = useCallback(async () => {
    const accountHeaders: Record<string, string> = accountSession?.token ? { Authorization: `Bearer ${accountSession.token}` } : {};
    if (accountAuthRequired && !accountHeaders.Authorization) return;
    const now = Date.now();
    if (ingestionSyncInFlightRef.current || now - lastIngestionSyncAtRef.current < 5000) return;
    ingestionSyncInFlightRef.current = true;
    lastIngestionSyncAtRef.current = now;
    const knownPapers = new Map<string, Paper>();
    folders.forEach(folder => folder.papers.forEach(paper => knownPapers.set(paper.id, paper)));

    try {
      setIngestionSyncState('syncing');
      const notebookQuery = notebookId ? `?notebookId=${encodeURIComponent(notebookId)}` : '';
      const response = await fetch(`/api/ingestion/sources${notebookQuery}`, {
        cache: 'no-store',
        headers: accountHeaders,
      });
      if (!response.ok) throw new Error('ingestion sources request failed');
      const data = await response.json() as { sources?: IngestionSourceSummary[] };
      const sources = data.sources || [];

      const missingSources = sources.filter(source => !knownPapers.has(source.id));
      let importFolderId = activeFolderId || folders[0]?.id || null;
      if (missingSources.length > 0 && !importFolderId) {
        importFolderId = addFolder('文献库');
        setExpandedFolders(prev => new Set([...prev, importFolderId!]));
        setActiveFolder(importFolderId);
      }

      for (const source of missingSources) {
        if (!importFolderId) continue;
        const detailParams = new URLSearchParams({ id: source.id });
        if (notebookId) detailParams.set('notebookId', notebookId);
        const detailResponse = await fetch(`/api/ingestion/sources?${detailParams.toString()}`, {
          cache: 'no-store',
          headers: accountHeaders,
        });
        if (!detailResponse.ok) continue;
        const detailData = await detailResponse.json() as { source?: IngestionSourceDetail };
        const detail = detailData.source;
        if (!detail) continue;
        const rawContent = (detail.chunks || [])
          .map(chunk => chunk.text || '')
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 50000);
        addPaper(importFolderId, {
          id: detail.id,
          title: detail.title || detail.fileName,
          authors: ['已入库来源'],
          year: new Date(detail.createdAt || detail.updatedAt || Date.now()).getFullYear(),
          keywords: ['持久来源'],
          abstract: rawContent.slice(0, 240) || `${detail.title || detail.fileName} 已完成来源摄取。`,
          content: rawContent || `${detail.title || detail.fileName} 已完成来源摄取。`,
          rawContent,
          shortName: detail.shortName || detail.fileName,
          fileName: detail.fileName,
          fileType: detail.fileType,
          fileSize: detail.fileSize || 0,
          uploadTime: detail.createdAt || detail.updatedAt || new Date().toISOString(),
          mineru: detail.mineru,
          mineruStatus: legacyMinerUStatus(detail.mineru),
          ingestionStatus: detail.status,
          ingestionStages: detail.stages,
          ingestionChunkCount: detail.chunkCount,
          vectorIndex: detail.vectorIndex,
          mineruFigures: [],
        });
        knownPapers.set(detail.id, {
          id: detail.id,
          title: detail.title || detail.fileName,
          authors: ['已入库来源'],
          year: new Date().getFullYear(),
          keywords: ['持久来源'],
          abstract: rawContent.slice(0, 240),
          content: rawContent,
          rawContent,
          shortName: detail.shortName || detail.fileName,
          fileName: detail.fileName,
          fileType: detail.fileType,
          fileSize: detail.fileSize || 0,
          uploadTime: detail.createdAt || detail.updatedAt || new Date().toISOString(),
          mineruFigures: [],
        });
      }

      for (const source of data.sources || []) {
        const current = knownPapers.get(source.id);
        if (!current) continue;
        const nextVectorIndex = source.vectorIndex;
        const changed = (
          current.ingestionStatus !== source.status ||
          current.ingestionChunkCount !== source.chunkCount ||
          current.mineru?.status !== source.mineru?.status ||
          current.mineru?.figureCount !== source.mineru?.figureCount ||
          current.vectorIndex?.status !== nextVectorIndex?.status ||
          current.vectorIndex?.count !== nextVectorIndex?.count ||
          current.vectorIndex?.dimension !== nextVectorIndex?.dimension
        );
        if (changed) {
          updatePaper(source.id, {
            ingestionStatus: source.status,
            ingestionStages: source.stages,
            ingestionChunkCount: source.chunkCount,
            mineru: source.mineru,
            mineruStatus: legacyMinerUStatus(source.mineru),
            vectorIndex: nextVectorIndex,
          });
        }
      }
      setIngestionSyncState('idle');
    } catch {
      setIngestionSyncState('error');
    } finally {
      ingestionSyncInFlightRef.current = false;
    }
  }, [accountAuthRequired, accountSession?.token, activeFolderId, addFolder, addPaper, folders, notebookId, setActiveFolder, updatePaper]);

  useEffect(() => {
    void syncIngestionSources();
    const interval = window.setInterval(() => {
      void syncIngestionSources();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [folders.length, syncIngestionSources]);

  const openSourcePreview = useCallback(async (paper: Paper, focus: SourceMatrixPreviewFocus | null = null) => {
    const accountHeaders: Record<string, string> = accountSession?.token ? { Authorization: `Bearer ${accountSession.token}` } : {};
    setSourcePreviewFocus(focus);
    setSourcePreview({ paper, status: 'loading' });
    if (accountAuthRequired && !accountHeaders.Authorization) {
      setSourcePreview({ paper, status: 'missing' });
      return;
    }

    try {
      const detailParams = new URLSearchParams({ id: paper.id });
      if (notebookId) detailParams.set('notebookId', notebookId);
      const response = await fetch(`/api/ingestion/sources?${detailParams.toString()}`, {
        cache: 'no-store',
        headers: accountHeaders,
      });
      if (!response.ok) {
        setSourcePreview({ paper, status: 'missing' });
        return;
      }
      const data = await response.json() as { source?: IngestionSourceDetail };
      if (!data.source) {
        setSourcePreview({ paper, status: 'missing' });
        return;
      }
      setSourcePreview({ paper, status: 'ready', source: data.source });
    } catch {
      setSourcePreview({ paper, status: 'error' });
    }
  }, [accountAuthRequired, accountSession?.token, notebookId]);

  const handleCreateFolder = useCallback(() => {
    if (newFolderName.trim()) {
      const newFolderId = addFolder(newFolderName.trim());
      setExpandedFolders(prev => new Set([...prev, newFolderId]));
      setActiveFolder(newFolderId);
      setNewFolderName('');
      setIsCreatingFolder(false);
    }
  }, [newFolderName, addFolder, setActiveFolder]);

  const uploadFiles = useCallback(async (files: File[], targetFolderId: string | null) => {
    if (!files.length) return;
    if (!targetFolderId) return;

    const items: UploadItem[] = files.map((file, idx) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const fileType = (Object.values(SUPPORTED_TYPES).includes(ext as FileType) ? ext : 'other') as FileType;
      return {
        id: `upload-${Date.now()}-${idx}`,
        fileName: file.name,
        fileType,
        fileSize: file.size,
        status: 'pending' as const,
        progress: 0,
      };
    });

    setUploadItems(items);
    setShowUploadProgress(true);
    setUploadItems(prev => prev.map(item => ({ ...item, status: 'uploading' as const, progress: 0 })));

    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));
      if (notebookId) formData.append('notebookId', notebookId);
      formData.append('aiConfig', JSON.stringify(aiConfig));

      // XHR instead of fetch so we can surface real byte-level upload progress.
      const data = await new Promise<{ results?: Array<Paper & { error?: string }> }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        Object.entries(accountAuthHeaders()).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
          setUploadItems(prev => prev.map(item => (item.status === 'uploading' ? { ...item, progress: pct } : item)));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('服务器响应解析失败')); }
          } else {
            reject(new Error(`上传失败(HTTP ${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('网络错误,上传中断'));
        xhr.ontimeout = () => reject(new Error('上传超时'));
        xhr.send(formData);
      });

      // Collect papers first, then batch add outside setState
      const uploadedPapers: Paper[] = [];
      const newUploadItems = items.map((item, idx) => {
        const result = data.results?.[idx];
        if (result?.error) return { ...item, status: 'error' as const, progress: 100, error: result.error };
        if (result) {
          const paper: Paper = {
            id: result.id, title: result.title, authors: result.authors, year: result.year,
            keywords: result.keywords, abstract: result.abstract, content: result.content,
            rawContent: result.rawContent,
            shortName: result.shortName, fileName: result.fileName, fileType: result.fileType,
            fileSize: result.fileSize, fileUrl: result.fileUrl, fileKey: result.fileKey,
            uploadTime: result.uploadTime,
            mineruFigures: result.mineruFigures || [],
            mineruStatus: result.mineruStatus,
            mineru: result.mineru,
            ingestionStatus: result.ingestionStatus,
            ingestionStages: result.ingestionStages,
            ingestionChunkCount: result.ingestionChunkCount,
            vectorIndex: result.vectorIndex,
          };
          uploadedPapers.push(paper);
          return { ...item, status: 'success' as const, progress: 100, paper };
        }
        return { ...item, status: 'error' as const, progress: 100, error: '未知错误' };
      });

      // First update upload items, then add papers separately (avoids setState during render)
      setUploadItems(newUploadItems);
      uploadedPapers.forEach(paper => {
        addPaper(targetFolderId, paper);
        // Auto-select uploaded papers so AI can reference them immediately
        setTimeout(() => togglePaperSelection(paper.id), 0);
      });
      setTimeout(() => { void syncIngestionSources(); }, 0);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '上传失败';
      setUploadItems(prev => prev.map(item => ({ ...item, status: 'error' as const, progress: 100, error: errorMsg })));
    }
  }, [addPaper, togglePaperSelection, aiConfig, notebookId, syncIngestionSources]);

  const handleFileSelect = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList);
    const validFiles = files.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      return Object.values(SUPPORTED_TYPES).includes(ext as FileType) || Object.keys(SUPPORTED_TYPES).includes(file.type);
    });
    const skipped = files.length - validFiles.length;
    if (skipped > 0) {
      const skippedNames = files
        .filter(f => !validFiles.includes(f))
        .map(f => f.name)
        .slice(0, 3)
        .join('、');
      setSkippedFilesNotice(`${skipped} 个文件类型不支持已跳过:${skippedNames}${skipped > 3 ? ' 等' : ''}`);
      window.setTimeout(() => setSkippedFilesNotice(null), 6000);
    }
    if (validFiles.length === 0) {
      setUploadItems([]);
      setShowUploadProgress(false);
      return;
    }
    if (!activeFolderId) {
      // Schedule folder creation + upload after current render
      setTimeout(async () => {
        const newFolderId = addFolder('新建项目');
        setExpandedFolders(prev => new Set([...prev, newFolderId]));
        await uploadFiles(validFiles, newFolderId);
      }, 0);
      return;
    }
    await uploadFiles(validFiles, activeFolderId);
  }, [activeFolderId, uploadFiles, addFolder]);

  const dismissSourceGuide = useCallback(() => {
    setIsSourceGuideOpen(false);
    onSourceGuideDismiss?.();
  }, [onSourceGuideDismiss]);

  const openFilePickerFromGuide = useCallback(() => {
    dismissSourceGuide();
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }, [dismissSourceGuide]);

  const handlePasteTextAsSource = useCallback(async () => {
    const content = pastedSourceText.trim();
    if (!content) return;
    const title = (pastedSourceTitle.trim() || '粘贴文献笔记').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
    const file = new globalThis.File([content], `${title}.txt`, { type: 'text/plain' });
    let targetFolder = activeFolderId;
    if (!targetFolder) {
      targetFolder = addFolder('文献库');
      setExpandedFolders(prev => new Set([...prev, targetFolder!]));
      setActiveFolder(targetFolder);
    }
    dismissSourceGuide();
    setPastedSourceText('');
    setPastedSourceTitle('');
    await uploadFiles([file], targetFolder);
  }, [activeFolderId, addFolder, dismissSourceGuide, pastedSourceText, pastedSourceTitle, setActiveFolder, uploadFiles]);

  // Discovered web sources arrive as ready-made text files and reuse the
  // regular upload/ingestion pipeline.
  const handleIngestDiscoveredFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    let targetFolder = activeFolderId;
    if (!targetFolder) {
      targetFolder = addFolder('网络信源');
      setExpandedFolders(prev => new Set([...prev, targetFolder!]));
      setActiveFolder(targetFolder);
    }
    await uploadFiles(files, targetFolder);
  }, [activeFolderId, addFolder, setActiveFolder, uploadFiles]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    let targetFolder = activeFolderId;
    if (!targetFolder) {
      const newFolderId = addFolder('新建项目');
      setExpandedFolders(prev => new Set([...prev, newFolderId]));
      targetFolder = newFolderId;
    }
    if (targetFolder) await uploadFiles(files, targetFolder);
  }, [activeFolderId, uploadFiles, addFolder]);

  const handleFolderClick = useCallback((folderId: string) => {
    setActiveFolder(folderId);
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  }, [setActiveFolder]);

  const copyShortName = useCallback((paper: Paper) => {
    navigator.clipboard.writeText(`[${paper.shortName}]`);
    setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, paper: Paper) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, paper });
  }, []);

  const filteredFolders = folders.map(folder => ({
    ...folder,
    papers: folder.papers.filter(paper =>
      paper.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      paper.authors.some(a => a.toLowerCase().includes(searchQuery.toLowerCase())) ||
      paper.keywords.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
    ).toSorted((a, b) => sourceSortTime(b) - sourceSortTime(a)),
  })).filter(folder => folder.papers.length > 0 || folder.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const totalPapers = folders.reduce((sum, f) => sum + f.papers.length, 0);
  const selectedSourceRows = folders
    .flatMap(folder => folder.papers.map(paper => ({ folderName: folder.name, paper })))
    .filter(row => selectedPapers.includes(row.paper.id));

  return (
    <div
      className="h-full flex flex-col relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => setContextMenu(null)}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-blue-500/5 border-2 border-dashed border-blue-500/30 rounded-2xl flex items-center justify-center backdrop-blur-sm">
          <div className="text-center animate-scale-in">
            <Upload className="h-10 w-10 text-blue-400 mx-auto mb-3 animate-float" />
            <p className="text-sm font-medium text-[var(--text-primary)]">释放文献或资料文件以上传</p>
            <p className="text-xs text-zinc-500 mt-1">PDF / Word / 图片 / Excel / PPT / TXT</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--border-subtle)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--text-primary)]">文献库</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
              {totalPapers} 个来源{ingestionSyncState === 'syncing' ? ' · 同步中' : ingestionSyncState === 'error' ? ' · 状态同步失败' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsDiscoverOpen(true)}
              data-testid="library-discover"
              className="flex h-8 items-center gap-1.5 rounded-xl liquid-glass-btn px-2.5 !py-0 text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              aria-label="搜索网络信源"
              title="搜索网络信源并加入文献库"
            >
              <Globe2 className="h-3.5 w-3.5 text-blue-400" />
              发现信源
            </button>
            <button
              onClick={() => setIsCreatingFolder(true)}
              className="w-8 h-8 rounded-xl liquid-glass-btn !p-0 flex items-center justify-center"
              aria-label="新建文献分组"
              title="新建文献分组"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
          <input
            type="text"
            placeholder="搜索文献、作者或关键词..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="liquid-glass-input pl-9 text-xs"
          />
        </div>
      </div>

      {/* Selection bar */}
      {selectedPapers.length > 0 && (
        <div
          data-testid="library-selection-count"
          className="px-5 py-2.5 bg-blue-500/[0.06] border-b border-blue-500/10 flex flex-wrap items-center justify-between gap-2 animate-fade-in"
        >
          <span className="text-xs font-medium text-blue-400">
            已选 {selectedPapers.length} 个文献来源
          </span>
          <div className="flex items-center gap-2">
            {selectedPapers.length >= 2 && (
              <button
                type="button"
                data-testid="library-open-source-matrix"
                onClick={() => setIsSourceMatrixOpen(true)}
                className="btn-ghost text-xs text-[var(--accent-blue)] hover:opacity-80 py-1 px-2"
              >
                <FileSpreadsheet className="h-3 w-3" /> 文献矩阵
              </button>
            )}
            <button onClick={clearSelection} className="btn-ghost text-xs text-[var(--accent-blue)] hover:opacity-80 py-1 px-2">
              <X className="h-3 w-3" /> 清除
            </button>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {showUploadProgress && uploadItems.length > 0 && (
        <div className="px-5 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="section-label">上传进度</span>
            <button
              onClick={() => {
                if (uploadItems.every(i => i.status !== 'uploading')) {
                  setShowUploadProgress(false);
                  setUploadItems([]);
                }
              }}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {uploadItems.every(i => i.status !== 'uploading') ? '关闭' : '隐藏'}
            </button>
          </div>
          {uploadItems.map(item => (
            <div key={item.id} className="py-1">
              <div className="flex items-center gap-2.5 text-xs">
                {item.status === 'uploading' && <Loader2 className="h-3 w-3 animate-spin text-blue-400" />}
                {item.status === 'success' && <CheckCircle className="h-3 w-3 text-emerald-400" />}
                {item.status === 'error' && <AlertCircle className="h-3 w-3 text-red-400" />}
                {item.status === 'pending' && <Circle className="h-3 w-3 text-zinc-600" />}
                <span className="truncate flex-1 text-[var(--text-secondary)]">{item.fileName}</span>
                <span className={`tabular-nums ${
                  item.status === 'success' ? 'text-emerald-400' : item.status === 'error' ? 'text-red-400' : item.status === 'uploading' ? 'text-blue-400' : 'text-zinc-600'
                }`}>
                  {item.status === 'uploading'
                    ? (item.progress >= 100 ? '解析中...' : `上传中 ${item.progress}%`)
                    : item.status === 'success' ? '完成' : item.status === 'error' ? '失败' : '等待'}
                </span>
              </div>
              {item.status === 'uploading' && (
                <div className="ml-5 mt-1 h-1 overflow-hidden rounded-full bg-[var(--glass-subtle)]">
                  <div
                    className={`h-full rounded-full bg-blue-500 transition-all duration-300 ${item.progress >= 100 ? 'animate-pulse' : ''}`}
                    style={{ width: `${Math.max(4, item.progress)}%` }}
                  />
                </div>
              )}
              {item.status === 'error' && item.error && (
                <p className="ml-5 mt-0.5 text-[10px] leading-relaxed text-red-400/80">{item.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Skipped files notice */}
      {skippedFilesNotice && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 animate-fade-in" data-testid="library-skipped-notice">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-300">{skippedFilesNotice}(支持 PDF/DOCX/TXT/MD 等)</p>
        </div>
      )}

      {/* Paper list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {filteredFolders.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl liquid-glass-inset flex items-center justify-center mx-auto mb-4">
              <FileText className="h-7 w-7 text-zinc-700" />
            </div>
            <p className="text-sm text-zinc-500 font-medium">暂无文献来源</p>
            <p className="text-xs text-zinc-600 mt-1.5">拖拽论文、网页笔记或资料文件到此处，建立文献本来源。</p>
            <button
              type="button"
              onClick={() => setIsSourceGuideOpen(true)}
              className="mt-4 rounded-full border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:bg-[var(--glass-hover)]"
              data-testid="library-empty-examples"
            >
              查看示例
            </button>
          </div>
        ) : (
          filteredFolders.map((folder) => (
            <div key={folder.id} className="mb-2">
              {/* Folder header */}
              <div
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-300 group ${
                  activeFolderId === folder.id ? 'bg-[var(--glass-subtle)]' : 'hover:bg-[var(--glass-subtle)]'
                }`}
                onClick={() => handleFolderClick(folder.id)}
              >
                <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-300 ${!expandedFolders.has(folder.id) ? '-rotate-90' : ''}`} />
                <FolderPlus className="h-4 w-4 text-blue-400" />
                <span className="flex-1 truncate text-sm font-medium text-[var(--text-primary)]">{folder.name}</span>
                <span className="text-[10px] text-zinc-600 tabular-nums">{folder.papers.length}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); selectAllPapers(folder.id); }}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-[var(--bg-card)] flex items-center justify-center text-zinc-500 hover:text-[var(--text-primary)] transition-all"
                  title="全选"
                >
                  <CheckCircle2 className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (folder.papers.length === 0 || window.confirm(`删除分组「${folder.name}」及其中 ${folder.papers.length} 个来源?此操作不可撤销。`)) {
                      deleteFolder(folder.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-[var(--glass-subtle)] flex items-center justify-center text-zinc-500 hover:text-red-400 transition-all"
                  title="删除分组"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {/* Papers */}
              {expandedFolders.has(folder.id) && (
                <div className="ml-5 mt-1 space-y-0.5">
                  {folder.papers.map((paper, idx) => (
                    <div
                      key={paper.id}
                      data-testid={`library-paper-${paper.id}`}
                      aria-selected={selectedPapers.includes(paper.id)}
                      className={`library-source-card flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-300 group animate-fade-in-up ${
                        selectedPapers.includes(paper.id)
                          ? 'library-source-card-selected'
                          : ''
                      } ${flashPaperId === paper.id ? 'ring-2 ring-blue-400/80 bg-blue-500/10' : ''}`}
                      style={{ animationDelay: `${idx * 40}ms` }}
                      onClick={() => togglePaperSelection(paper.id)}
                      onContextMenu={(e) => handleContextMenu(e, paper)}
                    >
                      {/* Checkbox */}
                      <div className="mt-0.5 flex-shrink-0">
                        {selectedPapers.includes(paper.id) ? (
                          <CheckCircle2 className="h-4 w-4 text-blue-400" />
                        ) : (
                          <Circle className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors" />
                        )}
                      </div>

                      <FileTypeIcon fileType={paper.fileType} />

                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] truncate font-medium text-[var(--text-primary)] leading-tight">{paper.title}</p>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-1 truncate">
                          {paper.authors.join(', ')} · {paper.year}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border ${fileTypeBadgeStyle(paper.fileType)}`}>
                            {paper.fileType.toUpperCase()}
                          </span>
                          {(() => {
                            const badge = ingestionBadge(paper);
                            return badge ? (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border ${badge.className}`}>
                                {badge.label}
                              </span>
                            ) : null;
                          })()}
                          {(() => {
                            const badge = mineruBadge(paper);
                            return badge ? (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border ${badge.className}`}>
                                {badge.label}
                              </span>
                            ) : null;
                          })()}
                          <span className="text-[10px] text-[var(--text-tertiary)]">{formatFileSize(paper.fileSize)}</span>
                          {paper.keywords.length > 0 && (
                            <span className="text-[10px] text-[var(--text-tertiary)] truncate">
                              · {paper.keywords.slice(0, 2).join(', ')}
                            </span>
                          )}
                        </div>
                        {citationFocus?.paperId === paper.id && (
                          <div
                            data-testid="library-citation-focus"
                            className="mt-2 rounded-lg border border-blue-400/25 bg-blue-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-blue-100"
                          >
                            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-blue-300">
                              <span>证据定位</span>
                              <span className="text-blue-300/50">·</span>
                              <span>{formatCitationReveal(citationFocus.citation)}</span>
                            </div>
                            {citationFocus.citation.sourceTitle && citationFocus.citation.sourceTitle !== paper.title && (
                              <p className="mt-1 truncate text-[var(--text-tertiary)]">{citationFocus.citation.sourceTitle}</p>
                            )}
                            {citationFocus.citation.excerpt && (
                              <p className="mt-1 text-[var(--text-secondary)]">
                                &ldquo;{truncateEvidenceText(citationFocus.citation.excerpt)}&rdquo;
                              </p>
                            )}
                            {citationContext?.paperId === paper.id && citationContext.status === 'loading' && (
                              <p className="mt-1.5 text-[var(--text-tertiary)]">正在调取来源片段...</p>
                            )}
                            {citationContext?.paperId === paper.id && citationContext.status === 'ready' && (
                              <div
                                data-testid="library-citation-context"
                                className="mt-1.5 rounded-md border border-blue-300/15 bg-black/15 px-2 py-1.5"
                              >
                                <div className="flex flex-wrap items-center gap-1.5 font-semibold text-blue-200">
                                  <span>原文片段</span>
                                  <span className="text-blue-300/50">·</span>
                                  <span>{citationContext.snippet.locator}</span>
                                </div>
                                <p className="mt-1 text-[var(--text-secondary)]">
                                  &ldquo;{truncateEvidenceText(citationContext.snippet.text, 180)}&rdquo;
                                </p>
                              </div>
                            )}
                            {citationContext?.paperId === paper.id && citationContext.status === 'missing' && (
                              <p className="mt-1.5 text-[var(--text-tertiary)]">
                                当前卡片已有引用摘录；完整来源片段尚未同步到文献库。
                              </p>
                            )}
                            {citationContext?.paperId === paper.id && citationContext.status === 'error' && (
                              <p className="mt-1.5 text-[var(--text-tertiary)]">
                                来源片段读取失败，请稍后重试。
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* More button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleContextMenu(e, paper); }}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center text-zinc-600 hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all mt-0.5"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bottom upload area */}
      <div className="px-4 py-4 border-t border-[var(--border-subtle)]">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_STRING}
          multiple
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />

        <div
          className="border border-dashed border-[var(--border-subtle)] rounded-2xl p-5 text-center cursor-pointer hover:border-[var(--border-hover)] hover:bg-[var(--glass-subtle)] transition-all duration-500"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-6 w-6 mx-auto mb-2 text-[var(--text-quaternary)]" />
          <p className="text-xs font-medium text-[var(--text-tertiary)]">拖拽文献或资料文件到此处上传</p>
          <p className="text-[10px] text-[var(--text-quaternary)] mt-1">或点击选择论文、笔记、表格等文件</p>
        </div>
      </div>

      {/* Create folder dialog */}
      {isSourceGuideOpen && (
        <SourceGuideModal
          pastedSourceText={pastedSourceText}
          pastedSourceTitle={pastedSourceTitle}
          onClose={dismissSourceGuide}
          onPasteTextChange={setPastedSourceText}
          onPasteTitleChange={setPastedSourceTitle}
          onPasteSubmit={handlePasteTextAsSource}
          onUpload={openFilePickerFromGuide}
        />
      )}

      {/* Discover web sources */}
      {isDiscoverOpen && (
        <DiscoverSourcesModal
          notebookId={notebookId}
          onClose={() => setIsDiscoverOpen(false)}
          onIngestFiles={handleIngestDiscoveredFiles}
        />
      )}

      {/* Create folder dialog */}
      {isCreatingFolder && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)]/60 backdrop-blur-sm animate-fade-in" onClick={() => setIsCreatingFolder(false)}>
          <div className="liquid-glass-card w-[300px] p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">新建文献分组</h3>
            <p className="text-xs text-zinc-500 mb-4">按课题、实验或组会主题组织文献、网页和笔记来源。</p>
            <input
              type="text"
              placeholder="课题或分组名称..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              className="liquid-glass-input mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setIsCreatingFolder(false)} className="liquid-glass-btn flex-1 py-2 text-xs">取消</button>
              <button onClick={handleCreateFolder} className="liquid-glass-btn !bg-gradient-to-r !from-blue-500 !to-blue-600 hover:!from-blue-400 hover:!to-blue-500 !text-white !border-0 flex-1 py-2 text-xs">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Source matrix preview */}
      {isSourceMatrixOpen && (
        <div
          className="absolute inset-0 z-[75] flex items-center justify-center bg-[var(--bg-primary)]/65 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsSourceMatrixOpen(false)}
        >
          <div
            data-testid="library-source-matrix-panel"
            className="liquid-glass-card flex max-h-[82vh] w-full max-w-[520px] flex-col p-0 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <FileSpreadsheet className="h-4 w-4 text-teal-400" />
                  <span>文献矩阵</span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">基于已选来源的本地字段对比</p>
              </div>
              <button
                type="button"
                onClick={() => setIsSourceMatrixOpen(false)}
                className="rounded-lg p-1.5 text-[var(--text-tertiary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]"
                aria-label="关闭文献矩阵"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {selectedSourceRows.length < 2 ? (
                <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-200">
                  至少选择 2 个文献来源后，可查看标题、分组、关键词和证据状态的并排对比。
                </div>
              ) : (
                <div className="space-y-2">
                  <div
                    data-testid="library-source-matrix-note"
                    className="rounded-xl border border-teal-400/20 bg-teal-500/10 px-3 py-2 text-[11px] leading-relaxed text-teal-100"
                  >
                    自动从已入库文本中抽取方法、数据、结果和局限线索，作为跨文献比较前的证据表；不会生成未在来源中出现的结论。
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
                    <div className="min-w-[720px] divide-y divide-[var(--border-subtle)]">
                      <div className="grid grid-cols-[150px_repeat(4,minmax(130px,1fr))] bg-[var(--glass-subtle)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                        <div className="px-3 py-2">来源</div>
                        <div className="px-3 py-2">方法</div>
                        <div className="px-3 py-2">数据</div>
                        <div className="px-3 py-2">结果</div>
                        <div className="px-3 py-2">局限</div>
                      </div>
                      {selectedSourceRows.map(({ folderName, paper }, index) => {
                        const facets = buildSourceMatrixFacets(paper);
                        return (
                          <div
                            key={paper.id}
                            data-testid="library-source-matrix-row"
                            className="grid grid-cols-[150px_repeat(4,minmax(130px,1fr))] bg-[var(--bg-elevated)] text-[11px]"
                          >
                            <div className="border-r border-[var(--border-subtle)] px-3 py-3">
                              <div className="mb-1 flex items-center gap-1.5 font-semibold text-teal-300">
                                <span>来源 {index + 1}</span>
                                <span className="text-teal-300/45">·</span>
                                <span className="truncate">{folderName}</span>
                              </div>
                              <div className="line-clamp-2 font-semibold text-[var(--text-primary)]">{paper.title}</div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${fileTypeBadgeStyle(paper.fileType)}`}>
                                  {paper.fileType.toUpperCase()}
                                </span>
                                <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                                  {sourceMatrixEvidenceStatus(paper)}
                                </span>
                              </div>
                              <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
                                [{paper.shortName}]
                                {paper.year ? ` · ${paper.year}` : ''}
                              </div>
                            </div>
                            {facets.map(facet => (
                              <div
                                key={facet.key}
                                data-testid={`library-source-matrix-${facet.key}`}
                                className="border-r border-[var(--border-subtle)] px-3 py-3 last:border-r-0"
                              >
                                <div className={`mb-1 text-[10px] font-medium ${facet.extracted ? 'text-emerald-300' : 'text-amber-300'}`}>
                                  {facet.evidenceLabel}
                                </div>
                                {facet.extracted ? (
                                  <button
                                    type="button"
                                    data-testid={`library-source-matrix-${facet.key}-jump`}
                                    className="block w-full rounded-lg text-left leading-relaxed text-[var(--text-secondary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300/60"
                                    title="打开来源片段并核验这条矩阵线索"
                                    onClick={() => {
                                      setIsSourceMatrixOpen(false);
                                      void openSourcePreview(paper, {
                                        key: facet.key,
                                        label: facet.label,
                                        excerpt: facet.excerpt,
                                      });
                                    }}
                                  >
                                    {facet.excerpt}
                                  </button>
                                ) : (
                                  <p className="leading-relaxed text-[var(--text-tertiary)]">
                                    {facet.emptyHint}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Source chunks detail */}
      {sourcePreview && (
        <div
          className="absolute inset-0 z-[80] flex items-center justify-center bg-[var(--bg-primary)]/65 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => {
            setSourcePreview(null);
            setSourcePreviewFocus(null);
          }}
        >
          <div
            data-testid="library-source-detail-panel"
            className="liquid-glass-card flex max-h-[82vh] w-full max-w-[420px] flex-col p-0 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <FileText className="h-4 w-4 text-blue-400" />
                  <span>来源片段</span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{sourcePreview.paper.title}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSourcePreview(null);
                  setSourcePreviewFocus(null);
                }}
                className="rounded-lg p-1.5 text-[var(--text-tertiary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]"
                aria-label="关闭来源片段"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {sourcePreview.status === 'loading' && (
                <div className="flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-3 text-xs text-blue-200">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在读取来源片段...
                </div>
              )}
              {sourcePreview.status === 'missing' && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-200">
                  当前来源尚未同步完整片段列表；仍可使用已保存的标题、摘要和引用摘录。
                </div>
              )}
              {sourcePreview.status === 'error' && (
                <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-3 text-xs leading-relaxed text-red-200">
                  来源片段读取失败，请稍后重试。
                </div>
              )}
              {sourcePreview.status === 'ready' && (() => {
                const chunks = (sourcePreview.source.chunks || [])
                  .filter(chunk => Boolean(chunk.text?.trim()))
                  .slice(0, 12);
                const dataPreview = buildDataTablePreviewForPaper(sourcePreview.paper);
                if (chunks.length === 0 && !dataPreview) {
                  return (
                    <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-200">
                      来源详情已找到，但暂未包含可展示的原文片段。
                    </div>
                  );
                }
                const citationLeads = buildSourceCitationLeads(chunks);
                return (
                  <div className="space-y-2">
                    {sourcePreviewFocus && (
                      <div
                        data-testid="library-source-matrix-focus"
                        className="rounded-xl border border-teal-400/20 bg-teal-500/10 px-3 py-3"
                      >
                        <div className="text-xs font-semibold text-teal-100">正在核验：{sourcePreviewFocus.label}</div>
                        <p className="mt-1 text-[11px] leading-relaxed text-teal-100/80">
                          {sourcePreviewFocus.excerpt}
                        </p>
                      </div>
                    )}
                    {dataPreview && (
                      <div
                        data-testid="library-data-table-preview"
                        className="rounded-xl border border-teal-400/20 bg-teal-500/10 px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-100">
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                            <span>数据速览</span>
                          </div>
                          <div className="text-[10px] text-teal-100/65">
                            {dataPreview.sheetName ? `${dataPreview.sheetName} · ` : ''}
                            {dataPreview.rowCount} 行 · {dataPreview.columnCount} 列
                          </div>
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                          基于上传表格文本的本地采样分析，用于确认变量、缺失值和 Results 写作线索；不替代正式统计检验。
                        </p>
                        <div className="mt-2 grid gap-1.5">
                          {dataPreview.columns.slice(0, 6).map(column => (
                            <div
                              key={column.name}
                              className="rounded-lg border border-teal-300/15 bg-black/10 px-2.5 py-2"
                            >
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="truncate font-semibold text-teal-100">{column.name}</span>
                                <span className="shrink-0 text-teal-100/60">{dataColumnTypeLabel(column)}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
                                <span>非空 {column.nonEmptyCount}</span>
                                <span>缺失 {column.missingCount}</span>
                                {column.type !== 'text' && (
                                  <>
                                    <span>均值 {formatPreviewNumber(column.mean)}</span>
                                    <span>范围 {formatPreviewNumber(column.min)}-{formatPreviewNumber(column.max)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 rounded-lg border border-teal-300/15 bg-teal-950/20 px-2.5 py-2 text-[11px] leading-relaxed text-teal-100/80">
                          {dataPreview.resultsDraftHint}
                        </div>
                        {dataPreview.columnCount > dataPreview.columns.length && (
                          <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)]">
                            为保持界面轻量，仅展示前 {dataPreview.columns.length} 列。
                          </p>
                        )}
                      </div>
                    )}
                    {chunks.length === 0 && (
                      <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-200">
                        当前来源暂未包含可展示的原文片段；可先使用数据速览检查表格结构。
                      </div>
                    )}
                    {citationLeads.length > 0 && (
                      <div
                        data-testid="library-source-citation-leads"
                        className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold text-blue-200">引用线索</div>
                          <div className="text-[10px] text-blue-200/65">基于已入库片段</div>
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                          以下候选句只来自当前来源片段，用于写作时回查证据，不替代阅读全文。
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {citationLeads.map((lead, index) => (
                            <div
                              key={lead.id}
                              data-testid="library-source-citation-lead"
                              className="rounded-lg border border-blue-300/15 bg-black/10 px-2.5 py-2"
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-blue-200">
                                <span>线索 {index + 1}</span>
                                <span className="text-blue-300/45">·</span>
                                <span>{lead.locator}</span>
                              </div>
                              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                                {truncateEvidenceText(lead.text, 180)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-tertiary)]">
                      <span>已入库 {sourcePreview.source.chunkCount || sourcePreview.source.chunks?.length || chunks.length} 个片段</span>
                      {sourcePreview.source.chunks && sourcePreview.source.chunks.length > chunks.length && (
                        <span>显示前 {chunks.length} 个</span>
                      )}
                    </div>
                    {chunks.map((chunk, index) => (
                      <div
                        key={chunk.id || `${sourcePreview.source.id}-${index}`}
                        data-testid="library-source-detail-chunk"
                        className={`rounded-xl border px-3 py-2.5 ${
                          sourceMatrixFocusMatchesChunk(chunk, sourcePreviewFocus)
                            ? 'border-teal-300/40 bg-teal-500/10'
                            : 'border-[var(--border-subtle)] bg-[var(--glass-subtle)]'
                        }`}
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-blue-300">
                          <span>{sourceChunkLocator(chunk)}</span>
                          {chunk.sourceTitle && chunk.sourceTitle !== sourcePreview.source.title && (
                            <>
                              <span className="text-blue-300/45">·</span>
                              <span className="truncate text-[var(--text-tertiary)]">{chunk.sourceTitle}</span>
                            </>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                          {truncateEvidenceText(chunk.text || '', 260)}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] liquid-glass-card py-1.5 min-w-[180px] animate-scale-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => copyShortName(contextMenu.paper)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-300 hover:bg-[var(--glass-hover)] transition-colors"
          >
            <Copy className="h-3.5 w-3.5 text-zinc-500" />
            复制文献简称 [{contextMenu.paper.shortName}]
          </button>
          <button
            data-testid="library-open-source-detail"
            onClick={() => {
              const paper = contextMenu.paper;
              setContextMenu(null);
              void openSourcePreview(paper);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-300 hover:bg-[var(--glass-hover)] transition-colors"
          >
            <FileText className="h-3.5 w-3.5 text-blue-400" />
            查看来源片段
          </button>
          <div className="h-px bg-[var(--border-subtle)] my-1" />
          <button
            data-testid="library-remove-paper"
            onClick={() => {
              const paper = contextMenu.paper;
              const ownerFolder = folders.find(folder => folder.papers.some(p => p.id === paper.id));
              if (ownerFolder && window.confirm(`移除来源「${paper.title}」?`)) {
                removePaper(ownerFolder.id, paper.id);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            移除来源
          </button>
        </div>
      )}
    </div>
  );
}
