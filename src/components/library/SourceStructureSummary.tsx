import type { PaperSection } from '@/lib/paper-structure';

function truncate(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function SourceStructureSummary({
  authors,
  year,
  journal,
  doi,
  abstract,
  sections,
}: {
  authors?: string[];
  year?: number;
  journal?: string;
  doi?: string;
  abstract?: string;
  sections?: PaperSection[];
}) {
  return (
    <>
      <div
        data-testid="library-source-metadata"
        className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-blue-100">论文元数据</div>
          <div className="text-[10px] text-blue-100/65">{year || '年份待核验'}</div>
        </div>
        <dl className="mt-2 grid gap-1.5 text-[11px] leading-relaxed">
          <div className="grid grid-cols-[52px_1fr] gap-2">
            <dt className="text-[var(--text-tertiary)]">作者</dt>
            <dd className="text-[var(--text-secondary)]">
              {authors?.length ? authors.join('、') : '未解析'}
            </dd>
          </div>
          {journal && (
            <div className="grid grid-cols-[52px_1fr] gap-2">
              <dt className="text-[var(--text-tertiary)]">期刊</dt>
              <dd className="text-[var(--text-secondary)]">{journal}</dd>
            </div>
          )}
          {doi && (
            <div className="grid grid-cols-[52px_1fr] gap-2">
              <dt className="text-[var(--text-tertiary)]">DOI</dt>
              <dd className="break-all font-mono text-[var(--text-secondary)]">{doi}</dd>
            </div>
          )}
        </dl>
        {abstract && (
          <p className="mt-2 border-t border-blue-300/15 pt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {truncate(abstract, 320)}
          </p>
        )}
      </div>
      {sections && sections.length > 0 && (
        <div
          data-testid="library-source-sections"
          className="rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-violet-100">章节结构</div>
            <div className="text-[10px] text-violet-100/65">{sections.length} 个章节</div>
          </div>
          <div className="mt-2 space-y-1.5">
            {sections.slice(0, 12).map((section, index) => (
              <div
                key={`${section.title}-${index}`}
                data-testid="library-source-section"
                className="rounded-lg border border-violet-300/15 bg-black/10 px-2.5 py-2"
                style={{ marginLeft: `${Math.min(section.level - 1, 2) * 8}px` }}
              >
                <div className="text-[11px] font-semibold text-violet-100">{section.title}</div>
                {section.excerpt && (
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                    {truncate(section.excerpt, 160)}
                  </p>
                )}
              </div>
            ))}
          </div>
          {sections.length > 12 && (
            <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">
              当前显示前 12 个章节，共识别 {sections.length} 个。
            </p>
          )}
        </div>
      )}
    </>
  );
}
