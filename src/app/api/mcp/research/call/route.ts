import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { RESEARCH_MCP_IDS } from '@/lib/mcp/research-contracts';
import { authorizeResearchNotebook, executeResearchTool, ResearchMcpError } from '@/lib/mcp/research-client';
import { readResearchBody } from '@/lib/mcp/research-request';
const schema = z.object({ mcpId: z.enum(RESEARCH_MCP_IDS), notebookId: z.string().min(1).max(200), toolName: z.string().min(1).max(100), arguments: z.record(z.string(), z.unknown()).default({}) }).strict();
export async function POST(request: NextRequest) {
  try {
    const session = await resolveAccountSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: '请登录后使用科研 MCP。' }, { status: 401 });
    const text = new TextDecoder().decode(await readResearchBody(request, 100_000));
    let value: unknown;
    try { value = JSON.parse(text); } catch { return NextResponse.json({ error: '请求 JSON 格式无效。' }, { status: 400 }); }
    const parsed = schema.safeParse(value);
    if (!parsed.success) return NextResponse.json({ error: '科研工具参数无效。' }, { status: 400 });
    const input = parsed.data;
    const scope = await authorizeResearchNotebook(session, input.notebookId);
    const result = await executeResearchTool(input.mcpId, input.toolName, input.arguments, scope);
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof ResearchMcpError ? error.message : '科研服务调用失败，请重新登录或稍后重试。' }, { status: error instanceof ResearchMcpError ? error.status : 502 }); }
}
