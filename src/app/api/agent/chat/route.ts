import { NextRequest } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import { buildGroundedRetrievalContext, toRetrievalMetadata, type GroundedRetrievalContext } from '@/lib/grounded-retrieval';
import { auditCitationMarkers } from '@/lib/citation-audit';
import { SYSTEM_PROMPTS } from '@/lib/ai-service';
import { reserveAIUsage, accountUsageErrorMessage } from '@/lib/account-ai-billing';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { readNotebookDocument } from '@/lib/private-notebook-document';
import { isChatHistoryDocument } from '@/lib/chat-history-document';
import { researchAgentSystemPrompt, runResearchAgent } from '@/lib/research-agent-runtime';
import type { RagSourceInput } from '@/lib/rag';
import { isResearchChatSkillId } from '@/lib/research-chat-skills';
import { POST as generateDeepResearch } from '@/app/api/ai/deep-research/route';
import { isResearchReportDocument } from '@/lib/research-report-document';
import { readGeneratedReport } from '@/lib/research-agent-report';

export const runtime = 'nodejs';
export const maxDuration = 180;
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const activeTurns = new Map<string, symbol>();

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error: '请输入研究问题。' }, { status: 400, headers: privateHeaders });
  const { message, skill, papers, notebookId } = body as { message?: unknown; skill?: unknown; papers?: RagSourceInput[]; notebookId?: unknown };
  if (typeof message !== 'string' || !message.trim() || message.length > 100_000 || (skill !== undefined && !isResearchChatSkillId(skill))) {
    return Response.json({ error: '问题或 Skill 不完整，请检查后重试。' }, { status: 400, headers: privateHeaders });
  }
  const scope = await resolveAccountNotebookScope(request, { notebookId, loginMessage: '请先登录，再使用研究助手。', requireAuthenticatedPaperHost: true });
  if (!scope.ok) return scope.response;
  if (!scope.ownerMemberId || !scope.notebookId) return Response.json({ error: '请先登录并打开文献本。' }, { status: 401, headers: privateHeaders });
  const config = resolveServerRuntimeAIConfig();
  if (!process.env.KNOWTRAIL_AGENT_PYTHON || !config.apiKey || !config.model) return Response.json({ error: '研究助手暂不可用，请稍后重试。' }, { status: 503, headers: privateHeaders });
  const turnKey = `${scope.ownerMemberId}:${scope.notebookId}`;
  if (activeTurns.has(turnKey) || activeTurns.size >= 4) return Response.json({ error: '已有研究任务正在运行，请等待完成或停止后重试。' }, { status: 429, headers: privateHeaders });
  const turn = Symbol(); activeTurns.set(turnKey, turn);
  const releaseTurn = () => { if (activeTurns.get(turnKey) === turn) activeTurns.delete(turnKey); };
  let reservation: Awaited<ReturnType<typeof reserveAIUsage>> = null;
  try {
    const selected = Array.isArray(papers) ? papers : [];
    const grounded: GroundedRetrievalContext = selected.length
      ? await buildGroundedRetrievalContext(message, selected, config, { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId })
      : { chunks: [], citations: [], promptContext: '', retrievalMode: 'empty', persistedSourceCount: 0, vectorIndexedSourceCount: 0, degraded: false };
    const saved = await readNotebookDocument<unknown>({ ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId }, 'chat-history');
    if (saved && !isChatHistoryDocument(saved.data)) throw new Error('已保存对话暂时无法读取，请重试。');
    const history: { role: 'user' | 'assistant'; content: string }[] = [];
    if (saved && isChatHistoryDocument(saved.data)) {
      for (const msg of saved.data.messages.slice(-20)) {
        if (msg.role === 'system' || msg.generation?.status === 'pending') continue;
        const toolContext = msg.toolCalls?.filter(call => call.status === 'ready').map(call => ({ plugin: call.plugin, query: call.query, results: call.results, presentation: call.presentation, report: call.report }));
        const content = (msg.content + (toolContext?.length ? '\n工具实际结果：' + JSON.stringify(toolContext) : '')).slice(0, 16000);
        if (content.trim()) history.push({ role: msg.role, content });
      }
    }
    if (history.at(-1)?.role === 'user' && history.at(-1)?.content === message) history.pop();
    while (history.reduce((n, msg) => n + msg.content.length, 0) > 60_000) history.shift();
    const base = [SYSTEM_PROMPTS.academicQA, grounded.promptContext ? `以下为本人已选来源证据。只引用这里存在的编号，事实句附对应编号；不能把搜索候选冒充这些证据。\n${grounded.promptContext}` : '当前未选来源。可以搜索论文或回答一般问题；需要本人资料时请用户选择，不编造证据。'].join('\n\n');
    reservation = await reserveAIUsage({ route: 'chat', modelName: config.model, inputText: message, promptContext: grounded.promptContext, memberId: scope.ownerMemberId, quotaExempt: scope.usageQuotaExempt, idempotencyKey: request.headers.get('idempotency-key') || undefined });
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(180_000)]);
    const encoder = new TextEncoder();
    const billing = reservation;
    const stream = new ReadableStream({
      async start(controller) {
        let answer = '';
        const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        try {
          send({ citations: grounded.citations, retrieval: toRetrievalMetadata(grounded) });
          for await (const event of runResearchAgent({ message, skill: typeof skill === 'string' ? skill : undefined,
            sessionId: `${scope.ownerMemberId}:${scope.notebookId}`, sourceIds: [...new Set(grounded.citations.map(citation => citation.sourceId))], systemPrompt: researchAgentSystemPrompt(base, typeof skill === 'string' ? skill : undefined), history, config, signal,
            generateReport: async question => {
              const sourceIds = [...new Set(grounded.citations.map(citation => citation.sourceId))];
              const verified = { ownerMemberId: scope.ownerMemberId!, notebookId: scope.notebookId! };
              const previous = await readNotebookDocument<unknown>(verified, 'research-report');
              if (previous && !isResearchReportDocument(previous.data)) throw new Error('已保存报告暂时无法读取，请重试。');
              const runId = crypto.randomUUID();
              const headers = new Headers(request.headers);
              headers.delete('content-length');
              headers.set('Content-Type', 'application/json');
              const generated = await generateDeepResearch(new NextRequest(request.url.replace(/\/agent\/chat(?:\?.*)?$/, '/ai/deep-research'), {
                method: 'POST', headers, signal,
                body: JSON.stringify({ question, notebookId: scope.notebookId, papers: sourceIds.map(id => ({ id })), persistArtifact: true, runId, expectedRevision: previous?.revision || null }),
              }));
              const saved = await readGeneratedReport(generated, runId, signal);
              const report = saved.data.report!;
              return { reference: { sourceIds, question, revision: saved.revision, runId, status: report.status }, preview: report.answer.slice(0, 1800) };
            },
          })) {
            if (event.content) answer += event.content;
            send(event);
          }
          await billing?.settle(answer);
          send({ citationAudit: auditCitationMarkers(answer, grounded.citations) });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          await billing?.release().catch(() => undefined);
          if (!signal.aborted) { send({ error: error instanceof Error ? error.message : '请求未完成，请重试。' }); controller.close(); }
          else { try { controller.close(); } catch { /* Reader already closed. */ } }
        } finally { releaseTurn(); }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: { ...privateHeaders, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' } });
  } catch (error) {
    releaseTurn();
    await reservation?.release().catch(() => undefined);
    const status = error instanceof AccountServiceError ? error.status : 503;
    return Response.json({ error: accountUsageErrorMessage(error, '研究助手暂时无法读取资料，请重试。') }, { status, headers: privateHeaders });
  }
}
