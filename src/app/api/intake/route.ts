import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { addIntake } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const company = String(form.get('company') || '').trim();
  const name = String(form.get('name') || '').trim();
  const email = String(form.get('email') || '').trim();
  const supplier = String(form.get('supplier') || '').trim();
  const pdf = form.get('pdf');
  const csv = form.get('csv');
  if (!company || !name || !/^\S+@\S+\.\S+$/.test(email) || !supplier) return NextResponse.json({ error: 'Complete company, name, valid email, and supplier.' }, { status: 400 });
  if (!(pdf instanceof File) || !(csv instanceof File) || !pdf.name.toLowerCase().endsWith('.pdf') || !csv.name.toLowerCase().endsWith('.csv')) return NextResponse.json({ error: 'Attach a supplier PDF and ERP CSV.' }, { status: 400 });
  if (pdf.size > MAX_FILE_BYTES || csv.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'Each file must be 12 MB or smaller.' }, { status: 413 });
  const id = randomUUID();
  const dir = path.join(process.env.REBATE_DATA_DIR || (process.env.VERCEL ? '/tmp/rebate-ledger' : path.join(process.cwd(), 'data', 'runtime')), 'uploads', id);
  try {
    await mkdir(dir, { recursive: true });
    await Promise.all([writeFile(path.join(dir, 'supplier.pdf'), Buffer.from(await pdf.arrayBuffer())), writeFile(path.join(dir, 'purchases.csv'), Buffer.from(await csv.arrayBuffer()))]);
  } catch {
    return NextResponse.json({ error: 'Could not store the uploaded files in this runtime.' }, { status: 507 });
  }
  const item = await addIntake({ id, createdAt: new Date().toISOString(), company, name, email, supplier, pdfName: pdf.name, csvName: csv.name, status: 'queued' });
  return NextResponse.json({ ok: true, intake: item }, { status: 201 });
}
