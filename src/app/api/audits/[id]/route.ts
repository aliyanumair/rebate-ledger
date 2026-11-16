import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { loadBenchmarkAudit } from '@/lib/benchmark';
import { deleteAudit, getAudit } from '@/lib/store';
import { guardRequest } from '@/lib/request-guard';

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

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const rejected = guardRequest(request, 10);
  if (rejected) return rejected;
  const { id } = await context.params;
  if (id === 'demo-q3' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'Audit not found.' }, { status: 404 });
  const audit = await getAudit(id);
  if (!audit || (session.role !== 'admin' && audit.ownerEmail.toLowerCase() !== session.email.toLowerCase())) return NextResponse.json({ error: 'Audit not found.' }, { status: 404 });
  try {
    await deleteAudit(id);
    return NextResponse.json({ ok: true, auditId: id });
  } catch {
    return NextResponse.json({ error: 'Audit could not be removed. Its record remains available; retry or contact an administrator.' }, { status: 500 });
  }
}
