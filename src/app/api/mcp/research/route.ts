import { NextResponse } from 'next/server';
import { researchCatalog } from '@/lib/mcp/research-client';
export async function GET() { return NextResponse.json({ connections: await researchCatalog() }, { headers: { 'Cache-Control': 'no-store' } }); }
