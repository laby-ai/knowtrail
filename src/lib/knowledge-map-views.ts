import type { Citation } from '@/types';
import type {
  KnowledgeMapData,
  KnowledgeMapEdge,
  KnowledgeMapNode,
  KnowledgeMapNodeType,
} from '@/lib/knowledge-map-types';

export type KnowledgeMapViewMode = 'knowledge' | 'concept' | 'citation';

export interface CitationTrailItem {
  citationNumber: number;
  citation: Citation;
  nodes: KnowledgeMapNode[];
  edges: KnowledgeMapEdge[];
}

export interface CitationTrail {
  items: CitationTrailItem[];
  uncoveredNodeIds: string[];
  uncoveredEdgeIds: string[];
}

const CONCEPT_NODE_TYPES = new Set<KnowledgeMapNodeType>(['concept', 'method', 'finding', 'term']);

export function buildKnowledgeMapView(map: KnowledgeMapData, mode: Exclude<KnowledgeMapViewMode, 'citation'>): KnowledgeMapData {
  if (mode === 'knowledge') return map;

  const nodes = map.nodes.filter(node => CONCEPT_NODE_TYPES.has(node.type));
  const visibleNodeIds = new Set(nodes.map(node => node.id));
  const edges = map.edges.filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const degreeByNode = new Map<string, number>();
  for (const edge of edges) {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) || 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) || 0) + 1);
  }
  const viewNodes = nodes.map(node => ({ ...node, degree: degreeByNode.get(node.id) || 0 }));
  if (viewNodes.length > 0 && !viewNodes.some(node => node.focal)) {
    const fallbackFocal = [...viewNodes].sort((a, b) => b.degree - a.degree)[0];
    const index = viewNodes.findIndex(node => node.id === fallbackFocal.id);
    viewNodes[index] = { ...viewNodes[index], focal: true };
  }

  return {
    ...map,
    nodes: viewNodes,
    edges,
    communities: map.communities
      .map(community => ({
        ...community,
        nodeIds: community.nodeIds.filter(nodeId => visibleNodeIds.has(nodeId)),
      }))
      .filter(community => community.nodeIds.length > 0),
    analysis: {
      ...map.analysis,
      hubNodes: map.analysis.hubNodes
        .filter(node => visibleNodeIds.has(node.id))
        .map(node => ({ ...node, degree: degreeByNode.get(node.id) || 0 })),
      bridgeEdges: map.analysis.bridgeEdges.filter(edge =>
        visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
      ),
    },
  };
}

export function buildCitationTrail(map: KnowledgeMapData, citations: Citation[]): CitationTrail {
  const coveredNodeIds = new Set<string>();
  const coveredEdgeIds = new Set<string>();
  const items = citations.map((citation, index) => {
    const citationNumber = index + 1;
    const nodes = map.nodes.filter(node => node.citationNumbers.includes(citationNumber));
    const edges = map.edges.filter(edge => edge.citationNumbers.includes(citationNumber));
    nodes.forEach(node => coveredNodeIds.add(node.id));
    edges.forEach(edge => coveredEdgeIds.add(edge.id));
    return { citationNumber, citation, nodes, edges };
  });

  return {
    items,
    uncoveredNodeIds: map.nodes.filter(node => !coveredNodeIds.has(node.id)).map(node => node.id),
    uncoveredEdgeIds: map.edges.filter(edge => !coveredEdgeIds.has(edge.id)).map(edge => edge.id),
  };
}
