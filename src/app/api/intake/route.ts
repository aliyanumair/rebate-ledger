import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { addIntake, putStoredFile } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Netlify Functions cap buffered request/response payloads at 6 MB; leave room
// for multipart boundaries and fields so this endpoint remains deployable.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_TOTAL_BYTES + 64 * 1024) return NextResponse.json({ error: 'Combined upload must be 5 MB or smaller to fit the Netlify Functions request limit.' }, { status: 413 });
  const form = await request.formData();
  const company = String(form.get('company') || '').trim();
  const name = String(form.get('name') || '').trim();
  const email = String(form.get('email') || '').trim();
  const supplier = String(form.get('supplier') || '').trim();
  const pdf = form.get('pdf');
  const csv = form.get('csv');
  if (!company || !name || !/^\S+@\S+\.\S+$/.test(email) || !supplier) return NextResponse.json({ error: 'Complete company, name, valid email, and supplier.' }, { status: 400 });
  if (!(pdf instanceof File) || !(csv instanceof File) || !pdf.name.toLowerCase().endsWith('.pdf') || !csv.name.toLowerCase().endsWith('.csv')) return NextResponse.json({ error: 'Attach a supplier PDF and ERP CSV.' }, { status: 400 });
  if (pdf.size > MAX_FILE_BYTES || csv.size > MAX_FILE_BYTES || pdf.size + csv.size > MAX_TOTAL_BYTES) return NextResponse.json({ error: 'Each file must be 4 MB or smaller and the combined upload must be 5 MB or smaller (Netlify request limit).' }, { status: 413 });
  const id = randomUUID();
  try {
    await Promise.all([
      putStoredFile('intakes', id, 'agreement', new Uint8Array(await pdf.arrayBuffer())),
      putStoredFile('intakes', id, 'purchases', new Uint8Array(await csv.arrayBuffer())),
    ]);
    const item = await addIntake({ id, createdAt: new Date().toISOString(), company, name, email, supplier, pdfName: pdf.name, csvName: csv.name,
      files: [{ role: 'agreement', originalName: pdf.name, mimeType: 'application/pdf', size: pdf.size }, { role: 'purchases', originalName: csv.name, mimeType: 'text/csv', size: csv.size }], status: 'queued' });
    return NextResponse.json({ ok: true, storage: process.env.NETLIFY === 'true' ? 'netlify-blobs' : 'local-persistent-filesystem', intake: item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Could not persist the upload: ${error instanceof Error ? error.message : 'storage error'}` }, { status: 507 });
  }
}
