import { createRequire } from 'node:module';
import { buildSourceChunks, type RagSourceInput, type SourceChunk } from '@/lib/rag';
import { embedTexts } from '@/lib/ai-service';
import { upsertSourceChunks } from '@/lib/vector-store';
import { hasRuntimeAIProvider, redactRuntimeAISecrets } from '@/lib/runtime-ai-config';
import { LocalJsonSourceStoreAdapter } from '@/lib/source-store/local-json-adapter';
import {
  POSTGRES_CHUNKS_TABLE,
  POSTGRES_PAYLOAD_TABLE,
  POSTGRES_READY_CHUNK_SEARCH_ENV,
  POSTGRES_SOURCES_TABLE,
  POSTGRES_STAGES_TABLE,
  POSTGRES_STORE_ID,
  POSTGRES_TABLES,
  type IngestExtractedSourceOptions,
  type IngestionSourceInput,
  type IngestionStage,
  type IngestionStageName,
  type IngestionStatus,
  type MinerUExtractionRecord,
  type MinerUExtractionStatus,
  type PgPoolClientLike,
  type PgPoolConstructor,
  type PgPoolLike,
  type PostgresChunkRow,
  type PostgresPayloadRow,
  type PostgresReadyChunkSearchMode,
  type PostgresReadyChunkSearchSql,
  type PostgresSourceRow,
  type PostgresStageRow,
  type ReadySourceChunksResult,
  type ReadySourceChunksScope,
  type SourceStoreAdapter,
  type SourceStoreAdapterStatus,
  type SourceStoreFile,
  type StoredSourceRecord,
  type VectorIndexRecord,
} from '@/lib/source-store/types';

export type {
  IngestExtractedSourceOptions,
  IngestionSourceInput,
  IngestionStage,
  IngestionStageName,
  IngestionStatus,
  MinerUExtractionRecord,
  MinerUExtractionStatus,
  PgPoolClientLike,
  PostgresReadyChunkSearchMode,
  PostgresReadyChunkSearchSql,
  ReadySourceChunksResult,
  ReadySourceChunksScope,
  SourceStoreAdapterStatus,
  SourceStoreFile,
  StoredSourceRecord,
  VectorIndexStatus,
  VectorIndexRecord,
} from '@/lib/source-store/types';

const nodeRequire = createRequire(import.meta.url);

function nowIso(): string {
  return new Date().toISOString();
}

function createStages(): IngestionStage[] {
  return (['store', 'extract', 'mineru', 'normalize', 'chunk', 'embed', 'index'] as IngestionStageName[]).map(name => ({
    name,
    status: 'pending',
  }));
}

function setStage(
  stages: IngestionStage[],
  name: IngestionStageName,
  status: IngestionStatus,
  error?: string,
): IngestionStage[] {
  const timestamp = nowIso();
  const hasStage = stages.some(stage => stage.name === name);
  const nextStages = hasStage ? stages : [...stages, { name, status: 'pending' as IngestionStatus }];
  return nextStages.map(stage => {
    if (stage.name !== name) return stage;
    return {
      ...stage,
      status,
      startedAt: stage.startedAt || timestamp,
      completedAt: status === 'running' ? stage.completedAt : timestamp,
      error,
    };
  });
}

function mineruStatusToStageStatus(status: MinerUExtractionStatus): IngestionStatus {
  if (status === 'not_configured') return 'failed';
  return status;
}

function safeErrorMessage(error: unknown, apiKey?: string): string {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  return redactRuntimeAISecrets(message, apiKey);
}

function parseJsonPayload<T>(value: unknown): Partial<T> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed as Partial<T> : {};
  } catch {
    return {};
  }
}

function isoString(value: Date | string | null | undefined, fallback = nowIso()): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return new Date(value).toISOString();
  return fallback;
}

function optionalIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return isoString(value);
}

function optionalNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stageOrder(name: IngestionStageName): number {
  return createStages().findIndex(stage => stage.name === name);
}

function sourceMatchesIdentities(source: StoredSourceRecord, identities: Set<string>): boolean {
  if (identities.size === 0) return true;
  return identities.has(source.id) || identities.has(source.fileName) || identities.has(source.title);
}

function sourceMatchesOwner(source: StoredSourceRecord, ownerMemberId?: string): boolean {
  if (!ownerMemberId) return true;
  return source.ownerMemberId === ownerMemberId;
}

function sourceMatchesNotebook(source: StoredSourceRecord, notebookId?: string): boolean {
  if (!notebookId) return true;
  return (source.notebookId || 'default-workspace') === notebookId;
}

function tokenizeReadyChunkQuery(query?: string): string[] {
  if (!query?.trim()) return [];
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}/g) || [];
  return Array.from(new Set(tokens)).slice(0, 12);
}

function chunkMatchesQuery(chunk: SourceChunk, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return true;
  const haystack = `${chunk.sourceTitle}\n${chunk.paperShortName}\n${chunk.text}`.toLowerCase();
  return queryTokens.some(token => haystack.includes(token));
}

export function resolvePostgresReadyChunkSearchMode(
  value = process.env[POSTGRES_READY_CHUNK_SEARCH_ENV],
): PostgresReadyChunkSearchMode {
  return value?.trim().toLowerCase() === 'fts' ? 'fts' : 'ilike';
}

function postgresChunkSearchVector(qualifier = ''): string {
  return `to_tsvector('simple', coalesce(${qualifier}source_title, '') || ' ' || coalesce(${qualifier}paper_short_name, '') || ' ' || coalesce(${qualifier}text, ''))`;
}

export function buildPostgresReadyChunkSearchSql(input: {
  query?: string;
  paramIndex: number;
  qualifier?: string;
  mode?: PostgresReadyChunkSearchMode;
  includeRank?: boolean;
}): PostgresReadyChunkSearchSql {
  const queryTokens = tokenizeReadyChunkQuery(input.query);
  const mode = input.mode || resolvePostgresReadyChunkSearchMode();
  if (queryTokens.length === 0) {
    return { mode, filter: '', params: [], selectRank: '', orderByPrefix: '', queryTokens };
  }

  if (mode === 'fts') {
    const vector = postgresChunkSearchVector(input.qualifier);
    const tsQuery = `plainto_tsquery('simple', $${input.paramIndex})`;
    return {
      mode,
      filter: `AND ${vector} @@ ${tsQuery}`,
      params: [queryTokens.join(' ')],
      selectRank: input.includeRank ? `, ts_rank(${vector}, ${tsQuery}) AS search_rank` : '',
      orderByPrefix: input.includeRank ? 'search_rank DESC, ' : '',
      queryTokens,
    };
  }

  const column = (name: string) => `${input.qualifier || ''}${name}`;
  return {
    mode,
    filter: `AND (
          ${column('text')} ILIKE ANY($${input.paramIndex}::text[])
          OR ${column('source_title')} ILIKE ANY($${input.paramIndex}::text[])
          OR ${column('paper_short_name')} ILIKE ANY($${input.paramIndex}::text[])
        )`,
    params: queryTokens.map(token => `%${token}%`),
    selectRank: '',
    orderByPrefix: '',
    queryTokens,
  };
}

export function buildReadySourceChunksResultFromSources(
  sources: StoredSourceRecord[],
  scope: ReadySourceChunksScope = {},
): ReadySourceChunksResult {
  const identities = new Set((scope.identities || []).filter(Boolean));
  const queryTokens = tokenizeReadyChunkQuery(scope.query);
  const candidateLimit = scope.topK && scope.topK > 0 ? Math.floor(scope.topK) : undefined;
  const readySources = sources.filter(source => (
    source.status === 'succeeded' &&
    source.chunks.length > 0 &&
    sourceMatchesOwner(source, scope.ownerMemberId) &&
    sourceMatchesNotebook(source, scope.notebookId) &&
    sourceMatchesIdentities(source, identities)
  )).map(source => ({
    ...source,
    chunks: source.chunks.filter(chunk => chunkMatchesQuery(chunk, queryTokens)),
  })).filter(source => source.chunks.length > 0);
  const chunks = readySources.flatMap(source => source.chunks).slice(0, candidateLimit);
  const returnedSourceIds = new Set(chunks.map(chunk => chunk.sourceId));
  const returnedSources = readySources.filter(source => returnedSourceIds.has(source.id));

  return {
    chunks,
    persistedSourceCount: returnedSources.length,
    vectorIndexedSourceCount: returnedSources.filter(source => source.vectorIndex.status === 'succeeded').length,
    sourceIds: returnedSources.map(source => source.id),
  };
}

export function buildSourceStoreFromPostgresRows(input: {
  sources: PostgresSourceRow[];
  chunks: PostgresChunkRow[];
  stages: PostgresStageRow[];
  updatedAt?: Date | string;
}): SourceStoreFile {
  const chunksBySource = new Map<string, SourceChunk[]>();
  for (const row of input.chunks) {
    const payload = parseJsonPayload<SourceChunk>(row.payload);
    const chunk: SourceChunk = {
      id: row.id || payload.id || `${row.source_id}::chunk-${row.chunk_index + 1}`,
      sourceId: row.source_id || payload.sourceId || '',
      sourceIndex: row.source_index ?? payload.sourceIndex ?? 0,
      chunkIndex: row.chunk_index ?? payload.chunkIndex ?? 0,
      paperShortName: row.paper_short_name || payload.paperShortName || 'Unknown',
      sourceTitle: row.source_title || payload.sourceTitle || '未命名资料',
      text: row.text || payload.text || '',
      tokenEstimate: row.token_estimate ?? payload.tokenEstimate ?? 0,
      page: row.page ?? payload.page,
    };
    chunksBySource.set(row.source_id, [...(chunksBySource.get(row.source_id) || []), chunk]);
  }

  const stagesBySource = new Map<string, IngestionStage[]>();
  for (const row of input.stages) {
    const payload = parseJsonPayload<IngestionStage>(row.payload);
    const stage: IngestionStage = {
      name: row.name || payload.name || 'store',
      status: row.status || payload.status || 'pending',
      startedAt: optionalIsoString(row.started_at) || payload.startedAt,
      completedAt: optionalIsoString(row.completed_at) || payload.completedAt,
      error: row.error || payload.error,
    };
    stagesBySource.set(row.source_id, [...(stagesBySource.get(row.source_id) || []), stage]);
  }

  const sources = input.sources.map(row => {
    const payload = parseJsonPayload<StoredSourceRecord>(row.payload);
    const sourceChunks = (chunksBySource.get(row.id) || payload.chunks || [])
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
    const sourceStages = (stagesBySource.get(row.id) || payload.stages || createStages())
      .sort((a, b) => stageOrder(a.name) - stageOrder(b.name));
    const vectorIndex: VectorIndexRecord = {
      status: row.vector_status || payload.vectorIndex?.status || 'not_configured',
      model: row.vector_model || payload.vectorIndex?.model,
      dimension: row.vector_dimension ?? payload.vectorIndex?.dimension,
      count: row.vector_count ?? payload.vectorIndex?.count,
      path: row.vector_path || payload.vectorIndex?.path,
      error: row.vector_error || payload.vectorIndex?.error,
      updatedAt: payload.vectorIndex?.updatedAt || isoString(row.updated_at),
    };
    const mineru = row.mineru_status || payload.mineru
      ? {
          status: row.mineru_status || payload.mineru?.status || 'not_configured',
          figureCount: row.mineru_figure_count ?? payload.mineru?.figureCount,
          error: row.mineru_error || payload.mineru?.error,
          updatedAt: payload.mineru?.updatedAt || isoString(row.updated_at),
        } satisfies MinerUExtractionRecord
      : undefined;

    return {
      id: row.id || payload.id || '',
      ownerMemberId: payload.ownerMemberId,
      notebookId: payload.notebookId,
      fileName: row.file_name || payload.fileName || 'unknown',
      fileType: row.file_type || payload.fileType || 'unknown',
      fileSize: optionalNumber(row.file_size) ?? payload.fileSize,
      title: row.title || payload.title || row.file_name || '未命名资料',
      shortName: row.short_name || payload.shortName || row.file_name || '未知资料',
      storageKey: row.storage_key || payload.storageKey,
      fileUrl: row.file_url || payload.fileUrl,
      status: row.status || payload.status || 'pending',
      createdAt: isoString(row.created_at, payload.createdAt || nowIso()),
      updatedAt: isoString(row.updated_at, payload.updatedAt || nowIso()),
      error: row.error || payload.error,
      stages: sourceStages,
      chunks: sourceChunks,
      chunkCount: row.chunk_count ?? payload.chunkCount ?? sourceChunks.length,
      tokenEstimate: row.token_estimate ?? payload.tokenEstimate ?? sourceChunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
      vectorIndex,
      mineru,
    } satisfies StoredSourceRecord;
  });

  sources.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    version: 1,
    updatedAt: isoString(input.updatedAt, sources.at(-1)?.updatedAt || nowIso()),
    sources,
  };
}

class PostgresSourceStoreAdapter implements SourceStoreAdapter {
  private poolPromise?: Promise<PgPoolLike>;

  private databaseUrl(): string | undefined {
    return process.env.DATABASE_URL?.trim();
  }

  private async pool(): Promise<PgPoolLike> {
    const connectionString = this.databaseUrl();
    if (!connectionString) {
      throw new Error('SOURCE_STORE_ADAPTER=postgres requires DATABASE_URL');
    }

    this.poolPromise ||= Promise.resolve().then(() => {
      const pgPackageName = ['p', 'g'].join('');
      const { Pool } = nodeRequire(pgPackageName) as { Pool: PgPoolConstructor };
      return new Pool({ connectionString });
    });
    return this.poolPromise;
  }

  private emptyStore(): SourceStoreFile {
    return { version: 1, updatedAt: nowIso(), sources: [] };
  }

  private coerceStore(value: unknown): SourceStoreFile {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as SourceStoreFile).version === 1 &&
      Array.isArray((parsed as SourceStoreFile).sources)
    ) {
      return parsed as SourceStoreFile;
    }
    return this.emptyStore();
  }

  private async ensureSchema(client: PgPoolLike | PgPoolClientLike): Promise<void> {
    for (const statement of buildPostgresSourceStoreSchemaSql()) {
      await client.query(statement);
    }
  }

  private async readNormalizedStore(client: PgPoolLike | PgPoolClientLike): Promise<SourceStoreFile | undefined> {
    const sources = await client.query<PostgresSourceRow>(`
      SELECT
        id, file_name, file_type, file_size, title, short_name, storage_key, file_url,
        status, error, chunk_count, token_estimate,
        vector_status, vector_model, vector_dimension, vector_count, vector_path, vector_error,
        mineru_status, mineru_figure_count, mineru_error,
        created_at, updated_at, payload
      FROM ${POSTGRES_SOURCES_TABLE}
      ORDER BY created_at ASC, id ASC
    `);
    if (sources.rows.length === 0) return undefined;

    const chunks = await client.query<PostgresChunkRow>(`
      SELECT
        id, source_id, source_index, chunk_index, page, paper_short_name,
        source_title, text, token_estimate, payload
      FROM ${POSTGRES_CHUNKS_TABLE}
      ORDER BY source_id ASC, chunk_index ASC
    `);
    const stages = await client.query<PostgresStageRow>(`
      SELECT source_id, name, status, started_at, completed_at, error, payload
      FROM ${POSTGRES_STAGES_TABLE}
      ORDER BY source_id ASC, name ASC
    `);

    return buildSourceStoreFromPostgresRows({
      sources: sources.rows,
      chunks: chunks.rows,
      stages: stages.rows,
      updatedAt: sources.rows.reduce<Date | string | undefined>((latest, row) => {
        if (!latest) return row.updated_at;
        return new Date(row.updated_at).getTime() > new Date(latest).getTime() ? row.updated_at : latest;
      }, undefined),
    });
  }

  async listReadyChunks(scope: ReadySourceChunksScope = {}): Promise<ReadySourceChunksResult> {
    const pool = await this.pool();
    await this.ensureSchema(pool);

    const identities = (scope.identities || []).filter(Boolean);
    const candidateLimit = scope.topK && scope.topK > 0 ? Math.floor(scope.topK) : undefined;
    const params: unknown[] = [];
    const identityFilter = identities.length > 0
      ? `AND (s.id = ANY($${params.length + 1}::text[]) OR s.file_name = ANY($${params.length + 1}::text[]) OR s.title = ANY($${params.length + 1}::text[]))`
      : '';
    if (identities.length > 0) params.push(identities);
    const ownerFilter = scope.ownerMemberId
      ? `AND s.payload->>'ownerMemberId' = $${params.length + 1}`
      : '';
    if (scope.ownerMemberId) params.push(scope.ownerMemberId);
    const notebookFilter = scope.notebookId
      ? `AND coalesce(s.payload->>'notebookId', 'default-workspace') = $${params.length + 1}`
      : '';
    if (scope.notebookId) params.push(scope.notebookId);
    const queryExistsSearch = buildPostgresReadyChunkSearchSql({
      query: scope.query,
      paramIndex: params.length + 1,
      qualifier: 'c.',
    });
    params.push(...queryExistsSearch.params);

    const sources = await pool.query<PostgresSourceRow>(`
      SELECT
        s.id, s.file_name, s.file_type, s.file_size, s.title, s.short_name, s.storage_key, s.file_url,
        s.status, s.error, s.chunk_count, s.token_estimate,
        s.vector_status, s.vector_model, s.vector_dimension, s.vector_count, s.vector_path, s.vector_error,
        s.mineru_status, s.mineru_figure_count, s.mineru_error,
        s.created_at, s.updated_at, s.payload
      FROM ${POSTGRES_SOURCES_TABLE} s
      WHERE s.status = 'succeeded'
        ${identityFilter}
        ${ownerFilter}
        ${notebookFilter}
        AND EXISTS (
          SELECT 1 FROM ${POSTGRES_CHUNKS_TABLE} c
          WHERE c.source_id = s.id
            ${queryExistsSearch.filter}
        )
      ORDER BY s.created_at ASC, s.id ASC
    `, params);

    if (sources.rows.length === 0) {
      return { chunks: [], persistedSourceCount: 0, vectorIndexedSourceCount: 0, sourceIds: [] };
    }

    const sourceIds = sources.rows.map(source => source.id);
    const chunkParams: unknown[] = [sourceIds];
    const chunkSearch = buildPostgresReadyChunkSearchSql({
      query: scope.query,
      paramIndex: chunkParams.length + 1,
      includeRank: true,
    });
    chunkParams.push(...chunkSearch.params);
    const limitClause = candidateLimit ? `LIMIT $${chunkParams.length + 1}` : '';
    if (candidateLimit) chunkParams.push(candidateLimit);
    const chunks = await pool.query<PostgresChunkRow>(`
      SELECT
        id, source_id, source_index, chunk_index, page, paper_short_name,
        source_title, text, token_estimate, payload
        ${chunkSearch.selectRank}
      FROM ${POSTGRES_CHUNKS_TABLE}
      WHERE source_id = ANY($1::text[])
        ${chunkSearch.filter}
      ORDER BY ${chunkSearch.orderByPrefix}source_id ASC, chunk_index ASC
      ${limitClause}
    `, chunkParams);

    const rebuilt = buildSourceStoreFromPostgresRows({
      sources: sources.rows,
      chunks: chunks.rows,
      stages: [],
      updatedAt: sources.rows.reduce<Date | string | undefined>((latest, row) => {
        if (!latest) return row.updated_at;
        return new Date(row.updated_at).getTime() > new Date(latest).getTime() ? row.updated_at : latest;
      }, undefined),
    });

    return buildReadySourceChunksResultFromSources(rebuilt.sources);
  }

  private async mirrorNormalizedTables(client: PgPoolClientLike, store: SourceStoreFile): Promise<void> {
    await client.query(`DELETE FROM ${POSTGRES_STAGES_TABLE}`);
    await client.query(`DELETE FROM ${POSTGRES_CHUNKS_TABLE}`);
    await client.query(`DELETE FROM ${POSTGRES_SOURCES_TABLE}`);

    for (const source of store.sources) {
      await client.query(
        `
          INSERT INTO ${POSTGRES_SOURCES_TABLE} (
            id, file_name, file_type, file_size, title, short_name, storage_key, file_url,
            status, error, chunk_count, token_estimate,
            vector_status, vector_model, vector_dimension, vector_count, vector_path, vector_error,
            mineru_status, mineru_figure_count, mineru_error,
            created_at, updated_at, payload
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18,
            $19, $20, $21,
            $22::timestamptz, $23::timestamptz, $24::jsonb
          )
        `,
        [
          source.id,
          source.fileName,
          source.fileType,
          source.fileSize ?? null,
          source.title,
          source.shortName,
          source.storageKey ?? null,
          source.fileUrl ?? null,
          source.status,
          source.error ?? null,
          source.chunkCount,
          source.tokenEstimate,
          source.vectorIndex.status,
          source.vectorIndex.model ?? null,
          source.vectorIndex.dimension ?? null,
          source.vectorIndex.count ?? null,
          source.vectorIndex.path ?? null,
          source.vectorIndex.error ?? null,
          source.mineru?.status ?? null,
          source.mineru?.figureCount ?? null,
          source.mineru?.error ?? null,
          source.createdAt,
          source.updatedAt,
          JSON.stringify(source),
        ],
      );

      for (const chunk of source.chunks) {
        await client.query(
          `
            INSERT INTO ${POSTGRES_CHUNKS_TABLE} (
              id, source_id, source_index, chunk_index, page, paper_short_name,
              source_title, text, token_estimate, payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
          `,
          [
            chunk.id,
            source.id,
            chunk.sourceIndex,
            chunk.chunkIndex,
            chunk.page ?? null,
            chunk.paperShortName,
            chunk.sourceTitle,
            chunk.text,
            chunk.tokenEstimate,
            JSON.stringify(chunk),
          ],
        );
      }

      for (const stage of source.stages) {
        await client.query(
          `
            INSERT INTO ${POSTGRES_STAGES_TABLE} (
              source_id, name, status, started_at, completed_at, error, payload
            )
            VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7::jsonb)
          `,
          [
            source.id,
            stage.name,
            stage.status,
            stage.startedAt ?? null,
            stage.completedAt ?? null,
            stage.error ?? null,
            JSON.stringify(stage),
          ],
        );
      }
    }
  }

  async read(): Promise<SourceStoreFile> {
    const pool = await this.pool();
    await this.ensureSchema(pool);
    const normalized = await this.readNormalizedStore(pool);
    if (normalized) return normalized;

    const result = await pool.query<PostgresPayloadRow>('SELECT payload FROM lingbi_source_store WHERE id = $1', [POSTGRES_STORE_ID]);
    if (!result.rows[0]?.payload) return this.emptyStore();
    return this.coerceStore(result.rows[0].payload);
  }

  async mutate(mutator: (store: SourceStoreFile) => SourceStoreFile | Promise<SourceStoreFile>): Promise<SourceStoreFile> {
    const pool = await this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureSchema(client);
      await client.query(
        'INSERT INTO lingbi_source_store (id, payload, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (id) DO NOTHING',
        [POSTGRES_STORE_ID, JSON.stringify(this.emptyStore())],
      );
      const currentResult = await client.query<PostgresPayloadRow>('SELECT payload FROM lingbi_source_store WHERE id = $1 FOR UPDATE', [POSTGRES_STORE_ID]);
      const current = await this.readNormalizedStore(client) || this.coerceStore(currentResult.rows[0]?.payload);
      const updated = await mutator(current);
      updated.updatedAt = nowIso();
      await client.query(
        'UPDATE lingbi_source_store SET payload = $2::jsonb, updated_at = now() WHERE id = $1',
        [POSTGRES_STORE_ID, JSON.stringify(updated)],
      );
      await this.mirrorNormalizedTables(client, updated);
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  status(): SourceStoreAdapterStatus {
    const databaseUrlConfigured = Boolean(this.databaseUrl());
    return {
      provider: 'postgres',
      configured: databaseUrlConfigured,
      databaseUrlConfigured,
      table: POSTGRES_PAYLOAD_TABLE,
      tables: [...POSTGRES_TABLES],
      normalizedSchema: true,
    };
  }
}

export function buildPostgresSourceStoreSchemaSql(): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${POSTGRES_PAYLOAD_TABLE} (
        id text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${POSTGRES_SOURCES_TABLE} (
        id text PRIMARY KEY,
        file_name text NOT NULL,
        file_type text NOT NULL,
        file_size bigint,
        title text NOT NULL,
        short_name text NOT NULL,
        storage_key text,
        file_url text,
        status text NOT NULL,
        error text,
        chunk_count integer NOT NULL DEFAULT 0,
        token_estimate integer NOT NULL DEFAULT 0,
        vector_status text NOT NULL,
        vector_model text,
        vector_dimension integer,
        vector_count integer,
        vector_path text,
        vector_error text,
        mineru_status text,
        mineru_figure_count integer,
        mineru_error text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${POSTGRES_CHUNKS_TABLE} (
        id text PRIMARY KEY,
        source_id text NOT NULL REFERENCES ${POSTGRES_SOURCES_TABLE}(id) ON DELETE CASCADE,
        source_index integer NOT NULL,
        chunk_index integer NOT NULL,
        page integer,
        paper_short_name text NOT NULL,
        source_title text NOT NULL,
        text text NOT NULL,
        token_estimate integer NOT NULL DEFAULT 0,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE (source_id, chunk_index)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${POSTGRES_STAGES_TABLE} (
        source_id text NOT NULL REFERENCES ${POSTGRES_SOURCES_TABLE}(id) ON DELETE CASCADE,
        name text NOT NULL,
        status text NOT NULL,
        started_at timestamptz,
        completed_at timestamptz,
        error text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (source_id, name)
      )
    `,
    `CREATE INDEX IF NOT EXISTS ${POSTGRES_SOURCES_TABLE}_status_idx ON ${POSTGRES_SOURCES_TABLE} (status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ${POSTGRES_CHUNKS_TABLE}_source_idx ON ${POSTGRES_CHUNKS_TABLE} (source_id, chunk_index)`,
    `CREATE INDEX IF NOT EXISTS ${POSTGRES_CHUNKS_TABLE}_fts_idx ON ${POSTGRES_CHUNKS_TABLE} USING GIN (
      to_tsvector('simple', coalesce(source_title, '') || ' ' || coalesce(paper_short_name, '') || ' ' || coalesce(text, ''))
    )`,
    `CREATE INDEX IF NOT EXISTS ${POSTGRES_STAGES_TABLE}_status_idx ON ${POSTGRES_STAGES_TABLE} (status)`,
  ];
}

const localJsonSourceStoreAdapter = new LocalJsonSourceStoreAdapter();
const postgresSourceStoreAdapter = new PostgresSourceStoreAdapter();

function getSourceStoreAdapter(): SourceStoreAdapter {
  return process.env.SOURCE_STORE_ADAPTER === 'postgres'
    ? postgresSourceStoreAdapter
    : localJsonSourceStoreAdapter;
}

async function saveSourceRecord(record: StoredSourceRecord): Promise<StoredSourceRecord> {
  await getSourceStoreAdapter().mutate(store => {
    const sources = store.sources.filter(source => source.id !== record.id);
    sources.push(record);
    sources.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ...store, sources };
  });
  return record;
}

function sourceInputForChunks(input: IngestionSourceInput): RagSourceInput {
  return {
    id: input.id,
    title: input.title || input.fileName,
    authors: input.authors,
    year: input.year,
    abstract: input.abstract,
    content: input.content,
    rawContent: input.rawContent,
    shortName: input.shortName,
    fileName: input.fileName,
    fileType: input.fileType,
  };
}

function createRecord(input: IngestionSourceInput): StoredSourceRecord {
  const timestamp = nowIso();
  return {
    id: input.id,
    ownerMemberId: input.ownerMemberId,
    notebookId: input.notebookId,
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.fileSize,
    title: input.title || input.fileName,
    shortName: input.shortName || input.fileName,
    storageKey: input.fileKey,
    fileUrl: input.fileUrl,
    status: 'pending',
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
    stages: createStages(),
    chunks: [],
    chunkCount: 0,
    tokenEstimate: 0,
    vectorIndex: {
      status: 'not_configured',
      updatedAt: timestamp,
    },
  };
}

export async function ingestExtractedSource(
  input: IngestionSourceInput,
  options: IngestExtractedSourceOptions = {},
): Promise<StoredSourceRecord> {
  const record = createRecord(input);
  record.status = 'running';
  record.stages = setStage(record.stages, 'store', 'succeeded');
  record.stages = setStage(record.stages, 'extract', 'succeeded');
  await saveSourceRecord(record);

  try {
    record.stages = setStage(record.stages, 'normalize', 'running');
    const chunks = buildSourceChunks([sourceInputForChunks(input)]);
    record.stages = setStage(record.stages, 'normalize', 'succeeded');
    record.stages = setStage(record.stages, 'chunk', 'succeeded');
    record.chunks = chunks;
    record.chunkCount = chunks.length;
    record.tokenEstimate = chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);

    if (chunks.length === 0) {
      record.status = 'failed';
      record.error = '文件内容为空，无法生成可检索片段。';
      record.stages = setStage(record.stages, 'chunk', 'failed', record.error);
      record.updatedAt = nowIso();
      return saveSourceRecord(record);
    }

    const canEmbed = Boolean(options.embedder) || hasRuntimeAIProvider(options.aiConfig);
    if (!canEmbed) {
      record.vectorIndex = {
        status: 'not_configured',
        updatedAt: nowIso(),
      };
      record.status = 'succeeded';
      record.updatedAt = nowIso();
      return saveSourceRecord(record);
    }

    try {
      record.stages = setStage(record.stages, 'embed', 'running');
      record.vectorIndex = {
        status: 'running',
        model: hasRuntimeAIProvider(options.aiConfig)
          ? options.aiConfig.embeddingModel || process.env.OPENAI_COMPAT_EMBEDDING_MODEL || 'text-embedding-3-small'
          : 'custom-test-embedder',
        updatedAt: nowIso(),
      };
      await saveSourceRecord(record);

      const embeddings = options.embedder
        ? await options.embedder(chunks.map(chunk => chunk.text))
        : await embedTexts(chunks.map(chunk => chunk.text), options.aiConfig);

      record.stages = setStage(record.stages, 'embed', 'succeeded');
      record.stages = setStage(record.stages, 'index', 'running');
      const indexed = await upsertSourceChunks(chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddings[index],
      })));
      record.stages = setStage(record.stages, 'index', 'succeeded');
      record.vectorIndex = {
        status: 'succeeded',
        model: record.vectorIndex.model,
        dimension: indexed.dimension,
        count: indexed.count,
        path: indexed.path,
        updatedAt: nowIso(),
      };
    } catch (indexError) {
      const error = safeErrorMessage(indexError, options.aiConfig?.apiKey);
      record.stages = setStage(record.stages, 'embed', record.stages.find(stage => stage.name === 'embed')?.status === 'succeeded' ? 'succeeded' : 'failed', error);
      record.stages = setStage(record.stages, 'index', 'failed', error);
      record.vectorIndex = {
        ...record.vectorIndex,
        status: 'failed',
        error,
        updatedAt: nowIso(),
      };
    }

    record.status = 'succeeded';
    record.updatedAt = nowIso();
    return saveSourceRecord(record);
  } catch (error) {
    const safeError = safeErrorMessage(error, options.aiConfig?.apiKey);
    record.status = 'error';
    record.error = safeError;
    record.updatedAt = nowIso();
    return saveSourceRecord(record);
  }
}

export async function listIngestionSources(scope: { ownerMemberId?: string; notebookId?: string } = {}): Promise<StoredSourceRecord[]> {
  const store = await getSourceStoreAdapter().read();
  return store.sources.filter(source => (
    sourceMatchesOwner(source, scope.ownerMemberId) &&
    sourceMatchesNotebook(source, scope.notebookId)
  ));
}

export async function listReadySourceChunks(scope: ReadySourceChunksScope = {}): Promise<ReadySourceChunksResult> {
  const adapter = getSourceStoreAdapter();
  if (adapter.listReadyChunks) return adapter.listReadyChunks(scope);
  const store = await adapter.read();
  return buildReadySourceChunksResultFromSources(store.sources, scope);
}

export async function getIngestionSource(id: string, scope: { ownerMemberId?: string; notebookId?: string } = {}): Promise<StoredSourceRecord | undefined> {
  const store = await getSourceStoreAdapter().read();
  return store.sources.find(source => (
    source.id === id &&
    sourceMatchesOwner(source, scope.ownerMemberId) &&
    sourceMatchesNotebook(source, scope.notebookId)
  ));
}

export async function updateSourceMinerUStatus(
  sourceId: string,
  status: MinerUExtractionStatus,
  details: { figureCount?: number; error?: unknown; apiKey?: string } = {},
): Promise<StoredSourceRecord | undefined> {
  let updatedSource: StoredSourceRecord | undefined;
  await getSourceStoreAdapter().mutate(store => {
    const sources = store.sources.map(source => {
      if (source.id !== sourceId) return source;
      const error = details.error ? safeErrorMessage(details.error, details.apiKey) : undefined;
      const updatedAt = nowIso();
      const nextSource: StoredSourceRecord = {
        ...source,
        updatedAt,
        mineru: {
          status,
          figureCount: details.figureCount ?? source.mineru?.figureCount,
          error,
          updatedAt,
        },
        stages: setStage(source.stages, 'mineru', mineruStatusToStageStatus(status), error),
      };
      updatedSource = nextSource;
      return nextSource;
    });
    return { ...store, sources };
  });
  return updatedSource;
}

export function sourceStoreStatus() {
  return {
    ...getSourceStoreAdapter().status(),
    readyChunkSearch: {
      mode: resolvePostgresReadyChunkSearchMode(),
      env: POSTGRES_READY_CHUNK_SEARCH_ENV,
    },
  };
}
