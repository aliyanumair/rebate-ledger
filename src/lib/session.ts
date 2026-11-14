import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE = 'rebate_session';
const secret = () => process.env.SESSION_SECRET || 'local-demo-session-secret-change-in-production';
const signature = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex');

export type Role = 'admin' | 'controller';
export type Session = { email: string; role: Role; exp: number };

export function createSessionToken(email: string, role: Role) {
  const payload = Buffer.from(JSON.stringify({ email, role, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(signature(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export const sessionCookieName = COOKIE;
