// 学术论文智能宣讲助手 - 核心类型定义
import type { KnowledgeMapData } from '@/lib/knowledge-map-types';

// 文献库相关类型
export type FileType = 'pdf' | 'doc' | 'docx' | 'txt' | 'jpg' | 'jpeg' | 'png' | 'gif' | 'webp' | 'md' | 'csv' | 'xlsx' | 'ppt' | 'pptx' | 'other';

// MinerU 提取的图表信息
export interface MinerUFigure {
  /** 图表在论文中的编号标签，如 "Fig.1", "Figure 2" */
  label: string;
  /** 图表标题/caption */
  caption: string;
  /** 图表所在页码 (0-based) */
  pageIdx: number;
  /** 图表在页面中的归一化位置 [x0, y0, x1, y1]，范围 0-1000 */
  bbox: number[];
  /** 图片文件的本地存储路径 (相对于 public/) */
  localPath: string;
  /** 图片的公开访问 URL (如 CDN 链接) */
  imageUrl: string;
  /** 图片宽度 (px) */
  width?: number;
  /** 图片高度 (px) */
  height?: number;
}

export interface IngestionStage {
  name: 'store' | 'extract' | 'mineru' | 'normalize' | 'chunk' | 'embed' | 'index';
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'error';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface MinerUExtraction {
  status: 'not_configured' | 'pending' | 'running' | 'succeeded' | 'failed' | 'error';
  figureCount?: number;
  error?: string;
  updatedAt: string;
}

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number;
  keywords: string[];
  abstract?: string;
  content: string;
  rawContent?: string; // 原始文档提取的文本（供 AI 对话时使用）
  shortName: string; // 用于引用标注，格式：[第一作者. 年份]
  fileName: string;
  fileType: FileType;
  fileSize: number; // bytes
  fileUrl?: string; // 存储路径（开发：本地路径，生产：S3 key 或签名 URL）
  fileKey?: string; // S3 对象 key（生产环境持久化用）
  uploadTime: string;
  /** 期刊/会议名称 */
  journal?: string;
  /** DOI */
  doi?: string;
  /** MinerU 提取的论文图表列表 */
  mineruFigures?: MinerUFigure[];
  /** MinerU 提取状态: pending/running/done/failed */
  mineruStatus?: 'pending' | 'running' | 'done' | 'failed';
  /** 后端统一 ingestion 记录中的 MinerU 图表提取状态 */
  mineru?: MinerUExtraction;
  /** 后端 ingestion 状态：source/chunk/index 管线是否已完成 */
  ingestionStatus?: 'pending' | 'running' | 'succeeded' | 'failed' | 'error';
  /** 后端 ingestion stage 明细，包含可选 MinerU 图表提取阶段 */
  ingestionStages?: IngestionStage[];
  /** 后端生成并持久化的 chunk 数量 */
  ingestionChunkCount?: number;
  /** 向量索引状态，未配置 embedding 时为 not_configured */
  vectorIndex?: {
    status: 'not_configured' | 'running' | 'succeeded' | 'failed';
    dimension?: number;
    count?: number;
  };
}

export interface ProjectFolder {
  id: string;
  name: string;
  papers: Paper[];
  createdAt: string;
  updatedAt: string;
}

// 对话相关类型
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: Citation[];
  retrieval?: RetrievalMetadata;
  citationAudit?: CitationAuditResult;
  followUps?: string[];
  timestamp: string;
}

export interface RetrievalMetadata {
  mode: string;
  persistedSourceCount: number;
  vectorIndexedSourceCount: number;
  degraded?: boolean;
  reason?: string;
}

export interface CitationAuditResult {
  status: 'none' | 'pass' | 'missing-markers' | 'invalid-markers';
  citedNumbers: number[];
  invalidNumbers: number[];
  uncitedNumbers: number[];
  citationCount: number;
  markerCount: number;
  warning?: string;
}

export interface Citation {
  paperId: string;
  paperShortName: string;
  excerpt: string;
  snippet?: string;
  position?: { start: number; end: number };
  sourceId?: string;
  chunkId?: string;
  sourceTitle?: string;
  score?: number;
  chunkIndex?: number;
  page?: number;
}

// 富文本编辑器相关类型
export interface RichTextBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'image' | 'chart' | 'table' | 'citation' | 'formula';
  content: string;
  metadata?: Record<string, unknown>;
  citations?: Citation[];
  bindings?: {
    imageId?: string;
    audioId?: string;
    pptSlideId?: string;
  };
}

export interface Report {
  id: string;
  title: string;
  blocks: RichTextBlock[];
  citations: Citation[];
  createdAt: string;
  updatedAt: string;
}

// 学术可视化图片类型
export interface AcademicImage {
  id: string;
  type: 'framework' | 'flowchart' | 'comparison' | 'mechanism' | 'result';
  prompt: string;
  imageUrl: string;
  sourceText: string;
  citations: Citation[];
  bindings?: {
    reportBlockId?: string;
    pptSlideId?: string;
  };
}

// 双语文本类型
export interface BilingualText {
  id: string;
  reportBlockId: string;
  subtitleText: string; // 字幕文本（书面版）
  audioText: string; // 音频文本（口语版）
  audioUrl?: string;
  createdAt: string;
}

// PPT相关类型
export interface PPTSlide {
  id: string;
  order: number;
  title: string;
  content: string;
  imageUrl?: string | null;
  imageId?: string;
  audioId?: string;
  subtitleId?: string;
  narration?: string;
  highlightConfig?: HighlightConfig;
  reportBlockId?: string;
  citations: Citation[];
}

export interface HighlightConfig {
  style: 'box' | 'circle' | 'arrow';
  color: string;
  thickness: number;
  triggerTime: number; // 音频播放到此时触发高亮
  region?: { x: number; y: number; width: number; height: number };
}

// 互动统计类型
export interface InteractionStats {
  slideId: string;
  likes: number;
  bookmarks: number;
  shares: number;
  playCount: number;
  watchTime: number;
  completionRate: number;
}

export interface ProjectStats {
  totalViews: number;
  totalLikes: number;
  totalBookmarks: number;
  totalShares: number;
  avgWatchTime: number;
  topSlides: { slideId: string; title: string; views: number }[];
}

// 音频相关类型
export interface AudioConfig {
  voiceId: string;
  speed: number; // 0.5-2.0
  pitch: number;
  volume: number;
}

export interface VoiceClone {
  id: string;
  name: string;
  sampleUrl: string;
  createdAt: string;
}

// 模型运行配置。C 端默认由账号绑定的服务端配置托管；仅在显式兼容旧 BYOK 流程时使用请求侧配置。
export interface RuntimeAIConfig {
  apiBase: string;
  apiKey: string;
  model: string;
  visionModel: string;
  embeddingModel: string;
  ttsSpeaker: string;
}

export interface StudioPromptRequest {
  id: string;
  label: string;
  prompt: string;
  createdAt: string;
}

export interface VirtualClassroomViewer {
  url: string;
  title: string;
  source: 'confirmed' | 'recent';
  openedAt: string;
  sourceCount?: number;
  sourceIds?: string[];
  sourceSummary?: string;
  sceneCount?: number;
  actionsCount?: number;
  scenes?: Array<{
    id: string;
    order: number;
    type: string;
    title: string;
    objective: string;
    plannedActions: string[];
  }>;
  evidence?: Array<{
    sourceId: string;
    sourceTitle: string;
    snippet: string;
  }>;
}

export interface KnowledgeMapViewer {
  title: string;
  source: 'generated' | 'recent';
  openedAt: string;
  sourceCount?: number;
  map: KnowledgeMapData;
  citations: Citation[];
  retrieval?: RetrievalMetadata;
  citationAudit?: CitationAuditResult;
}

// 发布与导出类型
export interface PublishConfig {
  isPublic: boolean;
  password?: string;
  allowedUsers?: string[];
}

export type ExportFormat = 'pdf' | 'docx' | 'pptx' | 'mp3' | 'mp4';

// Studio功能入口类型
export type StudioFeature =
  | 'presentation' // PPT生成与编辑
  | 'audio' // 音频概览
  | 'sync' // 音画同步
  | 'interaction' // 互动设置
  | 'analytics'; // 案例统计

// 编辑器模式类型
export type EditorMode = 'chat' | 'richText';

// 文献引用格式类型
export type CitationFormat = 'GB/T 7714' | 'APA' | 'MLA';
