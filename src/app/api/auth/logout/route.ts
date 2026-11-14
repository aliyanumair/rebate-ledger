import { NextResponse } from 'next/server';
import { sessionCookieName } from '@/lib/session';
import { guardRequest } from '@/lib/request-guard';

export async function POST(request: Request) {
  const rejected = guardRequest(request, 30);
  if (rejected) return rejected;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
