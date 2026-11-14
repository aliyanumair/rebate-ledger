import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { extractedRulesMatchSource, validateExtractedRules } from '@/lib/rule-validation';
import { extractRulesFromPdf } from '@/lib/extractor';
import { parseCsv, requiredCsvFields, validateCsvColumnMap } from '@/lib/csv';
import { addDraft, listDrafts, putStoredFile, type DraftRecord, type StoredFileRef, type StoredFileRole } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  return NextResponse.json({ drafts: await listDrafts(session.email), storage: process.env.NETLIFY === 'true' ? 'netlify-blobs' : 'local-persistent-filesystem' });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !['controller', 'admin'].includes(session.role)) return NextResponse.json({ error: 'Controller login required.' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_TOTAL_BYTES + 64 * 1024) return NextResponse.json({ error: 'Combined upload must be 5 MB or smaller to fit the Netlify Functions request limit.' }, { status: 413 });
  const form = await request.formData();
  const supplier = String(form.get('supplier') || '').trim();
  let rules: unknown;
  let columnMap: Record<string, string>;
  try { rules = JSON.parse(String(form.get('rules') || 'null')); columnMap = JSON.parse(String(form.get('columnMap') || '{}')) as Record<string, string>; }
  catch { return NextResponse.json({ error: 'Rules and column mapping must be valid JSON.' }, { status: 400 }); }
  if (!supplier || !validateExtractedRules(rules)) return NextResponse.json({ error: 'A supplier name and verified rules with supported values, calculation method, and page/clause citations are required.' }, { status: 422 });

  const roles: StoredFileRole[] = ['agreement', 'purchases', 'credits'];
  const files = new Map<StoredFileRole, File>();
  for (const role of roles) { const value = form.get(role); if (value instanceof File && value.size > 0) files.set(role, value); }
  const agreement = files.get('agreement');
  const purchases = files.get('purchases');
  if (!agreement || !agreement.name.toLowerCase().endsWith('.pdf')) return NextResponse.json({ error: 'Select a supplier agreement PDF in the Agreement field.' }, { status: 400 });
  if (!purchases || !purchases.name.toLowerCase().endsWith('.csv')) return NextResponse.json({ error: 'Select an ERP purchase CSV in the Purchases field.' }, { status: 400 });
  const creditFile = files.get('credits');
  if (creditFile && !/\.(pdf|csv)$/i.test(creditFile.name)) return NextResponse.json({ error: 'Credit statement must be a PDF or CSV.' }, { status: 400 });
  const totalBytes = [...files.values()].reduce((total, file) => total + file.size, 0);
  if ([...files.values()].some(file => file.size > MAX_FILE_BYTES) || totalBytes > MAX_TOTAL_BYTES) return NextResponse.json({ error: 'Each file must be 4 MB or smaller and the combined upload must be 5 MB or smaller to fit the Netlify Functions request limit.' }, { status: 413 });
  const table = parseCsv(await purchases.text());
  const mappingErrors = validateCsvColumnMap(columnMap, requiredCsvFields());
  if (mappingErrors.length || Object.values(columnMap).some(header => !table.headers.includes(header))) return NextResponse.json({ error: mappingErrors[0] || 'The saved column mapping references a header that is not present in the selected CSV.' }, { status: 422 });

  const id = randomUUID();
  const refs: StoredFileRef[] = [...files.entries()].map(([role, file]) => ({ role, originalName: file.name, mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/csv'), size: file.size }));
  try {
    const sourceRules = await extractRulesFromPdf(new Uint8Array(await agreement.arrayBuffer()), agreement.name);
    if (!extractedRulesMatchSource(rules, sourceRules, agreement.name)) {
      return NextResponse.json({ error: 'Rules do not match the supported terms and citations extracted from the selected agreement. Re-extract and review the source document before saving.' }, { status: 422 });
    }
    await Promise.all([...files.entries()].map(async ([role, file]) => putStoredFile('drafts', id, role, new Uint8Array(await file.arrayBuffer()))));
    const draft: DraftRecord = { id, createdAt: new Date().toISOString(), owner: session.email, supplier, status: 'verified-draft', files: refs, columnMap, rules };
    await addDraft(draft);
    return NextResponse.json({ ok: true, draft, storage: process.env.NETLIFY === 'true' ? 'Netlify Blobs site-wide store (preview and production keys are isolated)' : 'local persistent filesystem' }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Draft could not be persisted: ${error instanceof Error ? error.message : 'storage error'}` }, { status: 507 });
  }
}
