import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieName } from '@/lib/session';

const accounts: Record<string, { password: string; role: 'admin' | 'controller' }> = {
  'controller@acme-hvac.com': { password: 'Demo1234!', role: 'controller' },
  'admin@rebateledger.com': { password: 'Admin1234!', role: 'admin' },
};

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    return NextResponse.json({ error: 'Authentication is not configured. Set SESSION_SECRET in the deployment environment before signing in.' }, { status: 503 });
  }
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() || '';
  const account = accounts[email];
  if (process.env.NODE_ENV === 'production' && process.env.NETLIFY === 'true' && process.env.CONTEXT === 'production') {
    return NextResponse.json({ error: 'Seeded demo accounts are disabled on the production deploy.' }, { status: 403 });
  }
  if (!account || body?.password !== account.password) return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
  const response = NextResponse.json({ ok: true, email, role: account.role });
  response.cookies.set(sessionCookieName, createSessionToken(email, account.role), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 86400 });
  return response;
}
