import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { reconcile, reconcileCreditStatement, type PurchaseTransaction, type RebateTier, type SupplierPayment } from './reconciliation';

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cells: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { cells.push(cell); cell = ''; }
    else if ((ch === '\r' || ch === '\n') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cells.push(cell); cell = '';
      if (cells.some((value) => value.length > 0)) rows.push(cells);
      cells = [];
    } else cell += ch;
  }
  if (cell.length || cells.length) { cells.push(cell); rows.push(cells); }
  const [headers, ...records] = rows;
  return records.map((row) => Object.fromEntries((headers ?? []).map((header, index) => [header, row[index] ?? ''])));
}

const BENCHMARK_DIR = path.join(process.cwd(), 'data/benchmark/sample_set_1');
type BenchmarkRules = {
  supplier: string;
  program: string;
  tiers: Array<{ minimum_spend: string; rate: string }>;
  excluded_skus: string[];
  excluded_freight_terms: string[];
  claim_deadline_days_after_quarter_end: number;
};
type BenchmarkGroundTruth = {
  planted_underpayments: Array<{ reference_invoice_id: string; recovery: string }>;
};

export async function loadBenchmarkAudit() {
  const [purchaseCsv, creditCsv, rulesJson, groundTruthJson] = await Promise.all([
    readFile(path.join(BENCHMARK_DIR, 'wholesaler_erp_purchases_q3.csv'), 'utf8'),
    readFile(path.join(BENCHMARK_DIR, 'manufacturer_q3_credit_statement.csv'), 'utf8'),
    readFile(path.join(BENCHMARK_DIR, 'benchmark_rules.json'), 'utf8'),
    readFile(path.join(BENCHMARK_DIR, 'expected_ground_truth.json'), 'utf8'),
  ]);
  const rawRules = JSON.parse(rulesJson) as BenchmarkRules;
  const groundTruth = JSON.parse(groundTruthJson) as BenchmarkGroundTruth;
  const purchases = parseCsv(purchaseCsv).map((row): PurchaseTransaction => ({
    txnId: row.txn_id, invoiceId: row.txn_id, date: row.date, vendorName: row.vendor_name,
    sku: row.sku, description: row.description, qty: row.qty, unitCost: row.unit_cost,
    extendedCost: row.extended_cost, customerName: row.customer_name, projectCode: row.project_code,
    txnType: row.txn_type,
  }));
  const claims = parseCsv(creditCsv);
  const statement = reconcileCreditStatement(claims.map((row) => ({
    creditId: row.credit_memo_id, date: row.period, creditType: 'Quarterly rebate credit',
    eligibleSpendBasis: row.eligible_spend_basis, ratePercent: row.rebate_rate.replace('%', ''),
    paidCredit: row.paid_credit, invoiceReferences: row.reference_invoice_id,
    citation: 'Carrier HVAC 2026 agreement, Clause 5.1',
  })));
  const rules = {
    supplierName: rawRules.supplier,
    programName: rawRules.program,
    tiers: rawRules.tiers.map((tier): RebateTier => ({
      minSpend: tier.minimum_spend,
      ratePercent: String(Number(tier.rate) * 100),
      mode: 'retroactive',
      citation: 'carrier_hvac_2026_rebate_agreement.pdf, Clause 2',
    })),
    eligibleSkus: Array.from({ length: 30 }, (_, index) => `CARR-${String(index + 1).padStart(3, '0')}`),
    excludedSkus: rawRules.excluded_skus as string[],
    freightAndTaxTerms: rawRules.excluded_freight_terms as string[],
    nearMissThreshold: '25000',
    claimDeadlineDays: Number(rawRules.claim_deadline_days_after_quarter_end),
    clauseCitations: [
      'Carrier HVAC agreement, Clause 2 — quarterly retroactive tiers',
      'Carrier HVAC agreement, Clause 4.2 — freight and tax exclusion',
      'Carrier HVAC agreement, Clause 7.1 — 45-day claim deadline',
    ],
  };
  const firstPass = reconcile(purchases, rules);
  const underpayments = new Map<string, string>((groundTruth.planted_underpayments as Array<{ reference_invoice_id: string; recovery: string }>).map((row) => [row.reference_invoice_id, row.recovery]));
  const payments: SupplierPayment[] = firstPass.lines.filter((line) => Number(line.rebateEarned) > 0).map((line) => ({
    txnId: line.txnId,
    amount: (Number(line.rebateEarned) - Number(underpayments.get(line.txnId) ?? '0.00')).toFixed(2),
  }));
  return { result: reconcile(purchases, rules, payments), statement, groundTruth, rules };
}
