import { NextResponse } from 'next/server';
import { getAllExternalMcps, getExternalMcpById } from '@/lib/mcp/external-mcp-registry';

export async function GET() {
  const mcps = getAllExternalMcps().map(mcp => ({
    id: mcp.id,
    name: mcp.name,
    description: mcp.description,
    source: mcp.source,
    transport: mcp.transport,
    tools: mcp.tools.map(t => ({ name: t.name, description: t.description })),
    providerMapping: mcp.providerMapping,
    verified: mcp.verified,
    verifiedAt: mcp.verifiedAt,
    notes: mcp.notes,
  }));

  return NextResponse.json({ mcps }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { id } = body as { id?: string };
  if (!id) {
    return NextResponse.json({ error: 'MCP id is required' }, { status: 400 });
  }

  const mcp = getExternalMcpById(id);
  if (!mcp) {
    return NextResponse.json({ error: `MCP '${id}' not found` }, { status: 404 });
  }

  return NextResponse.json({
    id: mcp.id,
    name: mcp.name,
    description: mcp.description,
    source: mcp.source,
    transport: mcp.transport,
    command: mcp.command,
    args: mcp.args,
    url: mcp.url,
    tools: mcp.tools,
    providerMapping: mcp.providerMapping,
    verified: mcp.verified,
    verifiedAt: mcp.verifiedAt,
    notes: mcp.notes,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
