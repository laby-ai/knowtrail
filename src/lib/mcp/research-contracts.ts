export const RESEARCH_MCP_IDS = ['labmate', 'pubcrawl', 'prisma', 'giiisp', 'papercheck'] as const;
export type ResearchMcpId = typeof RESEARCH_MCP_IDS[number];
export type McpParameter = { type?: string; description?: string; default?: string | number | boolean; enum?: (string | number)[] };
export type ResearchMcpTool = { name: string; description: string; inputSchema: { properties: Record<string, McpParameter>; required?: string[] } };
export type ResearchMcpConnection = { id: ResearchMcpId; name: string; description: string; available: boolean; verified: boolean; verifiedAt?: string; message?: string; tools: ResearchMcpTool[] };

export const MCP_TOOL_LABELS: Record<string, string> = {
  search_compound: '化合物检索', get_compound_properties: '化合物性质', calculate_molarity: '摩尔浓度计算', calculate_dilution: '稀释计算', calculate_yield: '产率计算', calculate_concentration: '浓度换算', calculate_isotope_pattern: '同位素分布', validate_cas_number: 'CAS 编号核验', convert_units: '单位换算', lookup_periodic_table: '元素性质', calculate_buffer_ph: '缓冲液 pH', lookup_named_reaction: '命名反应', lookup_buffer_recipe: '缓冲液配方', lookup_nmr_solvent: 'NMR 溶剂参考', lookup_amino_acid_properties: '氨基酸性质',
  search_pubmed: 'PubMed 检索', search_europepmc: 'Europe PMC 检索', get_abstract: '读取论文摘要', search_trials: '临床试验检索', get_trial: '临床试验详情', trending_papers: '近期文献', format_citation: '引用格式转换',
  configure_project: '配置系统综述', get_project_config: '读取综述配置', start_pipeline: '启动检索与初筛', get_pipeline_progress: '查看流程进度', get_screening_stats: '筛选统计', get_papers_to_screen: '待筛选文献', get_paper_details: '文献详情', screen_paper: '记录筛选决定', batch_screen_papers: '批量筛选决定', generate_report: '生成流程图与报告', read_report: '读取导出成果',
  search_papers: '集思谱论文检索', check_papercheck_env: '检查核验服务', extract_citation_evidence: '抽取论文引用证据', audit_citation_candidates: '检索与核对引用候选',
};

export const MCP_PARAMETER_LABELS: Record<string, string> = {
  query: '检索词', claim: '需要核验的正文主张', cited_title: '引用论文题名', arxiv_id: 'arXiv 编号', author: '作者', year: '年份', mode: '检索方式', page_size: '每页数量', page_num: '页码', max_results: '最多返回数量',
  project_name: '课题名称', date_start: '开始日期（YYYY-MM-DD）', date_end: '结束日期（YYYY-MM-DD）', include_keywords: '纳入关键词（逗号分隔）', exclude_keywords: '排除关键词（逗号分隔）', min_include_hits: '最少纳入词命中数',
  moles: '物质的量（mol）', volume_ml: '体积（mL）', volume_l: '体积（L）', concentration_M: '摩尔浓度（mol/L）', mass_grams: '质量（g）', mw: '摩尔质量（g/mol）', formula: '分子式', c1: '初始浓度', c2: '目标浓度', v1: '原液体积', v2: '最终体积',
  workspace_file: '已上传的论文文件', pmid: 'PubMed 编号', nct_id: '临床试验编号', condition: '疾病或研究条件', intervention: '干预措施', term: '关键词', topic: '研究主题', days: '最近天数', batch_size: '批次数量', filter_type: '筛选范围', paper_id: '文献编号', decision: '纳入或排除决定', reason: '决定依据', decisions: '批量决定（JSON）', file_name: '导出文件名称', style: '引用格式', sort: '排序方式', date_from: '开始日期', date_to: '结束日期', article_type: '文献类型', search_type: '化合物检索类型', preprints_only: '仅预印本', open_access_only: '仅开放获取', high_impact_only: '仅指定重点期刊', structured: '结构化摘要',
};
