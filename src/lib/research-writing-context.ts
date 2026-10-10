import { z } from "zod";
import { readResearchWorkspace, type WorkspaceActor } from "./research-workspace-store";
import { listIngestionSources } from "./ingestion-store";
export async function researchWritingContext(actor: WorkspaceActor, requested: unknown) {
  const ids = [...new Set(z.array(z.string().uuid()).max(5).parse(requested || []))];
  if (!ids.length) return { records: [], text: "" };
  const workspace = await readResearchWorkspace(actor);
  const sources = await listIngestionSources({ ownerMemberId: actor.memberId, notebookId: actor.notebookId });
  const records = ids.map((id) => {
    const record = workspace.artifacts.find((item) => item.id === id);
    if (!record || record.sourceIds.some((sourceId) => !sources.some((source) => source.id === sourceId))) throw new Error("研究记录或关联原文已移除，或不属于当前文献本。");
    return record;
  });
  if (records.reduce((size, record) => size + record.content.length, 0) > 20000) throw new Error("所选研究记录过长，请精简记录或减少选择；原记录仍保留。");
  const text = records.map((record, index) => `[研究记录${index + 1}]\n记录 ID：${record.id}\n标题：${record.title}\n来源类型：${record.analysis ? "真实统计执行结果" : "用户研究记录，未作科学真实性认证"}\n${record.analysis ? `分析 ID：${record.analysis.id}\n原文件 SHA-256：${record.analysis.sourceFileSha256}\n` : ""}内容：\n${record.content}`).join("\n\n");
  return { records, text: `以下为当前账号当前文献本的研究记录。使用其中的事实时在句末标注 [研究记录1] 等对应编号，不得把记录编号伪装为文献引用。保留统计值、单位和限制，不从用户笔记猜造实验结果。\n${text}` };
}
