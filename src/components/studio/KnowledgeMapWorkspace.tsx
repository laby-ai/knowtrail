'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, FileSearch, GitBranch, Link as LinkIcon, ShieldCheck } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { KnowledgeMapGraph } from './KnowledgeMapGraph';
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

const EDGE_CONFIDENCE_LABEL: Record<KnowledgeMapEdgeConfidence, string> = {
  EXTRACTED: '资料明示',
  INFERRED: '推断关系',
  AMBIGUOUS: '待复核',
};

export function KnowledgeMapWorkspace() {
  const { knowledgeMapViewer, closeKnowledgeMap } = useApp();
  const initialNodeId = knowledgeMapViewer?.map.nodes.find(node => node.focal)?.id || knowledgeMapViewer?.map.nodes[0]?.id || null;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialNodeId);

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
        <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 text-[11px] text-slate-600 md:flex">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          {citationAudit?.status === 'pass' ? '引用编号通过' : '引用需复核'}
        </div>
      </header>

      <section className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 min-[1800px]:grid-cols-[minmax(0,1fr)_340px] min-[1800px]:overflow-hidden">
        <div className="min-h-[560px] min-[1800px]:min-h-0">
          <KnowledgeMapGraph map={map} selectedNodeId={selectedNode?.id || null} onSelectNode={setSelectedNodeId} />
        </div>

        <aside className="max-h-[360px] overflow-y-auto rounded-[1.35rem] border border-slate-200 bg-white/90 p-4 shadow-[var(--glass-shadow-sm)] backdrop-blur-xl min-[1800px]:max-h-none min-[1800px]:min-h-0" data-testid="knowledge-map-detail">
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
