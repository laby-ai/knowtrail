import { chatPayload, type StoredChat, type WorkspaceReply } from "./research-workspace-contract";
import type { ChatMessage } from "@/types";
export function mergeCloudHistory(
  current: ChatMessage[], data: WorkspaceReply, baseline: Map<string, StoredChat>,
  sent?: Map<string, StoredChat>, force = false,
): StoredChat[] {
  const remote = new Map(data.messages.map((message) => [message.id, message]));
  if (!force) for (const message of current) {
    const local = chatPayload(message), previous = baseline.get(local.id);
    if (data.clearedAt && Date.parse(local.timestamp) <= Date.parse(data.clearedAt)) continue;
    const compared = sent?.get(local.id) || previous || remote.get(local.id);
    const dirty = compared && JSON.stringify(local) !== JSON.stringify(compared);
    if (!remote.has(local.id) || dirty) remote.set(local.id, local);
  }
  return [...remote.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
