'use client';

import { AlertTriangle, FileText, GitBranch, Link as LinkIcon } from 'lucide-react';
import { buildCitationTrail } from '@/lib/knowledge-map-views';
import type { KnowledgeMapData } from '@/lib/knowledge-map-types';
import type { Citation } from '@/types';

interface CitationTrailPanelProps {
  map: KnowledgeMapData;
  citations: Citation[];
}

function formatLocation(citation: Citation) {
  if (citation.page) return `第 ${citation.page} 页`;
  if (typeof citation.chunkIndex === 'number') return `片段 ${citation.chunkIndex + 1}`;
  return '资料片段';
}

export function CitationTrailPanel({ map, citations }: CitationTrailPanelProps) {
  const trail = buildCitationTrail(map, citations);
  const nodeById = new Map(map.nodes.map(node => [node.id, node]));
  const edgeById = new Map(map.edges.map(edge => [edge.id, edge]));
  const uncoveredNodes = trail.uncoveredNodeIds.map(id => nodeById.get(id)).filter(Boolean);
  const uncoveredEdges = trail.uncoveredEdgeIds.map(id => edgeById.get(id)).filter(Boolean);

  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto bg-[#f5f9ff] p-4 sm:p-5"
      data-testid="citation-trail-panel"
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[var(--glass-shadow-sm)] sm:px-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <LinkIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-950">引用脉络</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                按检索来源核对其支撑的概念与关系。没有引用编号的内容会单独列为待补证据，不混入已验证结论。
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-3 lg:grid-cols-2">
          {trail.items.map(item => (
            <article
              key={`${item.citation.sourceId}-${item.citation.chunkId}-${item.citationNumber}`}
              className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--glass-shadow-sm)]"
              data-testid="citation-trail-item"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 px-1.5 text-[11px] font-semibold text-white">
                    [{item.citationNumber}]
                  </span>
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-slate-900">
                      {item.citation.sourceTitle || item.citation.paperShortName || '未命名来源'}
                    </h4>
                    <p className="mt-0.5 text-[11px] text-slate-500">{formatLocation(item.citation)}</p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">
                  {item.nodes.length} 节点 · {item.edges.length} 关系
                </span>
              </div>

              <blockquote className="mt-3 border-l-2 border-blue-200 pl-3 text-xs leading-6 text-slate-600">
                {item.citation.excerpt || '当前来源未返回可展示的证据片段。'}
              </blockquote>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <FileText className="h-3.5 w-3.5 text-blue-600" />
                    支撑节点
                  </div>
                  {item.nodes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {item.nodes.map(node => (
                        <span key={node.id} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700">
                          {node.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">未关联到图谱节点。</p>
                  )}
                </div>

                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <GitBranch className="h-3.5 w-3.5 text-cyan-600" />
                    支撑关系
                  </div>
                  {item.edges.length > 0 ? (
                    <div className="space-y-1.5">
                      {item.edges.map(edge => (
                        <p key={edge.id} className="text-[11px] leading-relaxed text-slate-700">
                          {nodeById.get(edge.source)?.label || edge.source}
                          <span className="px-1 text-slate-400">·{edge.relation}·</span>
                          {nodeById.get(edge.target)?.label || edge.target}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">未关联到图谱关系。</p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        {(uncoveredNodes.length > 0 || uncoveredEdges.length > 0) && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="citation-trail-uncovered">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="min-w-0">
                <h4 className="text-xs font-semibold text-amber-900">待补证据</h4>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                  {uncoveredNodes.length} 个节点、{uncoveredEdges.length} 条关系尚未绑定有效引用编号，请补充来源或重新生成后复核。
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {uncoveredNodes.map(node => (
                    <span key={node?.id} className="rounded-full border border-amber-200 bg-white/70 px-2 py-1 text-[10px] text-amber-800">
                      {node?.label}
                    </span>
                  ))}
                  {uncoveredEdges.map(edge => (
                    <span key={edge?.id} className="rounded-full border border-amber-200 bg-white/70 px-2 py-1 text-[10px] text-amber-800">
                      {edge?.relation}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
