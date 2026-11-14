import { NextResponse } from 'next/server';
import { extractRulesFromPdf } from '@/lib/extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('pdf');
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.pdf')) return NextResponse.json({ error: 'Upload a supplier contract or SPA PDF.' }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: 'PDF must be 12 MB or smaller.' }, { status: 413 });
  try {
    const rules = await extractRulesFromPdf(Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read this PDF.' }, { status: 422 });
  }
}
