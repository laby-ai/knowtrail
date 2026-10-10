import * as Y from "yjs";
import { createHash } from "node:crypto";
import type { ResearchDocument } from "./research-collaboration-store";
export function documentCrdt(
  document: Pick<ResearchDocument, "id" | "content" | "crdtState">,
): Y.Doc {
  const doc = new Y.Doc();
  if (document.crdtState)
    Y.applyUpdate(doc, Buffer.from(document.crdtState, "base64"));
  else {
    doc.clientID =
      parseInt(
        createHash("sha256").update(document.id).digest("hex").slice(0, 8),
        16,
      ) || 1;
    doc.getText("content").insert(0, document.content);
  }
  doc.getText("content");
  return doc;
}
export { replaceSharedText } from "./crdt-text";
export function serializedCrdt(doc: Y.Doc): string {
  const text = doc.getText("content");
  if (
    doc.share.size !== 1 ||
    text.length > 100000 ||
    text
      .toDelta()
      .some((item) => typeof item.insert !== "string" || !!item.attributes)
  )
    throw new Error("协作文档只能包含最多 100000 字符的纯文本。");
  const state = Y.encodeStateAsUpdate(doc);
  if (state.length > 1024 * 1024)
    throw new Error("协作历史达到 1 MB 上限，请另建文档继续编辑。");
  return Buffer.from(state).toString("base64");
}
