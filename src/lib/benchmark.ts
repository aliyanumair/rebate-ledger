import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsvTable } from "./csv";
import { reconcile, reconcileCreditStatement, type PurchaseTransaction, type ReconciliationRules } from "./reconciliation";

/** Portable synthetic launch fixture. Human-reviewed synthetic rules; never a real customer claim. */
export async function loadBenchmarkAudit() {
  const dir = path.join(process.cwd(), "data/benchmark/launch_sprint");
  const table = parseCsvTable(await readFile(path.join(dir, "02_erp_purchase_export_demo.csv"), "utf8"));
  const purchases: PurchaseTransaction[] = table.rows.map((cells, index) => {
    const row = Object.fromEntries(table.headers.map((header, cell) => [header, cells[cell]]));
    return { txnId: `DEMO-LINE-${index + 1}`, invoiceId: row.invoice_number, date: row.transaction_date, vendorName: row.supplier_name,
      sku: row.supplier_sku, description: row.product_description, qty: row.quantity, unitCost: row.unit_price,
      extendedCost: row.line_amount, txnType: row.line_type };
  });
  const rules: ReconciliationRules = {
    supplierName: "Northstar Climate Systems (synthetic)", programName: "Q3 2026 Core Equipment Rebate — synthetic demo",
    verification: { status: "verified", verifiedBy: "Synthetic fixture review", ruleVersion: "NCS-DEMO-2026-Q3-014-v1" },
    tiers: [{ minSpend: "0", ratePercent: "2", mode: "retroactive", citation: "01_supplier_agreement_demo.pdf, Clause 2" }, { minSpend: "400400", ratePercent: "3", mode: "retroactive", citation: "01_supplier_agreement_demo.pdf, Clause 2" }],
    freightAndTaxTerms: ["freight", "shipping", "tax"], nearMissThreshold: "15000", opportunityMethod: "rate-difference-at-target",
    clauseCitations: ["Agreement NCS-DEMO-2026-Q3-014, Clause 1 — eligibility and freight/tax/returns exclusions", "Clause 2 — 2% base, 3% retroactive at $400,400; $4,004 separate benchmark rate-difference opportunity", "Clause 3 — claim and payment"],
  };
  const payments = [{ scope: "program" as const, amount: "7246.00", reference: "03_manufacturer_credit_statement_demo.pdf: CM-2607-118, CM-2608-204, CM-2609-317, CM-2610-021" }];
  const result = reconcile(purchases, rules, payments);
  // One aggregate statement basis avoids inventing per-memo purchase allocations absent from the source.
  const statement = reconcileCreditStatement([{ creditId: "NCS-CS-2026-Q3-014", eligibleSpendBasis: "399800.00", ratePercent: "2", paidCredit: "7246.00", citation: "03_manufacturer_credit_statement_demo.pdf, Reconciliation summary" }]);
  const groundTruth = { synthetic_only: true, gross_eligible_spend: "399800.00", rebate_earned: "7996.00", supplier_paid: "7246.00", planted_recovery_total: "750.00", tier: { gap_to_next_tier: "600.00", quarter_end_tier_opportunity: "4004.00" }, planted_underpayments: [] };
  return { result, rules, groundTruth, statement };
}
