export function createKnowledgeMapProbeBody() {
  return {
    notebookId: 'live-knowledge-map-smoke',
    papers: [{
      id: 'live-map-source',
      title: '可复核证据关系方法',
      abstract: '显式记录研究问题、来源和限制，可以降低选择性报告风险并提高复核能力。',
      content: [
        '研究开始前应固定问题边界，并保存每条证据的来源、作者、日期和核验状态。',
        '纳入与排除理由需要显式记录，以减少只保留支持预期结论材料的选择偏差。',
        '关键主张应关联来源片段，同时单独标记反例、限制和仍待全文核验的事项。',
        '证据关系图只能表达当前材料中的直接共现或推断关系，不能替代统计检验和因果识别。',
      ].join(''),
    }],
  };
}

export function validateKnowledgeMapResponse(payload) {
  const nodes = payload?.map?.nodes;
  const edges = payload?.map?.edges;
  if (!Array.isArray(nodes) || nodes.length < 4) throw new Error('Knowledge map returned fewer than four nodes.');
  if (!Array.isArray(edges) || edges.length < 2) throw new Error('Knowledge map returned fewer than two edges.');
  if (!Array.isArray(payload.citations) || payload.citations.length === 0) throw new Error('Knowledge map returned no citations.');
  if (payload.citationAudit?.status !== 'pass') throw new Error(`Knowledge map citation audit failed: ${payload.citationAudit?.status || 'missing'}.`);
  const focalCount = nodes.filter(node => node.focal === true).length;
  if (focalCount !== 1) throw new Error(`Knowledge map must have exactly one focal node, got ${focalCount}.`);
  const nodeIds = new Set(nodes.map(node => node.id));
  const citedNodes = nodes.filter(node => Array.isArray(node.citationNumbers) && node.citationNumbers.length > 0 && node.sourceId);
  const citedEdges = edges.filter(edge =>
    nodeIds.has(edge.source)
    && nodeIds.has(edge.target)
    && Array.isArray(edge.citationNumbers)
    && edge.citationNumbers.length > 0
    && edge.relation
    && edge.relation !== '相关',
  );
  if (citedNodes.length !== nodes.length || citedEdges.length !== edges.length) {
    throw new Error('Knowledge map contains nodes or edges without citation-backed source relationships.');
  }
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    focalCount,
    citedNodeCount: citedNodes.length,
    citedEdgeCount: citedEdges.length,
    citationCount: payload.citations.length,
    citationAuditStatus: payload.citationAudit.status,
    cacheHit: payload.cache?.hit === true,
  };
}
