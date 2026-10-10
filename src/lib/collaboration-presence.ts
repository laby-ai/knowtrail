import {
  documentRole,
  type CollaborationActor,
  type ResearchDocument,
} from "./research-collaboration-store";
export interface CollaborationPresence {
  clientId: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  cursor: number;
  updatedAt: number;
}
const rooms = new Map<
  string,
  Map<string, { actor: CollaborationActor; peer: CollaborationPresence }>
>();
export function updatePresence(
  document: ResearchDocument,
  actor: CollaborationActor,
  clientId: string,
  cursor: number,
): CollaborationPresence[] {
  const now = Date.now();
  for (const [id, room] of rooms) {
    for (const [key, value] of room)
      if (now - value.peer.updatedAt > 30000) room.delete(key);
    if (!room.size) rooms.delete(id);
  }
  const role = documentRole(document, actor);
  if (!role) return [];
  if (!rooms.has(document.id)) {
    if (rooms.size >= 256) rooms.delete(rooms.keys().next().value!);
    rooms.set(document.id, new Map());
  }
  const room = rooms.get(document.id)!;
  const key = actor.id + ":" + clientId;
  if (room.has(key) || room.size < 100)
    room.set(key, {
      actor,
      peer: {
        clientId: key,
        name: actor.displayName || actor.email,
        role,
        cursor: Math.min(document.content.length, cursor),
        updatedAt: now,
      },
    });
  return [...room.values()].flatMap((value) => {
    const currentRole = documentRole(document, value.actor);
    return currentRole ? [{ ...value.peer, role: currentRole }] : [];
  });
}
