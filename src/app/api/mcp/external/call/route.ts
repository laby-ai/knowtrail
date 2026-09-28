import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getExternalMcpById } from '@/lib/mcp/external-mcp-registry';
import { callExternalMcpTool } from '@/lib/mcp/external-mcp-client';

const callSchema = z.object({
  mcpId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = callSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  const { mcpId, toolName, arguments: args } = parsed.data;
  const mcp = getExternalMcpById(mcpId);
  if (!mcp) {
    return NextResponse.json({ error: `MCP '${mcpId}' not found` }, { status: 404 });
  }

  const toolExists = mcp.tools.some(t => t.name === toolName);
  if (!toolExists) {
    return NextResponse.json({ error: `Tool '${toolName}' not found in MCP '${mcpId}'` }, { status: 404 });
  }

  try {
    const result = await callExternalMcpTool(mcp, toolName, args);
    return NextResponse.json({
      success: true,
      mcpId,
      toolName,
      result,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ExternalMcpCall] ${mcpId}/${toolName} failed:`, message);
    return NextResponse.json({
      success: false,
      error: message,
    }, { status: 500 });
  }
}
