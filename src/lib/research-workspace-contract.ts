import { z } from "zod";
export const RESEARCH_STAGES = ["literature", "design", "analysis", "writing", "journal"] as const;
export const STAGE_LABELS = { literature: "文献调研", design: "实验设计", analysis: "数据分析", writing: "论文写作", journal: "投稿选刊" };
const time = z.string().datetime({ offset: true });
const numbers = z.array(z.number().int().nonnegative()).max(100);
export const storedChatSchema = z.object({
  id: z.string().min(1).max(200), role: z.enum(["user", "assistant", "system"]), content: z.string().max(100000), timestamp: time,
  citations: z.array(z.object({
    paperId: z.string().max(200), paperShortName: z.string().max(1000), excerpt: z.string().max(10000), snippet: z.string().max(10000).optional(),
    position: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).optional(),
    sourceId: z.string().max(200).optional(), chunkId: z.string().max(200).optional(), sourceTitle: z.string().max(2000).optional(),
    score: z.number().finite().optional(), chunkIndex: z.number().int().nonnegative().optional(), page: z.number().int().nonnegative().optional(),
  })).max(100).optional(),
  retrieval: z.object({ mode: z.string().max(200), persistedSourceCount: z.number().int().nonnegative(), vectorIndexedSourceCount: z.number().int().nonnegative(), degraded: z.boolean().optional(), reason: z.string().max(5000).optional() }).optional(),
  citationAudit: z.object({ status: z.enum(["none", "pass", "missing-markers", "invalid-markers"]), citedNumbers: numbers, invalidNumbers: numbers, uncitedNumbers: numbers, citationCount: z.number().int().nonnegative(), markerCount: z.number().int().nonnegative(), warning: z.string().max(5000).optional() }).optional(),
  followUps: z.array(z.string().max(2000)).max(20).optional(),
  generation: z.object({ status: z.enum(["pending", "completed", "stopped", "timeout", "failed"]), question: z.string().max(100000), updatedAt: time }).optional(),
});
export type StoredChat = z.infer<typeof storedChatSchema>;
export const artifactInputSchema = z.object({
  stage: z.enum(RESEARCH_STAGES), title: z.string().trim().min(1).max(160), content: z.string().max(100000),
  sourceIds: z.array(z.string().min(1).max(200)).max(100).default([]), analysisId: z.string().uuid().optional(),
}).strict();
export type ArtifactInput = z.infer<typeof artifactInputSchema>;
export interface ResearchArtifact extends ArtifactInput {
  id: string; createdAt: string; authorId: string;
  analysis?: { id: string; sourceId: string; sourceFileSha256: string; method: string };
}
export interface ResearchWorkspace {
  revision: number; messages: StoredChat[]; artifacts: ResearchArtifact[]; clearedAt?: string;
}
export interface WorkspaceReply extends ResearchWorkspace { digests: Record<string, string> }
export function chatPayload(message: unknown): StoredChat { return storedChatSchema.parse(message); }
