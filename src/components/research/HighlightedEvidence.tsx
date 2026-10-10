import { evidenceWindow } from "@/lib/evidence-highlight";
export function HighlightedEvidence({ text, quote }: { text: string; quote: string }) {
  const window = evidenceWindow(text, quote);
  return <span className="whitespace-pre-wrap" data-testid="highlighted-original-evidence">
    {window.before}
    {window.matched && <mark className="rounded bg-amber-200 px-0.5 text-slate-900">{window.match}</mark>}
    {window.after}
    {!window.matched && <span className="mt-1 block text-[var(--text-tertiary)]">此原文片段中未匹配到引文，请核对出处。</span>}
  </span>;
}
