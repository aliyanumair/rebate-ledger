import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieName } from '@/lib/session';

const accounts: Record<string, { password: string; role: 'admin' | 'controller' }> = {
  'controller@acme-hvac.com': { password: 'Demo1234!', role: 'controller' },
  'admin@rebateledger.com': { password: 'Admin1234!', role: 'admin' },
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() || '';
  const account = accounts[email];
  if (!account || body?.password !== account.password) return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
  const response = NextResponse.json({ ok: true, email, role: account.role });
  response.cookies.set(sessionCookieName, createSessionToken(email, account.role), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 86400 });
  return response;
}
