'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { KnowledgeMapData, KnowledgeMapEdgeConfidence, KnowledgeMapNodeType } from '@/lib/knowledge-map-types';

interface KnowledgeMapGraphProps {
  map: KnowledgeMapData;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  visibleTypes?: Set<KnowledgeMapNodeType>;
  visibleConfidences?: Set<KnowledgeMapEdgeConfidence>;
  searchTerm?: string;
}

type PositionedNode = KnowledgeMapData['nodes'][number] & {
  x: number;
  y: number;
  radius: number;
  labelVisible: boolean;
};

type PositionedEdge = KnowledgeMapData['edges'][number] & {
  path: string;
  labelX: number;
  labelY: number;
  labelVisible: boolean;
};

const TYPE_COLOR: Record<KnowledgeMapNodeType, { fill: string; border: string; glow: string }> = {
  concept: { fill: '#60a5fa', border: '#bfdbfe', glow: 'rgba(96,165,250,0.3)' },
  method: { fill: '#34d399', border: '#bbf7d0', glow: 'rgba(52,211,153,0.24)' },
  finding: { fill: '#f59e0b', border: '#fde68a', glow: 'rgba(245,158,11,0.24)' },
  question: { fill: '#a78bfa', border: '#ddd6fe', glow: 'rgba(167,139,250,0.25)' },
  source: { fill: '#94a3b8', border: '#e2e8f0', glow: 'rgba(148,163,184,0.22)' },
  term: { fill: '#22d3ee', border: '#cffafe', glow: 'rgba(34,211,238,0.25)' },
};

const CONFIDENCE_STYLE: Record<KnowledgeMapEdgeConfidence, { color: string; width: number; dash?: string }> = {
  EXTRACTED: { color: '#93c5fd', width: 2.4 },
  INFERRED: { color: '#a7f3d0', width: 1.8, dash: '7 7' },
  AMBIGUOUS: { color: '#fbbf24', width: 1.5, dash: '4 7' },
};

const CONFIDENCE_LABEL: Record<KnowledgeMapEdgeConfidence, string> = {
  EXTRACTED: '资料明示',
  INFERRED: '推断关系',
  AMBIGUOUS: '待复核',
};

const WIDTH = 1000;
const HEIGHT = 620;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const MIN_SCALE = 0.4;
const MAX_SCALE = 4;

function truncateLabel(label: string, max = 12) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function titleForNode(node: KnowledgeMapData['nodes'][number]) {
  const citations = node.citationNumbers.length ? `引用: ${node.citationNumbers.map(n => `[${n}]`).join(' ')}` : '引用: 待补充';
  return `${node.label}\n${node.summary}\n${citations}`;
}

function titleForEdge(edge: KnowledgeMapData['edges'][number]) {
  const citations = edge.citationNumbers.length ? `引用: ${edge.citationNumbers.map(n => `[${n}]`).join(' ')}` : '引用: 待补充';
  return `${edge.relation}\n${edge.evidence}\n${CONFIDENCE_LABEL[edge.confidence] || '推断关系'}\n${citations}`;
}

function edgePath(source: PositionedNode, target: PositionedNode) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const startX = source.x + (dx / distance) * (source.radius + 5);
  const startY = source.y + (dy / distance) * (source.radius + 5);
  const endX = target.x - (dx / distance) * (target.radius + 8);
  const endY = target.y - (dy / distance) * (target.radius + 8);
  const bend = Math.min(54, distance * 0.1);
  const normalX = (-dy / distance) * bend;
  const normalY = (dx / distance) * bend;
  const midX = (startX + endX) / 2 + normalX;
  const midY = (startY + endY) / 2 + normalY;

  return {
    path: `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`,
    labelX: midX,
    labelY: midY,
  };
}

function layoutGraph(map: KnowledgeMapData) {
  const focal = map.nodes.find(node => node.focal) || map.nodes[0];
  if (!focal) return { nodes: [] as PositionedNode[], edges: [] as PositionedEdge[] };

  const connectedToFocal = new Set<string>();
  map.edges.forEach(edge => {
    if (edge.source === focal.id) connectedToFocal.add(edge.target);
    if (edge.target === focal.id) connectedToFocal.add(edge.source);
  });

  const ringNodes = map.nodes
    .filter(node => node.id !== focal.id)
    .toSorted((a, b) => {
      const aDirect = connectedToFocal.has(a.id) ? 1 : 0;
      const bDirect = connectedToFocal.has(b.id) ? 1 : 0;
      return bDirect - aDirect || b.degree - a.degree || a.label.localeCompare(b.label);
    });

  const positioned = new Map<string, PositionedNode>();
  positioned.set(focal.id, {
    ...focal,
    x: CENTER_X,
    y: CENTER_Y,
    radius: 48,
    labelVisible: true,
  });

  ringNodes.forEach((node, index) => {
    const count = Math.max(1, ringNodes.length);
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    const direct = connectedToFocal.has(node.id);
    const radius = direct ? 210 : 270;
    const stagger = direct ? (index % 2) * 22 : (index % 2) * 30;
    const x = CENTER_X + Math.cos(angle) * (radius + stagger);
    const y = CENTER_Y + Math.sin(angle) * (radius + stagger * 0.6);
    positioned.set(node.id, {
      ...node,
      x,
      y,
      radius: Math.min(32, 19 + node.degree * 3),
      labelVisible: direct || node.degree >= 2 || index < 8,
    });
  });

  const nodes = Array.from(positioned.values());
  const edges = map.edges.flatMap(edge => {
    const source = positioned.get(edge.source);
    const target = positioned.get(edge.target);
    if (!source || !target) return [];
    const path = edgePath(source, target);
    return [{
      ...edge,
      ...path,
      labelVisible: edge.source === focal.id || edge.target === focal.id || edge.confidence === 'EXTRACTED',
    }];
  });

  return { nodes, edges };
}

export function KnowledgeMapGraph({
  map,
  selectedNodeId,
  onSelectNode,
  visibleTypes,
  visibleConfidences,
  searchTerm,
}: KnowledgeMapGraphProps) {
  const { nodes, edges } = useMemo(() => layoutGraph(map), [map]);
  const focalId = useMemo(() => nodes.find(node => node.focal)?.id || nodes[0]?.id || null, [nodes]);
  const selectedId = selectedNodeId || focalId;

  // ── Pan / zoom ──
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const resetView = useCallback(() => setTransform({ x: 0, y: 0, k: 1 }), []);

  // Reset the view whenever a different map is loaded.
  useEffect(() => { resetView(); }, [map, resetView]);

  const zoomBy = useCallback((factor: number, cx = WIDTH / 2, cy = HEIGHT / 2) => {
    setTransform(prev => {
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.k * factor));
      // keep the point under (cx,cy) stable
      const x = cx - ((cx - prev.x) / prev.k) * k;
      const y = cy - ((cy - prev.y) / prev.k) * k;
      return { x, y, k };
    });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const cy = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, cx, cy);
  }, [zoomBy]);

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    // ignore drags that start on a node (those select); only pan on empty canvas
    if ((e.target as Element).closest('[data-node]')) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y };
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
  }, [transform.x, transform.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const scaleY = HEIGHT / rect.height;
    setTransform(prev => ({
      ...prev,
      x: drag.originX + (e.clientX - drag.startX) * scaleX,
      y: drag.originY + (e.clientY - drag.startY) * scaleY,
    }));
  }, []);

  const endDrag = useCallback(() => { dragState.current = null; }, []);

  // ── Filters + search ──
  const typeOk = useCallback((t: KnowledgeMapNodeType) => !visibleTypes || visibleTypes.has(t), [visibleTypes]);
  const confidenceOk = useCallback(
    (c: KnowledgeMapEdgeConfidence) => !visibleConfidences || visibleConfidences.has(c),
    [visibleConfidences],
  );

  const searchLower = (searchTerm || '').trim().toLowerCase();
  const searchMatch = useCallback(
    (node: PositionedNode) => searchLower.length > 0 && (
      node.label.toLowerCase().includes(searchLower) || node.summary.toLowerCase().includes(searchLower)
    ),
    [searchLower],
  );

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    nodes.forEach(n => { if (typeOk(n.type)) ids.add(n.id); });
    return ids;
  }, [nodes, typeOk]);

  // Neighbors of the selected node (for focus highlight).
  const neighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    map.edges.forEach(edge => {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    });
    return ids;
  }, [map.edges, selectedId]);

  const hasSelection = Boolean(selectedNodeId);

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#07111f]" data-testid="knowledge-map-graph">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(14,165,233,0.2),transparent_26%),radial-gradient(circle_at_18%_78%,rgba(168,85,247,0.14),transparent_24%)]" />
      <svg
        ref={svgRef}
        className="relative h-full w-full touch-none"
        style={{ cursor: dragState.current ? 'grabbing' : 'grab' }}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="资料关系网络"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <filter id="knowledge-map-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="knowledge-map-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#cbd5e1" opacity="0.82" />
          </marker>
        </defs>

        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {edges.map(edge => {
            const style = CONFIDENCE_STYLE[edge.confidence] || CONFIDENCE_STYLE.INFERRED;
            if (!confidenceOk(edge.confidence)) return null;
            if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return null;
            const touchesSelection = hasSelection && (edge.source === selectedId || edge.target === selectedId);
            const dimmed = hasSelection && !touchesSelection;
            const baseOpacity = edge.confidence === 'AMBIGUOUS' ? 0.52 : 0.8;
            return (
              <g key={edge.id} data-testid="knowledge-map-edge" opacity={dimmed ? 0.12 : 1}>
                <path
                  d={edge.path}
                  fill="none"
                  stroke={style.color}
                  strokeWidth={touchesSelection ? style.width + 1.1 : style.width}
                  strokeLinecap="round"
                  strokeDasharray={style.dash}
                  markerEnd="url(#knowledge-map-arrow)"
                  opacity={baseOpacity}
                >
                  <title>{titleForEdge(edge)}</title>
                </path>
                {(edge.labelVisible || touchesSelection) && !dimmed && (
                  <text
                    x={edge.labelX}
                    y={edge.labelY}
                    textAnchor="middle"
                    className="pointer-events-none fill-slate-200 text-[13px] font-semibold"
                    paintOrder="stroke"
                    stroke="rgba(7,17,31,0.84)"
                    strokeWidth="5"
                  >
                    {truncateLabel(edge.relation, 7)}
                  </text>
                )}
              </g>
            );
          })}

          {nodes.map(node => {
            if (!typeOk(node.type)) return null;
            const color = TYPE_COLOR[node.type] || TYPE_COLOR.concept;
            const selected = node.id === selectedId;
            const isNeighbor = neighborIds.has(node.id);
            const dimmed = hasSelection && !selected && !isNeighbor;
            const matched = searchMatch(node);
            const labelVisible = node.labelVisible || selected || isNeighbor || matched;
            return (
              <g
                key={node.id}
                data-node
                role="button"
                tabIndex={0}
                aria-label={`查看${node.label}`}
                onClick={() => onSelectNode(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectNode(node.id);
                }}
                className="cursor-pointer outline-none"
                data-testid={node.focal ? 'knowledge-map-focal-node' : 'knowledge-map-node'}
                opacity={dimmed ? 0.22 : 1}
              >
                <title>{titleForNode(node)}</title>
                {matched && (
                  <circle cx={node.x} cy={node.y} r={node.radius + 22} fill="none" stroke="#facc15" strokeWidth={3} strokeDasharray="5 5" opacity={0.9} />
                )}
                <circle cx={node.x} cy={node.y} r={node.radius + 16} fill={color.glow} opacity={selected ? 0.95 : 0.58} filter="url(#knowledge-map-soft-glow)" />
                <circle cx={node.x} cy={node.y} r={node.radius} fill={color.fill} stroke={node.focal || selected ? '#ffffff' : color.border} strokeWidth={node.focal ? 4 : selected ? 3 : 1.6} />
                <circle cx={node.x - node.radius * 0.32} cy={node.y - node.radius * 0.34} r={Math.max(4, node.radius * 0.18)} fill="rgba(255,255,255,0.68)" />
                {labelVisible && (
                  <text
                    x={node.x}
                    y={node.y + node.radius + (node.focal ? 30 : 24)}
                    textAnchor="middle"
                    className="pointer-events-none fill-slate-100 text-[18px] font-semibold"
                    paintOrder="stroke"
                    stroke="rgba(7,17,31,0.82)"
                    strokeWidth="6"
                  >
                    {truncateLabel(node.label, node.focal ? 16 : 10)}
                  </text>
                )}
                {node.focal && (
                  <text
                    x={node.x}
                    y={node.y - node.radius - 20}
                    textAnchor="middle"
                    className="pointer-events-none fill-cyan-100 text-[14px] font-semibold"
                    paintOrder="stroke"
                    stroke="rgba(7,17,31,0.82)"
                    strokeWidth="5"
                  >
                    当前核心词
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="absolute right-4 top-4 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-slate-950/60 text-slate-200 backdrop-blur-xl transition hover:bg-slate-800/70"
          aria-label="放大"
          data-testid="knowledge-map-zoom-in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.25)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-slate-950/60 text-slate-200 backdrop-blur-xl transition hover:bg-slate-800/70"
          aria-label="缩小"
          data-testid="knowledge-map-zoom-out"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={resetView}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-slate-950/60 text-slate-200 backdrop-blur-xl transition hover:bg-slate-800/70"
          aria-label="重置视图"
          data-testid="knowledge-map-reset-view"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <div className="pointer-events-none absolute left-5 top-5 rounded-full border border-white/10 bg-slate-950/50 px-3 py-1.5 text-xs text-slate-200 backdrop-blur-xl">
        滚轮缩放 · 拖拽平移 · 点击节点看关系
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2">
        {Object.entries(CONFIDENCE_STYLE).map(([key, style]) => (
          <span key={key} className="rounded-full border border-white/10 bg-slate-950/55 px-2.5 py-1 text-[10px] text-slate-200 backdrop-blur-xl">
            <span className="mr-1 inline-block h-1.5 w-5 rounded-full align-middle" style={{ background: style.color, opacity: style.dash ? 0.55 : 0.9 }} />
            {CONFIDENCE_LABEL[key as KnowledgeMapEdgeConfidence] || '推断关系'}
          </span>
        ))}
      </div>
    </div>
  );
}
