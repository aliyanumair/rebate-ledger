import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { guardRequest } from '@/lib/request-guard';
import { extractRulesFromPdf } from '@/lib/extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({error:'Authentication required.'},{status:401});
  const rejected=guardRequest(request,15); if(rejected) return rejected;
  const form = await request.formData().catch(()=>null);
  if(!form) return NextResponse.json({error:'Malformed upload.'},{status:400});
  const file = form.get('pdf');
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.pdf')) return NextResponse.json({ error: 'Upload a supplier contract or SPA PDF.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({error:'PDF is empty. Use Manual Contract Rule Entry.'},{status:422});
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'PDF must be 12 MB or smaller.' }, { status: 413 });
  try {
    const rules = await extractRulesFromPdf(Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read this PDF.' }, { status: 422 });
  }
}
