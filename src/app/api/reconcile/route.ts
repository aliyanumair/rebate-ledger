import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { guardRequest } from '@/lib/request-guard';
import { parseCsvTable, validateColumnMapping } from '@/lib/csv';
import { reconcile, type PurchaseTransaction, type ReconciliationRules, type SupplierPayment } from '@/lib/reconciliation';
import { saveAudit, saveIntakeFiles } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const rejected = guardRequest(request, 10);
  if (rejected) return rejected;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Malformed reconciliation request.' }, { status: 400 });
  const csv = form.get('csv'), contract = form.get('contract');
  if (!(csv instanceof File) || !csv.name.toLowerCase().endsWith('.csv') || !csv.size || csv.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Attach a non-empty CSV file no larger than 10 MB.' }, { status: 400 });
  }
  if (contract !== null && (!(contract instanceof File) || !contract.name.toLowerCase().endsWith('.pdf') || contract.size > 12 * 1024 * 1024)) {
    return NextResponse.json({ error: 'The contract attachment must be a PDF no larger than 12 MB.' }, { status: 400 });
  }

  try {
    const supplier = String(form.get('supplier') || '').trim();
    const rules = JSON.parse(String(form.get('rules') || 'null')) as ReconciliationRules | null;
    const mapping = JSON.parse(String(form.get('mapping') || 'null')) as Record<string, string> | null;
    const payments = JSON.parse(String(form.get('payments') || '[]')) as SupplierPayment[];
    if (!supplier || supplier.length > 200 || !rules || !mapping || !Array.isArray(payments) || !payments.some(payment => payment?.scope === 'program')) throw new Error('Supplier, verified contract rules, CSV mapping, and an explicit aggregate statement total (including 0.00 when unpaid) are required.');
    if (rules.supplierName !== supplier) throw new Error('Supplier name must match the verified contract rules. Verify the rules again after changing the supplier.');

    const parsed = parseCsvTable(await csv.text());
    validateColumnMapping(mapping, parsed.headers);
    const column = (row: string[], field: string) => {
      const header = mapping[field];
      return header ? row[parsed.headers.indexOf(header)] ?? '' : '';
    };
    const transactions: PurchaseTransaction[] = parsed.rows.map((row, index) => {
      const txnId = column(row, 'txn_id').trim() || `CSV-LINE-${index + 2}`;
      const invoiceId = column(row, 'invoice_id').trim() || undefined;
      const qty = column(row, 'qty');
      const extendedCost = column(row, 'extended_cost');
      const unitCost = column(row, 'unit_cost') || extendedCost;
      return {
        txnId, invoiceId, date: column(row, 'date').trim(), vendorName: column(row, 'vendor_name').trim() || supplier,
        sku: column(row, 'sku').trim(), description: column(row, 'description').trim(), qty, unitCost,
        extendedCost, customerName: column(row, 'customer_name').trim() || undefined,
        projectCode: column(row, 'project_code').trim() || undefined, txnType: column(row, 'txn_type').trim(),
      };
    });

    const result = reconcile(transactions, rules, payments);
    const id = randomUUID();
    const contractBytes = contract instanceof File ? new Uint8Array(await contract.arrayBuffer()) : new Uint8Array();
    await saveIntakeFiles(id, contractBytes, new Uint8Array(await csv.arrayBuffer()));
    await saveAudit({ id, createdAt: new Date().toISOString(), ownerEmail: session.email, supplierName: supplier, csvName: csv.name, contractName: contract instanceof File ? contract.name : null, result });
    return NextResponse.json({ auditId: id, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Reconciliation failed safely. Review the source rows and verified rules.' }, { status: 422 });
  }
}
