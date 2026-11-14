import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { generateAuditWorkbook, generateDisputePdf } from "../src/lib/exports";
import { reconcile, reconcileCreditStatement, type PurchaseTransaction, type ReconciliationRules } from "../src/lib/reconciliation";

async function main() {
  const statement = reconcileCreditStatement([900, 875, 850, 825, 800].map((paid, index) => ({
    creditId: `CM-${index + 1}`,
    eligibleSpendBasis: "25000.00",
    ratePercent: "4.00",
    paidCredit: paid.toFixed(2),
    invoiceReferences: `Q3-BATCH-${index + 1}`,
    citation: "Carrier rebate agreement, Clause 3.1",
  })));
  if (statement.totals.recoveryFound !== "750.00") throw new Error(`Expected exact $750.00 statement recovery, got $${statement.totals.recoveryFound}`);

  const rules: ReconciliationRules = {
    supplierName: "Carrier HVAC",
    programName: "2026 quarterly rebate",
    tiers: [
      { minSpend: "50000", ratePercent: "2", citation: "Clause 3.1" },
      { minSpend: "100000", ratePercent: "4", citation: "Clause 3.1" },
      { minSpend: "200000", ratePercent: "6", citation: "Clause 3.1" },
    ],
    eligibleSkus: ["ABC100"],
    excludedSkus: ["EXCL1"],
    clauseCitations: ["Clause 3.1 · retroactive tier schedule", "Clause 4.2 · freight excluded", "Clause 7.1 · 45-day claim deadline"],
  };
  const transactions: PurchaseTransaction[] = [
    { txnId: "INV-1", date: "2026-07-05", vendorName: "Carrier HVAC", sku: "ABC-100", description: "Compressor", qty: 1, unitCost: "50000.00", extendedCost: "50000.00", invoiceId: "INV-1" },
    { txnId: "FRT-1", date: "2026-07-05", vendorName: "Carrier HVAC", sku: "FREIGHT", description: "Freight", qty: 1, unitCost: "25.00", extendedCost: "25.00", invoiceId: "INV-1" },
    { txnId: "RET-1", date: "2026-07-06", vendorName: "Carrier HVAC", sku: "ABC100", description: "RMA return", qty: -1, unitCost: "100.00", extendedCost: "-100.00", txnType: "RMA" },
  ];
  const result = reconcile(transactions, rules, [{ scope: "program", amount: "500.00" }]);
  if (result.lines.length !== 3 || result.lines[1].classification !== "EXCLUDED_FREIGHT_OR_TAX" || result.lines[2].classification !== "EXCLUDED_RMA_RETURN") {
    throw new Error("Transaction classification smoke check failed.");
  }
  const xlsxBytes = await generateAuditWorkbook(result);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(xlsxBytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const expectedTabs = ["Executive Summary", "Discrepancy & Claim Lines", "Full Transaction Audit Trail", "Tier & SPA Optimization Alerts"];
  if (JSON.stringify(workbook.worksheets.map((sheet) => sheet.name)) !== JSON.stringify(expectedTabs)) {
    throw new Error(`Unexpected workbook tabs: ${workbook.worksheets.map((sheet) => sheet.name).join(", ")}`);
  }
  const pdfBytes = await generateDisputePdf(result);
  const pdf = await PDFDocument.load(pdfBytes);
  if (pdf.getPageCount() !== 1) throw new Error(`Dispute PDF must be one page, received ${pdf.getPageCount()}.`);
  console.log(`Engine/export checks passed. Statement recovery $${statement.totals.recoveryFound}; workbook ${xlsxBytes.length} bytes; one-page PDF ${pdfBytes.length} bytes.`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
