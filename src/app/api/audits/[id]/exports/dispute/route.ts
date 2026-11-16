import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { loadBenchmarkAudit } from '@/lib/benchmark';
import { generateDisputePdf } from '@/lib/exports';
import { getAudit } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await context.params;
  let result;
  if (id === 'demo-q3') result = (await loadBenchmarkAudit()).result;
  else {
    const audit = await getAudit(id);
    if (!audit || (session.role !== 'admin' && audit.ownerEmail !== session.email)) return NextResponse.json({ error: 'Audit not found.' }, { status: 404 });
    result = audit.result;
  }
  const pdf = await generateDisputePdf(result);
  return new NextResponse(new Uint8Array(pdf), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="margins-recovery-${id}-dispute.pdf"`,
    'Cache-Control': 'no-store',
  } });
}
