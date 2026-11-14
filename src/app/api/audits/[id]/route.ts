import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { loadBenchmarkAudit } from '@/lib/benchmark';
import { getDraft } from '@/lib/store';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await context.params;
  if (id === 'demo-q3') {
    const audit = await loadBenchmarkAudit();
    return NextResponse.json({ auditId: id, ...audit });
  }
  const draft = await getDraft(id);
  const session = await getSession();
  if (!draft || !draft.result || !draft.statement || (draft.owner !== session?.email && session?.role !== 'admin')) return NextResponse.json({ error: 'Reconciled audit not found.' }, { status: 404 });
  return NextResponse.json({ auditId: id, result: draft.result, statement: draft.statement });
}
