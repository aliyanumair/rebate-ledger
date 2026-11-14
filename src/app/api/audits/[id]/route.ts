import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { loadBenchmarkAudit } from '@/lib/benchmark';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await context.params;
  if (id !== 'demo-q3') return NextResponse.json({ error: 'Audit not found.' }, { status: 404 });
  const audit = await loadBenchmarkAudit();
  return NextResponse.json({ auditId: id, ...audit });
}
