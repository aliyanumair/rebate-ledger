import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieName } from '@/lib/session';
import { guardRequest } from '@/lib/request-guard';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (process.env.DEMO_LOGIN_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Demo access is disabled.' }, { status: 404 });
  }

  const rejected = guardRequest(request, 10);
  if (rejected) return rejected;

  try {
    // A unique owner ID keeps each anonymous demo session's audits private from other visitors.
    const email = `demo-${randomUUID()}@anonymous.invalid`;
    const response = NextResponse.json({ ok: true, email, role: 'controller' }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(sessionCookieName, createSessionToken(email, 'controller'), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 4 * 3600,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Demo access is not configured for this deployment.' }, { status: 503 });
  }
}
