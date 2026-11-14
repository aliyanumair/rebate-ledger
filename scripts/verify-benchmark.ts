import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import Decimal from 'decimal.js';
import { reconcile, reconcileCreditStatement, type PurchaseTransaction, type RebateTier, type SupplierPayment } from '../src/lib/reconciliation';
import { generateAuditWorkbook, generateDisputePdf } from '../src/lib/exports';
import { extractRulesFromPdf } from '../src/lib/extractor';

const dir = path.join(process.cwd(), 'data/benchmark/sample_set_1');
function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { record.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(value); value = '';
      if (record.some((cell) => cell.length)) records.push(record);
      record = [];
    } else value += char;
  }
  if (value.length || record.length) { record.push(value); records.push(record); }
  const [header, ...rows] = records;
  return rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ''])));
}

type Truth = {
  gross_eligible_spend: string; rebate_earned: string; supplier_paid: string; planted_recovery_total: string;
  tier: { gap_to_next_tier: string; quarter_end_tier_opportunity: string };
  planted_underpayments: Array<{ reference_invoice_id: string; recovery: string }>;
};
type RawRules = {
  supplier: string; program: string; tiers: Array<{ minimum_spend: string; rate: string }>;
  excluded_skus: string[]; excluded_freight_terms: string[]; claim_deadline_days_after_quarter_end: number;
};
async function main() {
const groundTruth = JSON.parse(await readFile(path.join(dir, 'expected_ground_truth.json'), 'utf8')) as Truth;
const benchmarkRules = JSON.parse(await readFile(path.join(dir, 'benchmark_rules.json'), 'utf8')) as RawRules;
const txRows = parseCsv(await readFile(path.join(dir, 'wholesaler_erp_purchases_q3.csv'), 'utf8'));
const creditRows = parseCsv(await readFile(path.join(dir, 'manufacturer_q3_credit_statement.csv'), 'utf8'));
assert.equal(txRows.length, 1500, 'benchmark must include exactly 1,500 transaction rows');
const contractRules = await extractRulesFromPdf(await readFile(path.join(dir, 'carrier_hvac_2026_rebate_agreement.pdf')), 'carrier_hvac_2026_rebate_agreement.pdf');
const spaRules = await extractRulesFromPdf(await readFile(path.join(dir, 'kohler_spa_program_q3.pdf')), 'kohler_spa_program_q3.pdf');
assert.equal(contractRules.tiers.length, 3, 'contract extractor must find all three volume tiers');
assert.equal(contractRules.tiers[2].minimumSpend, '200000.00');
assert.equal(contractRules.tiers[2].calculation, 'retroactive');
assert.ok(contractRules.exclusions.some((rule) => rule.category === 'freight' && rule.citation.clauseId === '4.2'));
assert.ok(contractRules.claimDeadlines.some((rule) => rule.days === 45 && rule.citation.clauseId === '7.1'));
assert.equal(spaRules.spaSkus.length, 15, 'SPA extractor must find all fifteen supported SKU prices');
assert.ok(spaRules.spaClaimbackRules.some((rule) => /returned quantities are not payable/i.test(rule.description)), 'SPA claimback conditions must be extracted with citations');

const transactions: PurchaseTransaction[] = txRows.map((row) => ({
  txnId: row.txn_id, date: row.date, vendorName: row.vendor_name, sku: row.sku,
  description: row.description, qty: row.qty, unitCost: row.unit_cost,
  extendedCost: row.extended_cost, customerName: row.customer_name,
  projectCode: row.project_code, txnType: row.txn_type,
}));
const statement = reconcileCreditStatement(creditRows.map((row) => ({
  creditId: row.credit_memo_id, creditType: 'Quarterly rebate credit',
  eligibleSpendBasis: row.eligible_spend_basis, ratePercent: row.rebate_rate.replace('%', ''),
  paidCredit: row.paid_credit, invoiceReferences: row.reference_invoice_id,
  citation: 'Carrier HVAC agreement, Clause 5.1',
})));
assert.equal(statement.totals.recoveryFound, groundTruth.planted_recovery_total, 'credit statement recovery must match planted ground truth to the cent');
assert.equal(statement.totals.expectedCredit, groundTruth.rebate_earned);
assert.equal(statement.totals.paidCredit, groundTruth.supplier_paid);
assert.equal(statement.lines.filter((line) => line.classification === 'UNDERPAID_CREDIT').length, 5);

const rules = {
  supplierName: benchmarkRules.supplier,
  programName: benchmarkRules.program,
  tiers: benchmarkRules.tiers.map((tier): RebateTier => ({
    minSpend: tier.minimum_spend,
    ratePercent: String(Number(tier.rate) * 100),
    mode: 'retroactive',
    citation: 'carrier_hvac_2026_rebate_agreement.pdf, Clause 2',
  })),
  eligibleSkus: Array.from({ length: 30 }, (_, index) => `CARR-${String(index + 1).padStart(3, '0')}`),
  excludedSkus: benchmarkRules.excluded_skus,
  freightAndTaxTerms: benchmarkRules.excluded_freight_terms,
  nearMissThreshold: '25000',
  claimDeadlineDays: benchmarkRules.claim_deadline_days_after_quarter_end,
  clauseCitations: ['Carrier HVAC rebate agreement, Clause 2', 'Clause 4.2', 'Clause 7.1'],
};
const firstPass = reconcile(transactions, rules);
assert.equal(firstPass.totals.netEligibleSpend, groundTruth.gross_eligible_spend);
assert.equal(firstPass.totals.rebateEarned, groundTruth.rebate_earned);
assert.equal(firstPass.opportunities[0]?.additionalSpendNeeded, groundTruth.tier.gap_to_next_tier);
assert.equal(firstPass.opportunities[0]?.projectedRebateUplift, groundTruth.tier.quarter_end_tier_opportunity);

const planted = new Map<string, string>(groundTruth.planted_underpayments.map((row: { reference_invoice_id: string; recovery: string }) => [row.reference_invoice_id, row.recovery]));
const payments: SupplierPayment[] = firstPass.lines.filter((line) => line.rebateEarned !== '0.00').map((line) => {
  const shortfall = planted.get(line.txnId) ?? '0.00';
  return { txnId: line.txnId, amount: new Decimal(line.rebateEarned).minus(shortfall).toFixed(2) };
});
const audited = reconcile(transactions, rules, payments);
assert.equal(audited.totals.unclaimedRecoveryFound, groundTruth.planted_recovery_total, 'ERP reconciliation must match planted recovery to the cent');
assert.equal(audited.totals.supplierPaid, groundTruth.supplier_paid);
assert.equal(audited.lines.filter((line) => line.recoveryFound !== '0.00').length, 5);

const workbookBytes = await generateAuditWorkbook(audited);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(Buffer.from(workbookBytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
  'Executive Summary', 'Discrepancy & Claim Lines', 'Full Transaction Audit Trail', 'Tier & SPA Optimization Alerts',
]);
const pdfBytes = await generateDisputePdf(audited);
const pdf = await PDFDocument.load(pdfBytes);
assert.equal(pdf.getPageCount(), 1, 'dispute letter must be one page');

console.log(JSON.stringify({
  transactions: txRows.length,
  qualifyingSpend: audited.totals.netEligibleSpend,
  rebateEarned: audited.totals.rebateEarned,
  supplierPaid: audited.totals.supplierPaid,
  recoveryFound: audited.totals.unclaimedRecoveryFound,
  tierGap: audited.opportunities[0]?.additionalSpendNeeded,
  tierOpportunity: audited.totals.quarterEndTierOpportunity,
  workbookBytes: workbookBytes.length,
  workbookSheets: workbook.worksheets.length,
  disputePdfPages: pdf.getPageCount(),
}, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
