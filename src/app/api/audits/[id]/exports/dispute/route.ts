import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { loadBenchmarkAudit } from '@/lib/benchmark';
import { generateDisputePdf } from '@/lib/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await context.params;
  if (id !== 'demo-q3') return NextResponse.json({ error: 'Audit not found.' }, { status: 404 });
  const { result } = await loadBenchmarkAudit();
  const pdf = await generateDisputePdf(result);
  return new NextResponse(new Uint8Array(pdf), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="rebate-ledger-q3-dispute.pdf"',
    'Cache-Control': 'no-store',
  } });
}
