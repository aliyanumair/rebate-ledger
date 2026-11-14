import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
const COOKIE = 'rebate_session';
const devSecret = randomBytes(32).toString('hex');
function secret() {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must contain at least 32 characters.');
  return devSecret;
}
const signature = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex');
export type Role = 'admin' | 'controller';
export type Session = { email: string; role: Role; exp: number };
export function createSessionToken(email: string, role: Role) {
  const payload = Buffer.from(JSON.stringify({ email, role, exp: Date.now() + 8 * 3600000 })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
export function verifySessionToken(token: string): Session | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expected = Buffer.from(signature(payload));
    const got = Buffer.from(sig);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object') return null;
    const s = value as Session;
    return typeof s.email === 'string' && ['admin','controller'].includes(s.role) && typeof s.exp === 'number' && s.exp > Date.now() ? s : null;
  } catch { return null; }
}
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}
export const sessionCookieName = COOKIE;
