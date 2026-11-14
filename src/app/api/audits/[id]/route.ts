import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { loadBenchmarkAudit } from '@/lib/benchmark';
import { getAudit } from '@/lib/store';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await context.params;
  if (id === 'demo-q3') {
    const audit = await loadBenchmarkAudit();
    return NextResponse.json({ auditId: id, ...audit });
  }
  const audit = await getAudit(id);
  if (!audit || (session.role !== 'admin' && audit.ownerEmail !== session.email)) return NextResponse.json({ error: 'Audit not found.' }, { status: 404 });
  return NextResponse.json({ auditId: audit.id, supplierName: audit.supplierName, createdAt: audit.createdAt, result: audit.result });
}
