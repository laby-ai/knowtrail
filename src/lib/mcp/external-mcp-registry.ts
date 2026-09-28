export interface ExternalMcpConfig {
  id: string;
  name: string;
  description: string;
  source: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  tools: ExternalMcpTool[];
  providerMapping: string[];
  verified: boolean;
  verifiedAt?: string;
  notes?: string;
}

export interface ExternalMcpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TESTED_EXTERNAL_MCPS: ExternalMcpConfig[] = [
  {
    id: 'crossref-mcp',
    name: 'Crossref MCP',
    description: 'Crossref DOI注册元数据查询，包含期刊、书籍等，不同于全文库。学科范围：全学科（偏自然科学与工程、医学、社会科学等），注重元数据为标准平台，不是直接做科学实验。',
    source: 'https://github.com/pipeworx-io/mcp-crossref',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@pipeworx-io/mcp-crossref'],
    tools: [
      {
        name: 'search_works',
        description: 'DOI注册元数据查询，非常全面但无全文',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            rows: { type: 'integer', description: '结果数量', default: 10 },
          },
          required: ['query'],
        },
      },
    ],
    providerMapping: ['crossref'],
    verified: true,
    verifiedAt: '2026-09-07',
    notes: 'MIT许可，无限制及付费门槛，对学术用途友好',
  },
  {
    id: 'openalex-mcp',
    name: 'OpenAlex MCP',
    description: '研究成果元数据、学科分类、引用及摘要。学科范围：全学科（自然科学、社会科学、人文、医学等），适合跨学科分析。',
    source: 'https://github.com/rpaszekdev/openalex-mcp',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@rpaszekdev/openalex-mcp'],
    tools: [
      {
        name: 'get_work',
        description: '元数据、学科分类、引用及摘要',
        parameters: {
          type: 'object',
          properties: {
            work_id: { type: 'string', description: 'OpenAlex work ID (e.g., W2159974629)' },
          },
          required: ['work_id'],
        },
      },
    ],
    providerMapping: ['openalex'],
    verified: true,
    verifiedAt: '2026-09-08',
    notes: '基于MCP 1.30.0，MIT许可',
  },
  {
    id: 'artl-mcp',
    name: 'artl-mcp (Europe PMC)',
    description: '生命科学、医学、临床医学等，涵盖农业等。平台不是直接做科学实验。提供6个工具，全部通过测试。',
    source: 'https://pypi.org/project/artl-mcp/',
    transport: 'stdio',
    command: 'uvx',
    args: ['--from', 'artl-mcp', 'artl-mcp'],
    tools: [
      {
        name: 'search_europepmc_papers',
        description: '生命科学元数据，含平台全文及预印本',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            pageSize: { type: 'integer', description: '结果数量', default: 10 },
          },
          required: ['query'],
        },
      },
    ],
    providerMapping: ['europepmc'],
    verified: true,
    verifiedAt: '2026-09-08',
    notes: 'MIT许可，官方Europe PMC MCP',
  },
  {
    id: 'fro-wang-academic-tools-mcp',
    name: 'fro-wang-academic-tools-mcp',
    description: 'arXiv预印本及预印本元数据。平台涵盖计算机科学、物理学、数学、统计学、系统科学、经济学等。',
    source: 'https://pypi.org/project/fro-wang-academic-tools-mcp/',
    transport: 'stdio',
    command: 'uvx',
    args: ['--from', 'fro-wang-academic-tools-mcp', 'fro-wang-academic-tools-mcp'],
    tools: [
      {
        name: 'search_papers',
        description: '预印本及预印本元数据',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词或ID (e.g., id:1706.03762)' },
            max_results: { type: 'integer', description: '结果数量', default: 10 },
          },
          required: ['query'],
        },
      },
    ],
    providerMapping: ['arxiv'],
    verified: true,
    verifiedAt: '2026-09-08',
    notes: 'v0.1.4, MCP 1.30.0，MIT许可',
  },
  {
    id: 'paper-toolkit-mcp',
    name: 'paper-toolkit-mcp',
    description: 'Crossref DOI元数据查询，功能较基础但研究平台不是直接做科学实验。',
    source: 'https://pypi.org/project/paper-toolkit-mcp/',
    transport: 'stdio',
    command: 'uvx',
    args: ['--from', 'paper-toolkit-mcp', 'paper-toolkit-mcp'],
    tools: [
      {
        name: 'get_crossref_paper_by_doi',
        description: 'DOI元数据查询',
        parameters: {
          type: 'object',
          properties: {
            doi: { type: 'string', description: 'DOI (e.g., 10.1038/nature12373)' },
          },
          required: ['doi'],
        },
      },
    ],
    providerMapping: ['crossref'],
    verified: true,
    verifiedAt: '2026-09-08',
    notes: 'v0.2.0, MCP 1.30.0，MIT许可',
  },
  {
    id: 'snowcite',
    name: 'snowcite',
    description: 'Crossref模糊搜索，可关闭自动保存，无用户易错问题。',
    source: 'https://github.com/cop1cat/snowcite',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'snowcite'],
    tools: [
      {
        name: 'search_papers',
        description: '模糊搜索模式，关键词对应元数据',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            sources: {
              type: 'array',
              items: { type: 'string' },
              description: '数据源 (e.g., ["crossref"])',
            },
            limit: { type: 'integer', description: '结果数量', default: 10 },
          },
          required: ['query'],
        },
      },
    ],
    providerMapping: ['crossref'],
    verified: true,
    verifiedAt: '2026-09-08',
    notes: 'v0.3.0, MCP 1.30.0，MIT许可',
  },
  {
    id: 'scite-mcp',
    name: 'Scite Scientific Literature MCP',
    description: '平台级检索元数据，并提供引用分析等。学科范围：全学科，适合科学和全文覆盖平台。',
    source: 'https://scite.ai/mcp',
    transport: 'sse',
    url: 'https://api.scite.ai/mcp',
    tools: [
      {
        name: 'search_literature',
        description: '平台级检索元数据，含引用分析',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            limit: { type: 'integer', description: '结果数量', default: 10 },
          },
          required: ['query'],
        },
      },
    ],
    providerMapping: ['scite'],
    verified: true,
    verifiedAt: '2026-09-08',
    notes: '需要API Key，官方MCP端点',
  },
  {
    id: 'scopus-mcp-server',
    name: 'Scopus MCP Server',
    description: 'Scopus API 的 MCP 服务器 — 搜索摘要、作者和导出引文。Scopus 是 Elsevier 的大型摘要和引用数据库，覆盖 27,000+ 期刊。',
    source: 'https://pypi.org/project/scopus-mcp-server',
    transport: 'http',
    command: 'uvx',
    args: ['--from', 'scopus-mcp-server', 'scopus-mcp-server'],
    tools: [
      {
        name: 'scopus_search',
        description: '在Scopus中搜索学术文章',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            search_type: { type: 'string', description: '搜索类型' },
            year_from: { type: 'string', description: '起始年份' },
            year_to: { type: 'string', description: '结束年份' },
            count: { type: 'integer', description: '结果数量', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'scopus_abstract',
        description: '获取Scopus记录的完整摘要和元数据',
        parameters: {
          type: 'object',
          properties: {
            scopus_id: { type: 'string', description: 'Scopus ID' },
          },
          required: ['scopus_id'],
        },
      },
      {
        name: 'scopus_author',
        description: '查询作者档案，返回h指数、文献数、引用数和学科领域',
        parameters: {
          type: 'object',
          properties: {
            author_name: { type: 'string', description: '作者姓名' },
            affiliation: { type: 'string', description: '机构' },
          },
          required: ['author_name'],
        },
      },
      {
        name: 'scopus_export_bibtex',
        description: '将最近的搜索结果导出为BibTeX格式',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ],
    providerMapping: ['scopus'],
    verified: true,
    verifiedAt: '2026-09-15',
    notes: '需要Elsevier Scopus API Key，MIT许可，HTTP传输',
  },
  {
    id: 'dblp-mcp',
    name: 'DBLP MCP Server',
    description: '用于检索DBLP文献数据库的MCP服务器。DBLP 是计算机科学领域的权威书目数据库，覆盖期刊、会议、专著等。',
    source: 'https://github.com/flbrandh/dblp-mcp',
    transport: 'stdio',
    command: 'pip',
    args: ['install', '-e', '.'],
    tools: [
      {
        name: 'search_publications',
        description: '对DBLP数据库执行全文和结构化搜索',
        parameters: {
          type: 'object',
          properties: {
            term_groups: { type: 'array', items: { type: 'string' }, description: '搜索词组' },
            limit: { type: 'integer', description: '结果数量', default: 10 },
            year_from: { type: 'string', description: '起始年份' },
            year_to: { type: 'string', description: '结束年份' },
            venue: { type: 'string', description: '期刊/会议名称' },
          },
          required: ['term_groups'],
        },
      },
      {
        name: 'get_publication',
        description: '返回一条已导入的出版物，含缓存的增强数据',
        parameters: {
          type: 'object',
          properties: {
            dblp_key: { type: 'string', description: 'DBLP key' },
            include_fulltext: { type: 'boolean', description: '是否包含全文', default: false },
          },
          required: ['dblp_key'],
        },
      },
      {
        name: 'fetch_publication_abstract',
        description: '获取并缓存已导入出版物的摘要',
        parameters: {
          type: 'object',
          properties: {
            dblp_key: { type: 'string', description: 'DBLP key' },
          },
          required: ['dblp_key'],
        },
      },
    ],
    providerMapping: ['dblp'],
    verified: true,
    verifiedAt: '2026-09-15',
    notes: 'MIT许可，需要本地数据库导入，stdio/sse/http传输',
  },
  {
    id: 'ai4scholar-mcp',
    name: 'AI4Scholar MCP',
    description: '论文、引文、学术图谱与研究证据检索。覆盖 arXiv、PubMed、bioRxiv、medRxiv、Google Scholar 等多个数据源。',
    source: 'https://pypi.org/project/ai4scholar-mcp',
    transport: 'stdio',
    command: 'uvx',
    args: ['--from', 'ai4scholar-mcp', 'ai4scholar-mcp'],
    tools: [
      {
        name: 'search_arxiv',
        description: '在 arXiv 上搜索学术论文',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            max_results: { type: 'integer', description: '最大结果数', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_biorxiv',
        description: '在 bioRxiv 上搜索生物学预印本论文',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            max_results: { type: 'integer', description: '最大结果数', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_medrxiv',
        description: '在 medRxiv 上搜索医学与健康预印本论文',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            max_results: { type: 'integer', description: '最大结果数', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_google_scholar',
        description: '通过 AI4Scholar 代理在 Google Scholar 上搜索学术论文，支持年份过滤',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            max_results: { type: 'integer', description: '最大结果数', default: 10 },
            year_from: { type: 'string', description: '起始年份' },
            year_to: { type: 'string', description: '结束年份' },
          },
          required: ['query'],
        },
      },
    ],
    providerMapping: ['biorxiv', 'medrxiv', 'google-scholar'],
    verified: true,
    verifiedAt: '2026-09-15',
    notes: 'MIT许可，28个工具，覆盖多个预印本和学术搜索引擎',
  },
];

export function getExternalMcpById(id: string): ExternalMcpConfig | undefined {
  return TESTED_EXTERNAL_MCPS.find(mcp => mcp.id === id);
}

export function getExternalMcpsByProvider(providerId: string): ExternalMcpConfig[] {
  return TESTED_EXTERNAL_MCPS.filter(mcp => mcp.providerMapping.includes(providerId));
}

export function getAllExternalMcps(): ExternalMcpConfig[] {
  return TESTED_EXTERNAL_MCPS;
}
