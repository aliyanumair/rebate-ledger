import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { listAudits } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const audits = await listAudits(session.role === 'admin' ? undefined : session.email);
  return NextResponse.json({ audits: audits.map(audit => ({
    id: audit.id,
    createdAt: audit.createdAt,
    supplierName: audit.supplierName,
    contractName: audit.contractName,
    csvName: audit.csvName,
    recoveryFound: audit.result.totals.unclaimedRecoveryFound,
  })) });
}
