import { NextRequest, NextResponse } from 'next/server';
import { bearerTokenFromRequest, resolveAccountSessionFromRequest } from '@/lib/account-session';

export async function GET(request: NextRequest) {
  try {
    if (!bearerTokenFromRequest(request)) {
      return NextResponse.json({ authenticated: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    const session = await resolveAccountSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ authenticated: true, ...session }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'account_session_failed';
    return NextResponse.json({ authenticated: false, error: message }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
}
