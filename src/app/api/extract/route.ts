import { NextResponse } from 'next/server';
import { extractRulesFromPdf, validateExtractedRules } from '@/lib/extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 4 * 1024 * 1024 + 64 * 1024) return NextResponse.json({ error: 'PDF request exceeds the 4 MB extraction limit.' }, { status: 413 });
  const form = await request.formData();
  const file = form.get('pdf');
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.pdf')) return NextResponse.json({ error: 'Upload a supplier contract or SPA PDF.' }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: 'PDF must be 12 MB or smaller.' }, { status: 413 });
  try {
    const rules = await extractRulesFromPdf(Buffer.from(await file.arrayBuffer()), file.name);
    if (!rules.tiers.length && !rules.spaSkus.length) {
      return NextResponse.json({ error: 'No supported rebate tiers or SPA prices were found. This may be a scanned PDF; run OCR or enter the rules manually, then verify every value and citation before reconciling.' }, { status: 422 });
    }
    if (!validateExtractedRules(rules)) {
      return NextResponse.json({ error: 'The PDF contained terms, but one or more extracted rules are missing a page/clause citation or a calculation method. Review the agreement and enter the rule manually before reconciliation.' }, { status: 422 });
    }
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read this PDF.' }, { status: 422 });
  }
}
