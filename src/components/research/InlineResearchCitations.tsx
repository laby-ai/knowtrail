"use client";

import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { useApp } from "@/contexts/AppContext";
import type { Citation } from "@/types";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

export function InlineResearchCitations({ children, citations }: { children: ReactNode; citations: Citation[] }) {
  const { folders, revealPaper } = useApp();
  function render(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (typeof node === "string") {
        return node.split(/(\[\d+\])/g).map((part, index) => {
          const number = /^\[(\d+)\]$/.exec(part);
          const citation = number ? citations[Number(number[1]) - 1] : undefined;
          if (!citation) return part;
          const paper = folders.flatMap((folder) => folder.papers).find((item) => item.id === citation.paperId);
          return <HoverCard key={index} openDelay={150}>
            <HoverCardTrigger asChild>
              <button type="button" className="mx-0.5 align-super text-[0.75em] font-semibold text-[var(--accent-blue)]" aria-label={`定位引用 ${number![1]}`} data-testid="chat-inline-citation" onClick={() => revealPaper(citation.paperId, citation)}>{number![1]}</button>
            </HoverCardTrigger>
            <HoverCardContent className="z-[120] max-w-[90vw] bg-[var(--bg-primary)] text-xs">
              <p className="font-semibold">{paper?.title || citation.sourceTitle || citation.paperShortName || "引用来源"}</p>
              <p className="mt-1 text-[var(--text-secondary)]">{paper?.literature?.venue || paper?.journal || "期刊未提供"} · {paper?.literature?.year || paper?.year || "年份未提供"}</p>
              <p className="mt-1">{citation.page !== undefined ? `第 ${citation.page} 页` : "页码未提供"}{citation.chunkIndex !== undefined ? ` · 片段 ${citation.chunkIndex + 1}` : ""}</p>
              {citation.excerpt && <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{citation.excerpt}</p>}
              <p className="mt-2 text-[var(--text-secondary)]">点击编号定位原文；原文匹配不等于主张已获得支持。</p>
            </HoverCardContent>
          </HoverCard>;
        });
      }
      if (!isValidElement<{ children?: ReactNode; className?: string }>(node)) return node;
      if ((typeof node.type === "string" && ["code", "pre", "a", "sup"].includes(node.type)) || node.props.className?.includes("katex")) return node;
      return node.props.children === undefined ? node : cloneElement(node, { children: render(node.props.children) });
    });
  }
  return <>{render(children)}</>;
}
