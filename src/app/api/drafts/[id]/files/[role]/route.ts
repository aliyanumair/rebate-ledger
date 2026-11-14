import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDraft, getStoredFile, type StoredFileRole } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string; role: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id, role: rawRole } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['agreement', 'purchases', 'credits'].includes(rawRole)) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  const draft = await getDraft(id);
  if (!draft || (draft.owner !== session.email && session.role !== 'admin')) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  const role = rawRole as StoredFileRole;
  const ref = draft.files.find(file => file.role === role);
  if (!ref) return NextResponse.json({ error: 'No file is attached for this role.' }, { status: 404 });
  try {
    const bytes = await getStoredFile('drafts', id, role);
    if (!bytes) return NextResponse.json({ error: 'Persisted source file is unavailable.' }, { status: 404 });
    const safeName = ref.originalName.replace(/[\r\n"\\]/g, '_');
    return new NextResponse(new Uint8Array(bytes), { headers: {
      'Content-Type': ref.mimeType,
      'Content-Disposition': `${role === 'agreement' || ref.mimeType === 'application/pdf' ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    return NextResponse.json({ error: `Could not retrieve persisted source file: ${error instanceof Error ? error.message : 'storage error'}` }, { status: 503 });
  }
}
