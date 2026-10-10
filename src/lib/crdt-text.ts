import type * as Y from "yjs";
export function replaceSharedText(doc: Y.Doc, next: string, origin?: unknown) {
  const text = doc.getText("content"),
    current = text.toString();
  let start = 0,
    end = 0;
  while (
    start < current.length &&
    start < next.length &&
    current[start] === next[start]
  )
    start++;
  while (
    end < current.length - start &&
    end < next.length - start &&
    current[current.length - end - 1] === next[next.length - end - 1]
  )
    end++;
  doc.transact(() => {
    text.delete(start, current.length - start - end);
    text.insert(start, next.slice(start, next.length - end));
  }, origin);
}
