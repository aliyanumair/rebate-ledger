import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDraft, getStoredFile, updateDraft } from '@/lib/store';
import { extractRulesFromPdf } from '@/lib/extractor';
import { extractedRulesMatchSource, validateExtractedRules } from '@/lib/rule-validation';
import { parseCsv } from '@/lib/csv';
import { reconcile, reconcileCreditStatement, type PurchaseTransaction, type RebateTier, type SupplierPayment } from '@/lib/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function findHeader(headers: string[], names: string[]) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return headers.find(header => names.some(name => normalize(name) === normalize(header)));
}
function money(value: string, field: string) {
  const normalized = value.replace(/[$,\s]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`Invalid amount in ${field}: ${value}`);
  return normalized;
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await context.params;
  const draft = await getDraft(id);
  if (!draft || (draft.owner !== session.email && session.role !== 'admin')) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  if (!validateExtractedRules(draft.rules)) return NextResponse.json({ error: 'Reconciliation is blocked because the saved rules are invalid or unverified.' }, { status: 422 });
  const agreementRef = draft.files.find(file => file.role === 'agreement');
  const purchasesRef = draft.files.find(file => file.role === 'purchases');
  const creditsRef = draft.files.find(file => file.role === 'credits');
  if (!agreementRef || !purchasesRef || !creditsRef || !creditsRef.originalName.toLowerCase().endsWith('.csv')) {
    return NextResponse.json({ error: 'Reconciliation requires a persisted agreement PDF, purchase CSV, and credit statement CSV. A credit PDF may be retained as supporting evidence, but upload its CSV for payment matching.' }, { status: 422 });
  }
  try {
    const [agreement, purchaseBytes, creditBytes] = await Promise.all([
      getStoredFile('drafts', id, 'agreement'), getStoredFile('drafts', id, 'purchases'), getStoredFile('drafts', id, 'credits'),
    ]);
    if (!agreement || !purchaseBytes || !creditBytes) throw new Error('One or more persisted source files are unavailable. Re-upload the missing file before reconciling.');
    const sourceRules = await extractRulesFromPdf(agreement, agreementRef.originalName);
    if (!extractedRulesMatchSource(draft.rules, sourceRules, agreementRef.originalName)) throw new Error('Saved rules no longer match the agreement text and citations. Unlock and verify the agreement rules again.');
    const rules = draft.rules;
    const purchaseTable = parseCsv(purchaseBytes.toString('utf8'));
    const creditTable = parseCsv(creditBytes.toString('utf8'));
    const mapping = draft.columnMap;
    const purchases: PurchaseTransaction[] = purchaseTable.rows.map((values, index) => {
      const row = Object.fromEntries(purchaseTable.headers.map((header, column) => [header, values[column] ?? '']));
      const value = (field: string) => row[mapping[field]] ?? '';
      const txnId = value('txn_id').trim();
      if (!txnId) throw new Error(`Purchase row ${index + 2} has no mapped transaction ID.`);
      return { txnId, invoiceId: txnId, date: value('date'), vendorName: value('vendor_name'), sku: value('sku'),
        description: value('description'), qty: value('qty') || '1', unitCost: value('unit_cost') || '0',
        extendedCost: money(value('extended_cost'), 'extended cost'), customerName: value('customer_name'),
        projectCode: value('project_code'), txnType: value('txn_type') };
    });
    const creditIdHeader = findHeader(creditTable.headers, ['credit_memo_id', 'credit_id', 'memo_number', 'credit_number']);
    const referenceHeader = findHeader(creditTable.headers, ['reference_invoice_id', 'invoice_reference', 'invoice_number', 'invoice_no']);
    const basisHeader = findHeader(creditTable.headers, ['eligible_spend_basis', 'eligible_spend', 'spend_basis']);
    const rateHeader = findHeader(creditTable.headers, ['rebate_rate', 'rate_percent', 'rate']);
    const paidHeader = findHeader(creditTable.headers, ['paid_credit', 'credit_paid', 'paid_amount', 'amount_paid']);
    const expectedHeader = findHeader(creditTable.headers, ['expected_credit', 'earned_credit', 'credit_due']);
    if (!creditIdHeader || !referenceHeader || !basisHeader || !rateHeader || !paidHeader) throw new Error('Credit CSV must include credit memo, invoice reference, eligible spend basis, rebate rate, and paid amount columns.');
    const creditLines = creditTable.rows.map((values, index) => {
      const row = Object.fromEntries(creditTable.headers.map((header, column) => [header, values[column] ?? '']));
      const creditId = row[creditIdHeader].trim(); const invoice = row[referenceHeader].trim();
      if (!creditId || !invoice) throw new Error(`Credit statement row ${index + 2} must include a credit ID and invoice reference.`);
      return { creditId, invoice, basis: money(row[basisHeader], 'eligible spend basis'), rate: money(row[rateHeader].replace('%', ''), 'rebate rate'), expected: expectedHeader ? money(row[expectedHeader], 'expected credit') : undefined, paid: money(row[paidHeader], 'paid credit') };
    });
    const txnIds = new Set(purchases.map(tx => tx.txnId));
    const unlinked = creditLines.find(line => !txnIds.has(line.invoice));
    if (unlinked) throw new Error(`Credit ${unlinked.creditId} references invoice ${unlinked.invoice}, which is not present in the mapped purchase file.`);
    const tiers: RebateTier[] = rules.tiers.map(tier => ({ minSpend: tier.minimumSpend, ratePercent: tier.ratePercent, mode: tier.calculation === 'incremental' ? 'incremental' : 'retroactive', citation: `${tier.citation.source}, page ${tier.citation.pageNumber}, Clause ${tier.citation.clauseId}` }));
    const exclusions = rules.exclusions.filter(rule => rule.category === 'sku').flatMap(rule => rule.values);
    const terms = rules.exclusions.filter(rule => rule.category === 'freight' || rule.category === 'tax').flatMap(rule => rule.description.toLowerCase().match(/freight|shipping|handling|delivery|fuel surcharge|tax|vat/g) ?? []);
    const result = reconcile(purchases, { supplierName: draft.supplier, programName: 'Verified supplier rebate program', tiers,
      excludedSkus: [...new Set(exclusions)], freightAndTaxTerms: [...new Set(terms.length ? terms : ['freight', 'shipping', 'delivery', 'tax'])],
      nearMissThreshold: '25000', claimDeadlineDays: rules.claimDeadlines[0]?.days,
      clauseCitations: [...new Set([...rules.tiers.map(tier => `${tier.citation.source}, page ${tier.citation.pageNumber}, Clause ${tier.citation.clauseId}`), ...rules.exclusions.map(rule => `${rule.citation.source}, page ${rule.citation.pageNumber}, Clause ${rule.citation.clauseId}`), ...rules.claimDeadlines.map(rule => `${rule.citation.source}, page ${rule.citation.pageNumber}, Clause ${rule.citation.clauseId}`)])],
    }, creditLines.map((line): SupplierPayment => ({ scope: 'transaction', txnId: line.invoice, amount: line.paid, reference: line.creditId })));
    const statement = reconcileCreditStatement(creditLines.map(line => ({ creditId: line.creditId, eligibleSpendBasis: line.basis, ratePercent: line.rate, expectedCredit: line.expected, paidCredit: line.paid, invoiceReferences: line.invoice, citation: `${agreementRef.originalName}, Clause 5` })));
    const reconciled = await updateDraft({ ...draft, status: 'reconciled', result, statement });
    return NextResponse.json({ ok: true, auditId: reconciled.id, result, statement });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not reconcile these source files.' }, { status: 422 });
  }
}
