import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieName } from '@/lib/session';
import { guardRequest } from '@/lib/request-guard';
export async function POST(request: Request) {
  const rejected = guardRequest(request,10); if(rejected) return rejected;
  const body: unknown = await request.json().catch(()=>null);
  if (!body || typeof body !== 'object') return NextResponse.json({error:'Invalid sign-in request.'},{status:400});
  const b = body as Record<string,unknown>;
  if (typeof b.email !== 'string' || typeof b.password !== 'string' || b.email.length>254 || b.password.length>200) return NextResponse.json({error:'Invalid sign-in request.'},{status:400});
  const email = b.email.trim().toLowerCase();
  const production = process.env.NODE_ENV === 'production';
  const demoEmail = (process.env.DEMO_EMAIL || 'controller@acme-hvac.com').trim().toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@rebateledger.com').trim().toLowerCase();
  const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value) && value.length <= 254;
  if (!validEmail(demoEmail) || !validEmail(adminEmail) || demoEmail === adminEmail) {
    return NextResponse.json({error:'Sign-in account configuration is invalid.'},{status:503});
  }
  const accounts = new Map([
    [demoEmail, {password:process.env.DEMO_PASSWORD || process.env.CONTROLLER_PASSWORD || (!production ? 'Demo1234!' : undefined),role:'controller' as const}],
    [adminEmail, {password:process.env.ADMIN_PASSWORD || (!production ? 'Admin1234!' : undefined),role:'admin' as const}],
  ]);
  const a=accounts.get(email);
  if (!a?.password) return NextResponse.json({error:'Email or password is incorrect.'},{status:401});
  const expected=Buffer.from(a.password), got=Buffer.from(b.password);
  if(expected.length!==got.length || !timingSafeEqual(expected,got)) return NextResponse.json({error:'Email or password is incorrect.'},{status:401});
  try {
    const response=NextResponse.json({ok:true,email,role:a.role});
    response.cookies.set(sessionCookieName,createSessionToken(email,a.role),{httpOnly:true,secure:production,sameSite:'lax',path:'/',maxAge:8*3600});
    return response;
  } catch { return NextResponse.json({error:'Sign-in is not configured for this deployment.'},{status:503}); }
}
