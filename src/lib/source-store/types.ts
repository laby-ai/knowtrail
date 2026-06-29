import type { RagSourceInput, SourceChunk } from '@/lib/rag';
import type { RuntimeAIConfig } from '@/types';

export const DEFAULT_SOURCE_STORE_PATH = '.data/sources/sources.json';
export const POSTGRES_STORE_ID = 'default';
export const POSTGRES_PAYLOAD_TABLE = 'lingbi_source_store';
export const POSTGRES_SOURCES_TABLE = 'lingbi_sources';
export const POSTGRES_CHUNKS_TABLE = 'lingbi_source_chunks';
export const POSTGRES_STAGES_TABLE = 'lingbi_ingestion_stages';
export const POSTGRES_TABLES = [
  POSTGRES_PAYLOAD_TABLE,
  POSTGRES_SOURCES_TABLE,
  POSTGRES_CHUNKS_TABLE,
  POSTGRES_STAGES_TABLE,
] as const;
export const POSTGRES_READY_CHUNK_SEARCH_ENV = 'POSTGRES_READY_CHUNK_SEARCH';

export type IngestionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'error';
export type IngestionStageName = 'store' | 'extract' | 'mineru' | 'normalize' | 'chunk' | 'embed' | 'index';
export type VectorIndexStatus = 'not_configured' | 'running' | 'succeeded' | 'failed';
export type MinerUExtractionStatus = 'not_configured' | IngestionStatus;

export interface IngestionStage {
  name: IngestionStageName;
  status: IngestionStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface VectorIndexRecord {
  status: VectorIndexStatus;
  model?: string;
  dimension?: number;
  count?: number;
  path?: string;
  error?: string;
  updatedAt: string;
}

export interface MinerUExtractionRecord {
  status: MinerUExtractionStatus;
  figureCount?: number;
  error?: string;
  updatedAt: string;
}

export interface StoredSourceRecord {
  id: string;
  ownerMemberId?: string;
  notebookId?: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  title: string;
  shortName: string;
  storageKey?: string;
  fileUrl?: string;
  status: IngestionStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  stages: IngestionStage[];
  chunks: SourceChunk[];
  chunkCount: number;
  tokenEstimate: number;
  vectorIndex: VectorIndexRecord;
  mineru?: MinerUExtractionRecord;
}

export interface IngestionSourceInput extends RagSourceInput {
  id: string;
  ownerMemberId?: string;
  notebookId?: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  fileKey?: string;
  fileUrl?: string;
}

export interface IngestExtractedSourceOptions {
  aiConfig?: Partial<RuntimeAIConfig>;
  embedder?: (texts: string[]) => Promise<number[][]>;
}

export interface SourceStoreFile {
  version: 1;
  updatedAt: string;
  sources: StoredSourceRecord[];
}

export interface PostgresSourceRow {
  id: string;
  file_name: string;
  file_type: string;
  file_size?: string | number | null;
  title: string;
  short_name: string;
  storage_key?: string | null;
  file_url?: string | null;
  status: IngestionStatus;
  error?: string | null;
  chunk_count?: number | null;
  token_estimate?: number | null;
  vector_status: VectorIndexStatus;
  vector_model?: string | null;
  vector_dimension?: number | null;
  vector_count?: number | null;
  vector_path?: string | null;
  vector_error?: string | null;
  mineru_status?: MinerUExtractionStatus | null;
  mineru_figure_count?: number | null;
  mineru_error?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  payload?: unknown;
}

export interface PostgresChunkRow {
  id: string;
  source_id: string;
  source_index: number;
  chunk_index: number;
  page?: number | null;
  paper_short_name: string;
  source_title: string;
  text: string;
  token_estimate: number;
  payload?: unknown;
}

export interface PostgresStageRow {
  source_id: string;
  name: IngestionStageName;
  status: IngestionStatus;
  started_at?: Date | string | null;
  completed_at?: Date | string | null;
  error?: string | null;
  payload?: unknown;
}

export interface PostgresPayloadRow {
  payload?: unknown;
}

export interface PgQueryResult<T> {
  rows: T[];
}

export interface PgPoolClientLike {
  query<T = unknown>(statement: string, params?: unknown[]): Promise<PgQueryResult<T>>;
  release(): void;
}

export interface PgPoolLike {
  query<T = unknown>(statement: string, params?: unknown[]): Promise<PgQueryResult<T>>;
  connect(): Promise<PgPoolClientLike>;
}

export type PgPoolConstructor = new (config: { connectionString: string }) => PgPoolLike;

export interface SourceStoreAdapterStatus {
  provider: 'local-json' | 'postgres';
  configured: boolean;
  path?: string;
  databaseUrlConfigured?: boolean;
  table?: string;
  tables?: string[];
  normalizedSchema?: boolean;
  readyChunkSearch?: {
    mode: PostgresReadyChunkSearchMode;
    env: typeof POSTGRES_READY_CHUNK_SEARCH_ENV;
  };
}

export interface ReadySourceChunksResult {
  chunks: SourceChunk[];
  persistedSourceCount: number;
  vectorIndexedSourceCount: number;
  sourceIds: string[];
}

export interface ReadySourceChunksScope {
  identities?: string[];
  ownerMemberId?: string;
  notebookId?: string;
  query?: string;
  topK?: number;
}

export type PostgresReadyChunkSearchMode = 'ilike' | 'fts';

export interface PostgresReadyChunkSearchSql {
  mode: PostgresReadyChunkSearchMode;
  filter: string;
  params: string[];
  selectRank: string;
  orderByPrefix: string;
  queryTokens: string[];
}

export interface SourceStoreAdapter {
  read(): Promise<SourceStoreFile>;
  mutate(mutator: (store: SourceStoreFile) => SourceStoreFile | Promise<SourceStoreFile>): Promise<SourceStoreFile>;
  status(): SourceStoreAdapterStatus;
  listReadyChunks?(scope?: ReadySourceChunksScope): Promise<ReadySourceChunksResult>;
}
