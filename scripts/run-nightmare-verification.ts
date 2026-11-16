import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { parseCsvDecimal, parseCsvTable, detectColumnMapping, validateColumnMapping } from '../src/lib/csv';
import { extractRulesFromPdf } from '../src/lib/extractor';
import { createAuditWorkbook, createDisputePdf } from '../src/lib/exports';
import { reconcile, type PurchaseTransaction, type ReconciliationRules, type SupplierPayment } from '../src/lib/reconciliation';

const dir = path.join(process.cwd(), 'data', 'benchmark', 'nightmare_set');
const money = (value: string) => new Decimal(value);

async function main() {
  const truth = JSON.parse(await readFile(path.join(dir, 'ground_truth.json'), 'utf8')) as { expected: Record<string, string>; traps: Record<string, string | number> };
  const volumeBytes = await readFile(path.join(dir, 'trane_commercial_rebate_q3_2026.pdf'));
  const spaBytes = await readFile(path.join(dir, 'watts_plumbing_spa_q3_2026.pdf'));
  const volumeDocument = await PDFDocument.load(volumeBytes);
  const spaDocument = await PDFDocument.load(spaBytes);
  assert.equal(volumeDocument.getPageCount(), 3);
  assert.equal(spaDocument.getPageCount(), 3);
  const volumeText = volumeBytes.toString('latin1');
  const spaText = spaBytes.toString('latin1');
  assert.match(volumeText, /Clause 4\.3/);
  assert.match(volumeText, /2\.25% retroactive/);
  assert.match(volumeText, /3\.75% retroactive/);
  assert.match(spaText, /Clause 6\.1/);

  const extracted = await extractRulesFromPdf(volumeBytes, 'trane_commercial_rebate_q3_2026.pdf');
  const spaExtracted = await extractRulesFromPdf(spaBytes, 'watts_plumbing_spa_q3_2026.pdf');
  assert.equal(extracted.extractionMethod, 'deterministic-regex');
  assert.equal(extracted.supplierName, 'Trane Commercial');
  assert.equal(extracted.programName, 'Q3 2026 Commercial Volume Rebate');
  assert.equal(extracted.effectiveStartDate, '2026-07-01');
  assert.equal(extracted.effectiveEndDate, '2026-09-30');
  assert.deepEqual(extracted.tiers.map(tier => [tier.minimumSpend, tier.maximumSpend, tier.ratePercent, tier.calculation]), [
    ['0.00', '99999.99', '0', 'retroactive'], ['100000.00', '249999.99', '2.25', 'retroactive'], ['250000.00', null, '3.75', 'retroactive'],
  ]);
  assert.ok(extracted.exclusions.some(rule => rule.citation.clauseId === '4.3' && /freight|fuel surcharge|sales tax|RMA/i.test(rule.description)));
  assert.equal(spaExtracted.spaSkus.length, 4);
  assert.ok(spaExtracted.spaSkus.every(rule => rule.standardCost === '1200.00' && rule.supportedPrice === '960.00'));
  const approved = spaExtracted.spaSkus[0].approvedContractors;
  assert.ok(approved.includes('Metro Mechanical LLC') && approved.includes('Summit Piping Corp.'));

  const csv = parseCsvTable(await readFile(path.join(dir, 'dirty_erp_export_q3_2026.csv'), 'utf8'));
  const mapping = detectColumnMapping(csv.headers);
  validateColumnMapping(mapping, csv.headers);
  assert.equal(csv.rows.length, 2024);
  assert.equal(mapping.date, 'Inv_Date');
  assert.equal(mapping.sku, 'Item_Part_Number');
  assert.equal(mapping.qty, 'Ship_Qty');
  assert.equal(mapping.extended_cost, 'Ext_Net_Amt');
  const column = (row: string[], key: string) => mapping[key] ? row[csv.headers.indexOf(mapping[key])] ?? '' : '';
  const transactions: PurchaseTransaction[] = csv.rows.map((row, index) => {
    const extendedCost = parseCsvDecimal(column(row, 'extended_cost'), 'extended cost');
    return {
      txnId: column(row, 'txn_id') || `CSV-LINE-${index + 2}`,
      invoiceId: column(row, 'invoice_id') || undefined,
      date: column(row, 'date'), vendorName: column(row, 'vendor_name') || 'Trane Commercial',
      sku: column(row, 'sku'), description: column(row, 'description'), qty: parseCsvDecimal(column(row, 'qty'), 'quantity'),
      unitCost: column(row, 'unit_cost') ? parseCsvDecimal(column(row, 'unit_cost'), 'unit cost') : extendedCost,
      extendedCost, customerName: column(row, 'customer_name') || undefined, txnType: column(row, 'txn_type'),
    };
  });
  assert.equal(parseCsvDecimal('($2,500.00)', 'test amount'), '-2500.00');
  assert.equal(parseCsvDecimal('$1,200.00', 'test amount'), '1200.00');

  const credits = parseCsvTable(await readFile(path.join(dir, 'supplier_credit_memo_q3_2026.csv'), 'utf8'));
  const creditColumn = (row: string[], name: string) => row[credits.headers.indexOf(name)] ?? '';
  const payments: SupplierPayment[] = credits.rows.map(row => ({ scope: 'program', amount: parseCsvDecimal(creditColumn(row, 'Paid_Credit'), 'credit memo paid amount'), reference: creditColumn(row, 'Credit_ID') }));
  const rules: ReconciliationRules = {
    supplierName: extracted.supplierName ?? 'Trane Commercial', programName: extracted.programName ?? 'Q3 2026 Commercial Volume Rebate',
    verification: { status: 'verified', verifiedBy: 'nightmare-fixture-independent-source-review', ruleVersion: 'q3-2026-fixture-v1' },
    effectiveStartDate: extracted.effectiveStartDate ?? undefined, effectiveEndDate: extracted.effectiveEndDate ?? undefined,
    tiers: extracted.tiers.map(tier => ({ minSpend: tier.minimumSpend, ratePercent: tier.ratePercent, mode: tier.calculation as 'retroactive' | 'incremental', citation: tier.citation.clauseId ? `Clause ${tier.citation.clauseId}` : 'Tier schedule' })),
    eligibleSkus: ['TRN-COM-100'], excludedSkuPrefixes: ['TRN-ACC-'],
    freightAndTaxTerms: ['freight', 'fuel surcharge', 'sales tax', 'pallet'],
    spas: spaExtracted.spaSkus.map(item => ({ sku: item.sku, standardPrice: item.standardCost!, supportedPrice: item.supportedPrice!, approvedCustomers: item.approvedContractors, stackWithVolumeRebate: false, citation: `Clause 6.1; ${item.citation.excerpt}` })),
    nearMissThreshold: '5000.00', clauseCitations: ['Clause 4.3', 'Clause 6.1'],
  };
  const result = reconcile(transactions, rules, payments);
  const actual = {
    eligibleVolumeSpend: result.totals.netEligibleSpend, volumeRebateEarned: result.totals.rebateEarned,
    spaEarned: result.totals.spaEarned, totalEarned: money(result.totals.rebateEarned).plus(result.totals.spaEarned).toFixed(2),
    totalPaid: result.totals.supplierPaid, totalRecovery: result.totals.unclaimedRecoveryFound,
  };
  for (const [key, value] of Object.entries(actual)) assert.equal(value, truth.expected[key], `ground truth mismatch for ${key}`);
  const sumPaidVolume = payments[0].amount;
  const sumPaidSpa = payments[1].amount;
  assert.equal(sumPaidVolume, truth.expected.volumePaid);
  assert.equal(sumPaidSpa, truth.expected.spaPaid);
  assert.equal(money(truth.expected.volumeRebateEarned).minus(sumPaidVolume).toFixed(2), truth.expected.volumeRecovery);
  assert.equal(money(truth.expected.spaEarned).minus(sumPaidSpa).toFixed(2), truth.expected.spaRecovery);
  const eligibleRows = result.lines.filter(line => line.netEligibleSpend !== '0.00');
  assert.equal(eligibleRows.reduce((total, line) => total.plus(line.netEligibleSpend), new Decimal(0)).toFixed(2), '264000.00');
  assert.equal(result.lines.filter(line => line.classification === 'EXCLUDED_FREIGHT_OR_TAX').reduce((total, line) => total.plus(line.grossSpend), new Decimal(0)).toFixed(2), '19400.00');
  assert.equal(result.lines.filter(line => line.classification === 'EXCLUDED_RMA_RETURN').reduce((total, line) => total.plus(line.grossSpend), new Decimal(0)).toFixed(2), '-22850.00');
  assert.equal(result.lines.filter(line => line.classification === 'EXCLUDED_NON_QUALIFYING_SKU').reduce((total, line) => total.plus(line.grossSpend), new Decimal(0)).toFixed(2), '16200.00');
  assert.equal(result.lines.filter(line => line.classification === 'EXCLUDED_OUTSIDE_PROGRAM_PERIOD').reduce((total, line) => total.plus(line.grossSpend), new Decimal(0)).toFixed(2), '31000.00');
  assert.equal(result.lines.filter(line => line.sku.startsWith('MYSTERY-') && line.classification === 'UNMATCHED_SKU_NEEDS_REVIEW').reduce((total, line) => total.plus(line.grossSpend), new Decimal(0)).toFixed(2), '12500.00');
  assert.equal(result.lines.filter(line => line.spaEarned === '240.00').length, 15);
  assert.equal(result.lines.filter(line => line.sku.startsWith('WTS-') && line.spaEarned === '0.00').length, 8);
  assert.equal(result.totals.quarterEndTierOpportunity, '0.00', 'there is no higher tier; opportunities cannot inflate earned rebate');
  assert.equal(result.totals.unclaimedRecoveryFound, '6120.00');
  assert.equal(result.totals.transactionCount, 2024);
  assert.equal(result.totals.exceptionCount, result.lines.filter(line => line.classification !== 'ELIGIBLE_VERIFIED').length);

  const workbookBytes = await createAuditWorkbook(result);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.equal(workbook.worksheets.length, 4);
  assert.equal(workbook.creator, 'MarginsRecovery');
  const summary = workbook.getWorksheet('Executive Summary')!;
  assert.equal(new Decimal(String(summary.getCell(6, 2).result)).toFixed(2), '264000.00');
  assert.equal(new Decimal(String(summary.getCell(7, 2).result)).toFixed(2), '9900.00');
  assert.equal(new Decimal(String(summary.getCell(8, 2).result)).toFixed(2), '3600.00');
  assert.equal(new Decimal(String(summary.getCell(9, 2).result)).toFixed(2), '7380.00');
  assert.equal(new Decimal(String(summary.getCell(10, 2).result)).toFixed(2), '6120.00');
  const exportDir = path.join(process.cwd(), '.artifacts', 'nightmare');
  await mkdir(exportDir, { recursive: true });
  await writeFile(path.join(exportDir, 'nightmare_audit.xlsx'), workbookBytes);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.readFile(path.join(exportDir, 'nightmare_audit.xlsx'));
  assert.equal(reopened.worksheets.length, 4);

  const disputeBytes = await createDisputePdf(result, 'CM-TRANE-Q3; CM-WATTS-Q3');
  const disputeDoc = await PDFDocument.load(disputeBytes);
  assert.equal(disputeDoc.getPageCount(), 1);
  assert.equal(disputeDoc.getTitle(), 'MarginsRecovery Rebate Claim - Trane Commercial');
  await writeFile(path.join(exportDir, 'nightmare_dispute.pdf'), disputeBytes);
  const reopenedPdf = await PDFDocument.load(await readFile(path.join(exportDir, 'nightmare_dispute.pdf')));
  assert.equal(reopenedPdf.getPageCount(), 1);

  console.log(JSON.stringify({ verdict: 'PASS', sourceFiles: ['3-page Trane contract PDF', '3-page Watts SPA PDF', '2,024-row messy ERP CSV', 'supplier credit memo CSV'], extractedTierCount: extracted.tiers.length, extractedSpaSkuCount: spaExtracted.spaSkus.length, transactionCount: result.totals.transactionCount, actual, exceptions: { freightTaxPallet: '19400.00', rma: '-22850.00', excludedSku: '16200.00', outsideWindow: '31000.00', unknownSku: '12500.00' }, spaApprovedUnits: 15, spaUnapprovedUnits: 8, workbookTabs: workbook.worksheets.map(sheet => sheet.name), disputePdfPages: disputeDoc.getPageCount(), exactVariance: '0.00' }, null, 2));
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
