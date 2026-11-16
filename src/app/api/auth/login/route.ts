import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieName } from '@/lib/session';
import { guardRequest } from '@/lib/request-guard';
export async function POST(request: Request) {
  const rejected = guardRequest(request,10); if(rejected) return rejected;
  const formSubmission = (request.headers.get('content-type') || '').toLowerCase().startsWith('application/x-www-form-urlencoded');
  const fail = (status: number, error: string) => formSubmission
    ? NextResponse.redirect(new URL('/login?error=signin', request.url), 303)
    : NextResponse.json({error},{status});
  let body: Record<string, unknown> | null = null;
  if (formSubmission) {
    const form = await request.formData().catch(() => null);
    if (form) body = { email: form.get('email'), password: form.get('password') };
  } else {
    const parsed: unknown = await request.json().catch(()=>null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  }
  if (!body) return fail(400, 'Invalid sign-in request.');
  const b = body;
  if (typeof b.email !== 'string' || typeof b.password !== 'string' || b.email.length>254 || b.password.length>200) return fail(400, 'Invalid sign-in request.');
  const email = b.email.trim().toLowerCase();
  const production = process.env.NODE_ENV === 'production';
  const demoEmail = (process.env.DEMO_EMAIL || 'controller@acme-hvac.com').trim().toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@rebateledger.com').trim().toLowerCase();
  const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value) && value.length <= 254;
  if (!validEmail(demoEmail) || !validEmail(adminEmail) || demoEmail === adminEmail) {
    return fail(503, 'Sign-in account configuration is invalid.');
  }
  const accounts = new Map([
    [demoEmail, {password:process.env.DEMO_PASSWORD || process.env.CONTROLLER_PASSWORD || (!production ? 'Demo1234!' : undefined),role:'controller' as const}],
    [adminEmail, {password:process.env.ADMIN_PASSWORD || (!production ? 'Admin1234!' : undefined),role:'admin' as const}],
  ]);
  const a=accounts.get(email);
  if (!a?.password) return fail(401, 'Email or password is incorrect.');
  const expected=Buffer.from(a.password), got=Buffer.from(b.password);
  if(expected.length!==got.length || !timingSafeEqual(expected,got)) return fail(401, 'Email or password is incorrect.');
  try {
    const response=formSubmission
      ? NextResponse.redirect(new URL('/dashboard', request.url), 303)
      : NextResponse.json({ok:true,email,role:a.role});
    response.cookies.set(sessionCookieName,createSessionToken(email,a.role),{httpOnly:true,secure:production,sameSite:'lax',path:'/',maxAge:8*3600});
    return response;
  } catch { return fail(503, 'Sign-in is not configured for this deployment.'); }
}
