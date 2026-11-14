import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getIntake } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  const { id, kind } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['pdf', 'csv'].includes(kind)) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  const intake = await getIntake(id);
  if (!intake) return NextResponse.json({ error: 'Intake not found.' }, { status: 404 });
  const fileName = kind === 'pdf' ? 'supplier.pdf' : 'purchases.csv';
  const directory = process.env.REBATE_DATA_DIR || (process.env.VERCEL ? '/tmp/rebate-ledger' : path.join(process.cwd(), 'data', 'runtime'));
  try {
    const body = await readFile(path.join(directory, 'uploads', id, fileName));
    const originalName = kind === 'pdf' ? intake.pdfName : intake.csvName;
    const safeName = originalName.replace(/[\r\n"\\]/g, '_');
    return new NextResponse(new Uint8Array(body), { headers: {
      'Content-Type': kind === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch {
    return NextResponse.json({ error: 'The file is unavailable in this runtime.' }, { status: 404 });
  }
}
