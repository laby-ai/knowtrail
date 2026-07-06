'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileSearch, GitBranch, Link as LinkIcon, Network, Search, ShieldCheck, Waypoints, X, Zap } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { KnowledgeMapGraph, type KnowledgeMapColorMode } from './KnowledgeMapGraph';
import type { KnowledgeMapEdgeConfidence, KnowledgeMapNodeType } from '@/lib/knowledge-map-types';

function formatCitationNumbers(numbers: number[]) {
  return numbers.length ? numbers.map(number => `[${number}]`).join(' ') : '待补充';
}

const NODE_TYPE_LABEL: Record<KnowledgeMapNodeType, string> = {
  concept: '概念',
  method: '方法',
  finding: '发现',
  question: '问题',
  source: '资料',
  term: '术语',
};

const NODE_TYPE_COLOR: Record<KnowledgeMapNodeType, string> = {
  concept: '#60a5fa',
  method: '#34d399',
  finding: '#f59e0b',
  question: '#a78bfa',
  source: '#94a3b8',
  term: '#22d3ee',
};

const EDGE_CONFIDENCE_LABEL: Record<KnowledgeMapEdgeConfidence, string> = {
  EXTRACTED: '资料明示',
  INFERRED: '推断关系',
  AMBIGUOUS: '待复核',
};

const ALL_NODE_TYPES: KnowledgeMapNodeType[] = ['concept', 'method', 'finding', 'question', 'source', 'term'];
const ALL_CONFIDENCES: KnowledgeMapEdgeConfidence[] = ['EXTRACTED', 'INFERRED', 'AMBIGUOUS'];

export function KnowledgeMapWorkspace() {
  const { knowledgeMapViewer, closeKnowledgeMap } = useApp();
  const initialNodeId = knowledgeMapViewer?.map.nodes.find(node => node.focal)?.id || knowledgeMapViewer?.map.nodes[0]?.id || null;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialNodeId);
  const [visibleTypes, setVisibleTypes] = useState<Set<KnowledgeMapNodeType>>(() => new Set(ALL_NODE_TYPES));
  const [visibleConfidences, setVisibleConfidences] = useState<Set<KnowledgeMapEdgeConfidence>>(() => new Set(ALL_CONFIDENCES));
  const [searchTerm, setSearchTerm] = useState('');
  const [colorMode, setColorMode] = useState<KnowledgeMapColorMode>('type');

  // Which node types actually appear, so we only show relevant filter chips.
  const presentTypes = useMemo(() => {
    const set = new Set<KnowledgeMapNodeType>();
    knowledgeMapViewer?.map.nodes.forEach(n => set.add(n.type));
    return ALL_NODE_TYPES.filter(t => set.has(t));
  }, [knowledgeMapViewer]);

  const toggleType = (t: KnowledgeMapNodeType) => setVisibleTypes(prev => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next.size === 0 ? new Set(ALL_NODE_TYPES) : next;
  });
  const toggleConfidence = (c: KnowledgeMapEdgeConfidence) => setVisibleConfidences(prev => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next.size === 0 ? new Set(ALL_CONFIDENCES) : next;
  });

  // Jump selection to the first search hit.
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q || !knowledgeMapViewer) return;
    const hit = knowledgeMapViewer.map.nodes.find(
      n => n.label.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q),
    );
    if (hit) setSelectedNodeId(hit.id);
  }, [searchTerm, knowledgeMapViewer]);

  const selectedNode = useMemo(() => {
    if (!knowledgeMapViewer) return null;
    return knowledgeMapViewer.map.nodes.find(node => node.id === selectedNodeId) || knowledgeMapViewer.map.nodes[0] || null;
  }, [knowledgeMapViewer, selectedNodeId]);

  const relatedEdges = useMemo(() => {
    if (!knowledgeMapViewer || !selectedNode) return [];
    return knowledgeMapViewer.map.edges.filter(edge => edge.source === selectedNode.id || edge.target === selectedNode.id);
  }, [knowledgeMapViewer, selectedNode]);

  if (!knowledgeMapViewer) return null;

  const { map, citations, retrieval, citationAudit } = knowledgeMapViewer;
  const sourceMeta = [
    knowledgeMapViewer.sourceCount ? `${knowledgeMapViewer.sourceCount} 个资料` : null,
    `${map.nodes.length} 个节点`,
    `${map.edges.length} 条关系`,
  ].filter(Boolean).join(' · ');

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden bg-[#f5f9ff]" data-testid="knowledge-map-workspace">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/82 px-5 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={closeKnowledgeMap}
            className="liquid-glass-btn rounded-full px-4 py-2 text-xs font-semibold"
            data-testid="knowledge-map-close-workspace"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            回到资料对话
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-950" data-testid="knowledge-map-title">
              {(map.title || '资料脉络').replace(/资料地图/g, '资料脉络')}
            </h2>
            <p className="text-[11px] text-slate-500">{sourceMeta}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="搜索节点"
              data-testid="knowledge-map-search"
              className="w-40 rounded-full border border-slate-200 bg-white/80 py-1.5 pl-8 pr-7 text-xs text-slate-700 outline-none transition focus:w-52 focus:border-blue-300"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label="清除搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 text-[11px] text-slate-600 md:flex">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            {citationAudit?.status === 'pass' ? '引用编号通过' : '引用需复核'}
          </div>
        </div>
      </header>

      {/* Filter toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/70 bg-white/60 px-5 py-2.5 backdrop-blur-xl" data-testid="knowledge-map-filters">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">类型</span>
        {presentTypes.map(t => {
          const active = visibleTypes.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                active ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-400 line-through'
              }`}
              data-testid={`knowledge-map-filter-type-${t}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: NODE_TYPE_COLOR[t], opacity: active ? 1 : 0.4 }} />
              {NODE_TYPE_LABEL[t]}
            </button>
          );
        })}
        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">关系</span>
        {ALL_CONFIDENCES.map(c => {
          const active = visibleConfidences.has(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleConfidence(c)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                active ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-400 line-through'
              }`}
              data-testid={`knowledge-map-filter-confidence-${c}`}
            >
              {EDGE_CONFIDENCE_LABEL[c]}
            </button>
          );
        })}

        {map.communities.length > 0 && (
          <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-0.5" data-testid="knowledge-map-color-mode">
            {([['type', '按类型'], ['community', '按社区']] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setColorMode(mode)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  colorMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
                data-testid={`knowledge-map-color-mode-${mode}`}
              >
                <Network className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 min-[1800px]:grid-cols-[minmax(0,1fr)_340px] min-[1800px]:overflow-hidden">
        <div className="min-h-[560px] min-[1800px]:min-h-0">
          <KnowledgeMapGraph
            map={map}
            selectedNodeId={selectedNode?.id || null}
            onSelectNode={setSelectedNodeId}
            visibleTypes={visibleTypes}
            visibleConfidences={visibleConfidences}
            searchTerm={searchTerm}
          />
        </div>

        <aside className="max-h-[360px] overflow-y-auto rounded-[1.35rem] border border-slate-200 bg-white/90 p-4 shadow-[var(--glass-shadow-sm)] backdrop-blur-xl min-[1800px]:max-h-none min-[1800px]:min-h-0" data-testid="knowledge-map-detail">
          {/* Graph-level insights derived by the extractor (hubs + bridges) */}
          {(map.analysis.hubNodes.length > 0 || map.analysis.bridgeEdges.length > 0) && (
            <section className="mb-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3" data-testid="knowledge-map-insights">
              {map.analysis.hubNodes.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    枢纽节点
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {map.analysis.hubNodes.slice(0, 6).map(hub => (
                      <button
                        key={hub.id}
                        type="button"
                        onClick={() => setSelectedNodeId(hub.id)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                          hub.id === selectedNode?.id
                            ? 'border-amber-300 bg-amber-100 text-amber-800'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-amber-200 hover:text-amber-700'
                        }`}
                        data-testid="knowledge-map-hub"
                        title={`${hub.degree} 条关系`}
                      >
                        {hub.label}
                        <span className="ml-1 text-[9px] text-slate-400">{hub.degree}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {map.analysis.bridgeEdges.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <Waypoints className="h-3.5 w-3.5 text-cyan-500" />
                    桥接关系
                  </div>
                  <div className="space-y-1.5">
                    {map.analysis.bridgeEdges.slice(0, 3).map((bridge, index) => {
                      const sourceNode = map.nodes.find(n => n.id === bridge.source);
                      const targetNode = map.nodes.find(n => n.id === bridge.target);
                      return (
                        <button
                          key={`${bridge.source}-${bridge.target}-${index}`}
                          type="button"
                          onClick={() => setSelectedNodeId(bridge.source)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-cyan-200"
                          data-testid="knowledge-map-bridge"
                        >
                          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-800">
                            <span className="truncate">{sourceNode?.label || bridge.source}</span>
                            <span className="text-slate-400">·{bridge.relation}·</span>
                            <span className="truncate">{targetNode?.label || bridge.target}</span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{bridge.why}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-slate-600">
            <GitBranch className="h-4 w-4 text-[var(--accent-blue)]" />
            <span>节点详情</span>
          </div>

          {selectedNode && (
            <section className="space-y-4">
              <div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-blue-300/30 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-600">
                    {selectedNode.focal ? '核心词' : NODE_TYPE_LABEL[selectedNode.type] || '概念'}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-500">
                    {selectedNode.degree} 条关系
                  </span>
                </div>
                <h3 className="text-xl font-semibold leading-snug text-slate-950" data-testid="knowledge-map-selected-node">
                  {selectedNode.label}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{selectedNode.summary}</p>
              </div>

              <div className="rounded-2xl border border-cyan-300/25 bg-cyan-500/10 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-700">
                  <LinkIcon className="h-3.5 w-3.5" />
                  引用状态
                </div>
                <p className="text-[11px] leading-relaxed text-slate-700">
                  节点引用 {formatCitationNumbers(selectedNode.citationNumbers)}，本图共使用 {citations.length} 个来源。
                </p>
                {selectedNode.sourceTitle && (
                  <p className="mt-1 text-[11px] text-slate-500">{selectedNode.sourceTitle}</p>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                  <GitBranch className="h-3.5 w-3.5" />
                  相邻关系
                </div>
                <div className="space-y-2">
                  {relatedEdges.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                      暂无相邻关系。
                    </div>
                  ) : relatedEdges.map(edge => {
                    const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
                    const otherNode = map.nodes.find(node => node.id === otherId);
                    return (
                      <button
                        key={edge.id}
                        type="button"
                        onClick={() => setSelectedNodeId(otherId)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-100"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-slate-900">{edge.relation}</span>
                          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[9px] text-slate-500">
                            {EDGE_CONFIDENCE_LABEL[edge.confidence] || '推断关系'}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-700">
                          {otherNode?.label || otherId}
                        </p>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{edge.evidence}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                  <FileSearch className="h-3.5 w-3.5" />
                  可继续追问
                </div>
                <div className="space-y-2">
                  {map.analysis.suggestedQuestions.slice(0, 4).map((question, index) => (
                    <div key={`${question}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
                      {question}
                    </div>
                  ))}
                </div>
              </div>

              {retrieval && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
                  已连接 {retrieval.persistedSourceCount} 个资料，{retrieval.vectorIndexedSourceCount} 个资料已建立快速检索。
                  {retrieval.degraded && retrieval.reason ? <span className="mt-1 block">部分资料暂未进入快速检索，已使用可用内容继续整理。</span> : null}
                </div>
              )}
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}
