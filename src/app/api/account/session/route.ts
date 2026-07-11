import { NextRequest, NextResponse } from 'next/server';
import { logoutAccountUser } from '@/lib/account-auth-client';
import { bearerTokenFromRequest, resolveAccountSessionFromRequest } from '@/lib/account-session';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  try {
    if (!bearerTokenFromRequest(request)) {
      return NextResponse.json({ authenticated: false }, { status: 401, headers: noStoreHeaders });
    }
    const session = await resolveAccountSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401, headers: noStoreHeaders });
    }
    return NextResponse.json({ authenticated: true, ...session }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'account_session_failed';
    return NextResponse.json({ authenticated: false, error: message }, { status: 401, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest) {
  const token = bearerTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers: noStoreHeaders });
  }
  try {
    await logoutAccountUser(token);
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'account_logout_failed';
    const status = /invalid|expired|missing_bearer/i.test(message)
      ? 401
      : /not_configured/i.test(message)
        ? 503
        : 502;
    return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
  }
}
