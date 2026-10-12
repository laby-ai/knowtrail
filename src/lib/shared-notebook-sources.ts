import { listResearchDocuments, sharedNotebookRoot, documentSharedSourceScopes, CollaborationError, type CollaborationActor } from "./research-collaboration-store";
import { listIngestionSources, listIngestionSourcesByScopes } from "./ingestion-store";

/** Re-resolve ACL and membership on every request, including original-file downloads. */
export async function sharedNotebookSources(actor: CollaborationActor, documentId: string) {
  const documents = await listResearchDocuments(actor);
  const document = documents.find(item => item.id === documentId);
  if (!document) throw new CollaborationError("共享文献本不存在或权限已撤销。", 404);
  const root = sharedNotebookRoot(document, documents) || document;
  const grants = documentSharedSourceScopes(root);
  const explicit = (await listIngestionSourcesByScopes(grants)).filter(source => grants.some(grant => grant.sourceId === source.id && grant.ownerMemberId === source.ownerMemberId && grant.notebookId === source.notebookId));
  const automatic = root.shareWholeNotebook ? await listIngestionSources({ ownerMemberId: root.ownerId, notebookId: root.notebookId }) : [];
  const sources = [...new Map([...automatic, ...explicit].filter(source => !(root.excludedSourceIds || []).includes(source.id)).map(source => [source.id, source])).values()];
  return { document, root, documents, sources };
}
