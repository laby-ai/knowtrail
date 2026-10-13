import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { AccountAuthContext } from '@/lib/account-auth-client';
import { listNotebooks } from '@/lib/notebook-store';
import { RESEARCH_MCP_IDS, type ResearchMcpConnection, type ResearchMcpId, type ResearchMcpTool } from './research-contracts';

const SPECS = {
  labmate: { port: 9307, name: 'LabMate', description: '实验计算、化合物检索与实验参考', tools: ['search_compound', 'get_compound_properties', 'calculate_molarity', 'calculate_dilution', 'calculate_yield', 'calculate_concentration', 'calculate_isotope_pattern', 'validate_cas_number', 'convert_units', 'lookup_periodic_table', 'calculate_buffer_ph', 'lookup_named_reaction', 'lookup_buffer_recipe', 'lookup_nmr_solvent', 'lookup_amino_acid_properties'] },
  pubcrawl: { port: 9308, name: 'PubCrawl', description: '生物医学文献、摘要和临床试验', tools: ['search_pubmed', 'search_europepmc', 'get_abstract', 'search_trials', 'get_trial', 'trending_papers', 'format_citation'] },
  prisma: { port: 9309, name: 'PRISMA', description: '配置系统综述、筛选文献并导出流程图', tools: ['configure_project', 'get_project_config', 'start_pipeline', 'get_pipeline_progress', 'get_screening_stats', 'get_papers_to_screen', 'get_paper_details', 'screen_paper', 'batch_screen_papers', 'generate_report', 'read_report'] },
  giiisp: { port: 9301, name: '集思谱论文检索', description: '开放论文与 arXiv 题名、摘要、编号检索', tools: ['search_papers'] },
  papercheck: { port: 9310, name: '论文引用核验', description: '上传论文抽取引证，检索引用候选并核对出处', tools: ['check_papercheck_env', 'extract_citation_evidence', 'audit_citation_candidates'] },
} satisfies Record<ResearchMcpId, { port: number; name: string; description: string; tools: string[] }>;
const parameter = z.object({ type: z.string().optional(), description: z.string().optional(), default: z.union([z.string(), z.number(), z.boolean()]).optional(), enum: z.array(z.union([z.string(), z.number()])).optional() });
const toolSchema = z.object({ name: z.string(), description: z.string(), inputSchema: z.object({ properties: z.record(z.string(), parameter), required: z.array(z.string()).optional() }) });
const rpcSchema = z.object({ result: z.record(z.string(), z.unknown()).optional(), error: z.object({ message: z.string() }).optional() });
const toolCache = new Map<ResearchMcpId, { at: number; tools: ResearchMcpTool[] }>();
const pending = new Set<string>();

export class ResearchMcpError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

function secret(): string {
  const value = process.env.LINGBI_RESEARCH_MCP_SECRET?.trim();
  if (process.env.LINGBI_RESEARCH_MCP_ENABLED !== 'true' || !value || value.length < 32) throw new ResearchMcpError('科研 MCP 服务尚未配置。', 503);
  return value;
}

export function researchScope(tenant: string, member: string, notebook: string): string {
  return createHash('sha256').update(JSON.stringify([tenant, member, notebook])).digest('hex');
}

export async function authorizeResearchNotebook(session: AccountAuthContext, notebookId: string): Promise<string> {
  if (!(await listNotebooks(session.member.id)).some(book => book.id === notebookId)) throw new ResearchMcpError('无权在此文献本执行科研工具。', 403);
  return researchScope(session.tenant_id, session.member.id, notebookId);
}

async function rpc(id: ResearchMcpId, method: string, params: Record<string, unknown>, scope: string, timeout = 90_000): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${SPECS[id].port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sci-MCP-Key': secret(), 'X-Mse-Consumer': scope, 'MCP-Protocol-Version': '2025-03-26' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }), cache: 'no-store', signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error instanceof ResearchMcpError) throw error;
    throw new ResearchMcpError('科研服务连接失败或超时。请稍后查看进度，避免重复启动任务。');
  }
  if (!response.ok) throw new ResearchMcpError(response.status === 401 ? '科研服务鉴权失败，请联系管理员。' : '科研服务暂时不可用。');
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 12 * 1024 * 1024) throw new ResearchMcpError('返回内容过大，请减少数量后重试。');
  const data = rpcSchema.safeParse(JSON.parse(raw));
  if (!data.success || data.data.error || !data.data.result) throw new ResearchMcpError('科研服务返回了协议错误。');
  return data.data.result;
}

async function tools(id: ResearchMcpId): Promise<ResearchMcpTool[]> {
  const cached = toolCache.get(id);
  if (cached && Date.now() - cached.at < 60_000) return cached.tools;
  const result = await rpc(id, 'tools/list', {}, 'lingbi-catalog', 8_000);
  const list = z.array(toolSchema).parse(result.tools).filter(tool => (SPECS[id].tools as readonly string[]).includes(tool.name));
  toolCache.set(id, { at: Date.now(), tools: list });
  return list;
}

export async function researchCatalog(): Promise<ResearchMcpConnection[]> {
  let evidence: Record<string, { verified?: boolean; at?: string }> = {};
  try { const value: unknown = JSON.parse(await readFile(process.env.LINGBI_RESEARCH_MCP_EVIDENCE || '', 'utf8')); evidence = z.object({ products: z.record(z.string(), z.object({ verified: z.boolean(), at: z.string().optional() })) }).parse(value).products; } catch { /* No verification is claimed without evidence. */ }
  return Promise.all(RESEARCH_MCP_IDS.map(async id => {
    try {
      const availableTools = await tools(id);
      return { id, name: SPECS[id].name, description: SPECS[id].description, available: true, verified: evidence[id]?.verified === true, verifiedAt: evidence[id]?.at, tools: availableTools };
    } catch (error) {
      return { id, name: SPECS[id].name, description: SPECS[id].description, available: false, verified: false, tools: [], message: error instanceof ResearchMcpError ? error.message : '科研服务配置异常。' };
    }
  }));
}

function checkedArguments(tool: ResearchMcpTool, args: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(args)) {
    const property = tool.inputSchema.properties[key];
    if (!property) throw new ResearchMcpError('工具参数名称无效。', 400);
    const value = args[key];
    if (property.type === 'number' || property.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (property.type === 'integer' && !Number.isInteger(value))) throw new ResearchMcpError('数值参数格式无效。', 400);
    } else if (property.type === 'boolean') {
      if (typeof value !== 'boolean') throw new ResearchMcpError('选项参数格式无效。', 400);
    } else if (typeof value !== 'string' || value.length > 30_000) throw new ResearchMcpError('文本参数过长或格式无效。', 400);
    if (property.enum && !property.enum.includes(value as string | number)) throw new ResearchMcpError('参数选项无效。', 400);
    if (['max_results', 'page_size', 'batch_size'].includes(key) && (typeof value !== 'number' || value < 1 || value > 20)) throw new ResearchMcpError('每次数量必须为 1–20。', 400);
  }
  if (tool.inputSchema.required?.some(key => args[key] === undefined || args[key] === '')) throw new ResearchMcpError('请填写所有必填参数。', 400);
  return args;
}

function publicResult(result: Record<string, unknown>): unknown {
  const credential = secret();
  const safe = JSON.stringify(result).split(credential).join('<已脱敏>').replace(/sk-[a-zA-Z0-9]{16,}/g, '<已脱敏>');
  return JSON.parse(safe);
}

function bibliographicResult(result: Record<string, unknown>): Record<string, unknown> {
  const normalize = (value: unknown): unknown => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(value);
    if (!parsed.success) return value;
    const record = parsed.data;
    if (record.audit_status === '已核验') record.audit_status = '题录匹配';
    if (Array.isArray(record.candidates)) {
      const candidates = record.candidates.map(candidate => {
        const entry = z.record(z.string(), z.unknown()).safeParse(candidate);
        return entry.success && entry.data.audit_status === '已核验' ? { ...entry.data, audit_status: '题录匹配' } : candidate;
      });
      record.candidates = candidates;
      if (candidates.length === 0 && typeof record.failed_requests === 'number' && record.failed_requests > 0) record.audit_status = '接口受限，待核对';
    }
    return record;
  };
  const normalized = z.record(z.string(), z.unknown()).parse(publicResult(result));
  normalized.structuredContent = normalize(normalized.structuredContent);
  if (Array.isArray(normalized.content)) normalized.content = normalized.content.map(item => {
    const entry = z.record(z.string(), z.unknown()).safeParse(item);
    if (!entry.success || entry.data.type !== 'text' || typeof entry.data.text !== 'string') return item;
    try { return { ...entry.data, text: JSON.stringify(normalize(JSON.parse(entry.data.text))) }; } catch { return item; }
  });
  return { ...normalized, verificationScope: 'bibliographic-metadata', claimSupport: 'not-verified' };
}

export async function executeResearchTool(id: ResearchMcpId, toolName: string, args: Record<string, unknown>, scope: string): Promise<unknown> {
  if (process.env.LINGBI_COMMERCE_MODE === 'enforced' && (id === 'giiisp' || (id === 'papercheck' && toolName === 'audit_citation_candidates'))) throw new ResearchMcpError('此上游检索尚未完成科研点数定价验收，正式收费模式暂不开放。', 503);
  const tool = (await tools(id)).find(item => item.name === toolName);
  if (!tool) throw new ResearchMcpError('此科研工具尚未开放。', 400);
  const key = `${id}:${scope}`;
  if (pending.size >= 6) throw new ResearchMcpError('科研服务繁忙，请稍后再试。', 429);
  if (pending.has(key)) throw new ResearchMcpError('当前科研任务正在执行，请等待结果。', 409);
  pending.add(key);
  try {
    const result = await rpc(id, 'tools/call', { name: toolName, arguments: checkedArguments(tool, args) }, scope);
    if (id === 'papercheck' && toolName === 'extract_citation_evidence' && result.isError !== true) {
      result.evidence = await rpc(id, 'tools/call', { name: 'read_workspace_file', arguments: { path: 'citation_evidence.json' } }, scope);
    }
    if (id === 'papercheck' && toolName === 'audit_citation_candidates') {
      return bibliographicResult(result);
    }
    return publicResult(result);
  }
  finally { pending.delete(key); }
}

export async function uploadCitationFile(scope: string, file: File): Promise<{ path: string }> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !['pdf', 'docx', 'txt', 'md'].includes(extension) || file.size === 0 || file.size > 6 * 1024 * 1024) throw new ResearchMcpError('请上传不超过 6MB 的 PDF、DOCX 或文本文件。', 400);
  const key = `papercheck:${scope}`;
  if (pending.size >= 6) throw new ResearchMcpError('科研服务繁忙，请稍后再试。', 429);
  if (pending.has(key)) throw new ResearchMcpError('当前论文核验任务正在执行，请稍后上传。', 409);
  pending.add(key);
  try {
    const listed = await rpc('papercheck', 'tools/call', { name: 'list_workspace_files', arguments: {} }, scope);
    const state = z.object({ structuredContent: z.object({ files: z.array(z.object({ bytes: z.number() })) }) }).safeParse(listed);
    if (!state.success || listed.isError === true) throw new ResearchMcpError('无法核对上传空间，请稍后重试。');
    if (state.data.structuredContent.files.length >= 30 || state.data.structuredContent.files.reduce((sum, item) => sum + item.bytes, 0) + file.size > 50 * 1024 * 1024) throw new ResearchMcpError('当前文献本的核验工作区已达 50MB 或 30 个文件上限，请先清理。', 413);
    const filePath = `inputs/${randomUUID()}.${extension}`;
    const result = await rpc('papercheck', 'tools/call', { name: 'upload_workspace_file', arguments: { path: filePath, content_base64: Buffer.from(await file.arrayBuffer()).toString('base64') } }, scope);
    if (result.isError === true) throw new ResearchMcpError('论文上传失败，请稍后重试。');
    return { path: filePath };
  } finally { pending.delete(key); }
}
