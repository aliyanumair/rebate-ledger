import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { listIntakes } from '@/lib/store';

export const dynamic = 'force-dynamic';
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  return NextResponse.json({ audits: await listIntakes(), role: session.role });
}
