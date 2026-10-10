import type { Paper } from "@/types";
export function SourceProvenance({ paper }: { paper: Paper }) {
  const metadata = paper.literature;
  const scope = metadata?.evidenceScope;
  const type = metadata?.publicationType || (metadata?.source === "arxiv" ? "Preprint" : "未取得");
  return <details className="mt-2 text-[11px] text-[var(--text-secondary)]" data-testid="source-provenance" onClick={(event) => event.stopPropagation()}>
    <summary className="cursor-pointer">来源与可信度</summary>
    <dl className="mt-2 space-y-1 break-words">
      <div><dt className="inline font-medium">信息来源：</dt><dd className="inline">{metadata?.provider || "用户上传"}</dd></div>
      <div><dt className="inline font-medium">证据范围：</dt><dd className="inline">{scope === "metadata" ? "仅题录，无正文证据" : scope === "abstract" ? "仅摘要，不能替代全文" : scope === "fulltext" || paper.ingestionStatus === "succeeded" ? "已解析文本，未声明所有图片和页面均可识别" : "解析状态待核验"}</dd></div>
      <div><dt className="inline font-medium">文献类型：</dt><dd className="inline">{type}</dd></div>
      <div><dt className="inline font-medium">期刊：</dt><dd className="inline">{metadata?.venue || paper.journal || "未取得"}</dd></div>
      <div><dt className="inline font-medium">DOI：</dt><dd className="inline">{metadata?.doi || paper.doi || "未取得"}</dd></div>
      <div><dt className="inline font-medium">作者机构：</dt><dd className="inline">{metadata?.affiliations?.join("；") || "来源未提供"}</dd></div>
      <div><dt className="inline font-medium">被引次数：</dt><dd className="inline">{metadata?.citedByCount !== undefined ? `${metadata.citedByCount}（${metadata.provider} 收录范围）` : "来源未提供"}</dd></div>
      <div><dt className="inline font-medium">影响因子：</dt><dd className="inline">未取得，暂无授权数据</dd></div>
      {metadata?.retrievedAt && <div><dt className="inline font-medium">获取时间：</dt><dd className="inline">{metadata.retrievedAt}</dd></div>}
    </dl>
    <p className="mt-2">数据库收录、被引次数和原文匹配均不等于科学结论可靠；未单独确认同行评审、撤稿及更正状态。</p>
  </details>;
}
