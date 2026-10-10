export function evidenceWindow(text: string, quote: string) {
  const chars: string[] = [];
  const positions: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < text.length; index++) {
    if (/\s/.test(text[index])) {
      if (!chars.length) continue;
      if (chars.at(-1) === " ") positions[positions.length - 1].end = index + 1;
      else { chars.push(" "); positions.push({ start: index, end: index + 1 }); }
    } else {
      chars.push(text[index]); positions.push({ start: index, end: index + 1 });
    }
  }
  if (chars.at(-1) === " ") { chars.pop(); positions.pop(); }
  const needle = quote.replace(/\s+/g, " ").trim();
  const at = needle.length >= 8 ? chars.join("").indexOf(needle) : -1;
  if (at < 0) return { matched: false, before: text.slice(0, 800), match: "", after: "" };
  const start = positions[at].start, end = positions[at + needle.length - 1].end;
  return {
    matched: true,
    before: (start > 80 ? "…" : "") + text.slice(Math.max(0, start - 80), start),
    match: text.slice(start, Math.min(end, start + 1200)) + (end - start > 1200 ? "…" : ""),
    after: text.slice(end, end + 80) + (end + 80 < text.length ? "…" : ""),
  };
}
