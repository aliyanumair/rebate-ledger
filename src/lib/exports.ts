import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ReconciliationResult } from "./reconciliation";

const fmt = (v: string): number => Number(v || 0);

export async function createAuditWorkbook(result: ReconciliationResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Rebate Ledger";
  workbook.created = new Date("2026-01-01T00:00:00.000Z");
  workbook.modified = workbook.created;
  workbook.subject = `Rebate reconciliation: ${result.supplierName}`;
  workbook.title = `${result.programName} Audit Workbook`;
  workbook.views = [{ x: 0, y: 0, width: 16000, height: 9000, firstSheet: 0, activeTab: 0, visibility: "visible" }];

  const navy = "16324F";
  const blue = "2F6B9A";
  const pale = "EAF2F8";
  const header = (sheet: ExcelJS.Worksheet, row = 1) => {
    sheet.getRow(row).height = 25;
    sheet.getRow(row).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${navy}` } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: `FF${blue}` } } };
    });
    sheet.views = [{ state: "frozen", ySplit: row }];
    sheet.autoFilter = { from: { row, column: 1 }, to: { row, column: sheet.columnCount } };
  };
  const currencyColumns = (sheet: ExcelJS.Worksheet, columns: number[]) => {
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      columns.forEach((column) => { row.getCell(column).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)'; });
    });
  };

  const summary = workbook.addWorksheet("Executive Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 38 },
    { header: "Value", key: "value", width: 24 },
  ];
  summary.addRows([
    ["Supplier", result.supplierName], ["Program", result.programName],
    ["Transactions audited", result.totals.transactionCount],
    ["Gross spend", fmt(result.totals.grossSpend)], ["Net eligible spend", fmt(result.totals.netEligibleSpend)],
    ["Rebate earned", fmt(result.totals.rebateEarned)], ["SPA earned", fmt(result.totals.spaEarned)],
    ["Supplier paid", fmt(result.totals.supplierPaid)], ["Unclaimed recovery found", fmt(result.totals.unclaimedRecoveryFound)],
    ["Quarter-end tier opportunity", fmt(result.totals.quarterEndTierOpportunity)],
    ["Exception lines", result.totals.exceptionCount],
    ["Contract citations", result.clauseCitations.join("; ")],
  ]);
  header(summary);
  summary.getColumn(1).font = { bold: true, color: { argb: `FF${navy}` } };
  [4, 5, 6, 7, 8, 9, 10].forEach((row) => { summary.getCell(row, 2).numFmt = '"$"#,##0.00'; });
  summary.eachRow((row, n) => { if (n > 1 && n % 2 === 0) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${pale}` } }; }); });

  const discrepancy = workbook.addWorksheet("Discrepancy & Claim Lines");
  discrepancy.columns = [
    { header: "Transaction ID", key: "txnId", width: 18 }, { header: "Invoice ID", key: "invoiceId", width: 18 },
    { header: "Date", key: "date", width: 14 }, { header: "SKU", key: "sku", width: 18 },
    { header: "Customer", key: "customer", width: 24 }, { header: "Classification", key: "classification", width: 30 },
    { header: "Earned", key: "earned", width: 15 }, { header: "Paid", key: "paid", width: 15 },
    { header: "Recovery", key: "recovery", width: 15 }, { header: "Clause citation", key: "citation", width: 30 },
    { header: "Finding", key: "notes", width: 48 },
  ];
  result.lines.filter((line) => line.recoveryFound !== "0.00" || line.classification !== "ELIGIBLE_VERIFIED").forEach((line) => {
    discrepancy.addRow({ txnId: line.txnId, invoiceId: line.invoiceId ?? "", date: line.date, sku: line.sku,
      customer: line.customerName ?? "", classification: line.classification,
      earned: fmt(line.rebateEarned) + fmt(line.spaEarned), paid: fmt(line.supplierPaid), recovery: fmt(line.recoveryFound),
      citation: line.citation ?? "", notes: line.notes });
  });
  header(discrepancy); currencyColumns(discrepancy, [7, 8, 9]);

  const audit = workbook.addWorksheet("Full Transaction Audit Trail");
  audit.columns = [
    { header: "Transaction ID", key: "txnId", width: 18 }, { header: "Date", key: "date", width: 14 },
    { header: "Invoice ID", key: "invoiceId", width: 18 }, { header: "Supplier", key: "supplier", width: 22 },
    { header: "Raw SKU", key: "sku", width: 20 }, { header: "Normalized SKU", key: "normalizedSku", width: 20 },
    { header: "Description", key: "description", width: 36 }, { header: "Customer", key: "customer", width: 25 },
    { header: "Project", key: "project", width: 16 }, { header: "Qty", key: "qty", width: 12 },
    { header: "Gross spend", key: "gross", width: 15 }, { header: "Net eligible", key: "net", width: 15 },
    { header: "Rebate earned", key: "rebate", width: 15 }, { header: "SPA earned", key: "spa", width: 15 },
    { header: "Supplier paid", key: "paid", width: 15 }, { header: "Recovery", key: "recovery", width: 15 },
    { header: "Classification", key: "classification", width: 31 }, { header: "Rule citation", key: "citation", width: 32 },
    { header: "Notes", key: "notes", width: 52 },
  ];
  result.lines.forEach((line) => audit.addRow({ txnId: line.txnId, date: line.date, invoiceId: line.invoiceId ?? "",
    supplier: line.supplier, sku: line.sku, normalizedSku: line.normalizedSku, description: line.description,
    customer: line.customerName ?? "", project: line.projectCode ?? "", qty: Number(line.qty),
    gross: fmt(line.grossSpend), net: fmt(line.netEligibleSpend), rebate: fmt(line.rebateEarned), spa: fmt(line.spaEarned),
    paid: fmt(line.supplierPaid), recovery: fmt(line.recoveryFound), classification: line.classification,
    citation: line.citation ?? "", notes: line.notes }));
  header(audit); currencyColumns(audit, [11, 12, 13, 14, 15, 16]);

  const alerts = workbook.addWorksheet("Tier & SPA Optimization Alerts");
  alerts.columns = [
    { header: "Alert type", key: "type", width: 25 }, { header: "Current qualifying spend", key: "current", width: 24 },
    { header: "Current rate", key: "rate", width: 16 }, { header: "Next tier spend", key: "next", width: 20 },
    { header: "Next rate", key: "nextRate", width: 16 }, { header: "Spend to tier", key: "needed", width: 18 },
    { header: "Projected rebate uplift", key: "uplift", width: 23 }, { header: "Near miss", key: "near", width: 14 },
    { header: "Citation / details", key: "citation", width: 40 },
  ];
  result.opportunities.forEach((o) => alerts.addRow({ type: "Quarter-end tier opportunity", current: fmt(o.currentSpend),
    rate: `${o.currentRatePercent}%`, next: fmt(o.nextTierSpend), nextRate: `${o.nextRatePercent}%`,
    needed: fmt(o.additionalSpendNeeded), uplift: fmt(o.projectedRebateUplift), near: o.nearMiss ? "Yes" : "No",
    citation: o.citation ?? "" }));
  result.lines.filter((l) => l.spaEarned !== "0.00").forEach((l) => alerts.addRow({ type: "SPA pricing claim",
    current: "", rate: "", next: "", nextRate: "", needed: "", uplift: fmt(l.spaEarned), near: "Claim review",
    citation: `${l.txnId} · ${l.sku} · ${l.citation ?? "SPA rule"}` }));
  if (alerts.rowCount === 1) alerts.addRow({ type: "No tier or SPA alerts", current: "", rate: "", next: "", nextRate: "", needed: "", uplift: 0, near: "", citation: "" });
  header(alerts); currencyColumns(alerts, [2, 4, 6, 7]);

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars && current) {
      lines.push(current);
      current = word;
    } else current = (current + " " + word).trim();
  }
  if (current) lines.push(current);
  return lines;
}

export async function createDisputePdf(result: ReconciliationResult, claimReference = "REBATE-CLAIM"): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Rebate claim - ${result.supplierName}`);
  pdf.setAuthor("Rebate Ledger");
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.09, 0.20, 0.31);
  let y = 748;
  const draw = (text: string, size = 10, isBold = false, color = rgb(0.16, 0.2, 0.24)) => {
    page.drawText(text, { x: 52, y, size, font: isBold ? bold : regular, color, maxWidth: 508 });
    y -= size + 7;
  };
  draw("REBATE PAYMENT DISCREPANCY", 17, true, navy);
  draw(`Claim reference: ${claimReference}  |  Prepared: ${new Date().toISOString().slice(0, 10)}`, 9);
  y -= 8;
  draw("To the Supplier Rebate Claims Team:", 11, true);
  draw(`Please review the reconciliation for ${result.supplierName}, program ${result.programName}. The attached audit identifies posted purchases for which the calculated contractual rebate or approved SPA credit exceeds the amount applied in the supplier statement.`, 10);
  y -= 4;
  draw(`Requested recovery: $${result.totals.unclaimedRecoveryFound}`, 13, true, navy);
  draw(`Qualifying spend reviewed: $${result.totals.netEligibleSpend}  |  Rebate earned: $${result.totals.rebateEarned}  |  SPA earned: $${result.totals.spaEarned}  |  Supplier paid: $${result.totals.supplierPaid}`, 9);
  y -= 4;
  draw("Discrepancy lines", 11, true);
  const claimLines = result.lines.filter((line) => Number(line.recoveryFound) > 0);
  if (claimLines.length === 0) draw("No unpaid line-level variance was found in the supplied payment data.", 9);
  for (const line of claimLines.slice(0, 9)) {
    const detail = `${line.txnId}${line.invoiceId ? ` / invoice ${line.invoiceId}` : ""} · SKU ${line.sku} · earned $${(Number(line.rebateEarned) + Number(line.spaEarned)).toFixed(2)} · paid $${line.supplierPaid} · variance $${line.recoveryFound}`;
    for (const part of wrapText(detail, 96)) draw(part, 8);
  }
  if (claimLines.length > 9) draw(`Plus ${claimLines.length - 9} additional discrepancy line(s) in the attached audit workbook.`, 8);
  y -= 4;
  draw("Contract basis", 11, true);
  const citations = [...new Set([...result.clauseCitations, ...claimLines.map((l) => l.citation).filter((c): c is string => Boolean(c))])];
  for (const citation of (citations.length ? citations : ["Please refer to the approved rebate agreement and SPA rules used for this audit."]).slice(0, 4)) {
    for (const part of wrapText(citation, 96)) draw(part, 8);
  }
  y -= 4;
  draw("Please confirm receipt, provide the calculation detail for any amount disputed, and issue the applicable credit or payment. Supporting transaction-level detail is provided in the accompanying four-tab audit workbook.", 9);
  y -= 4;
  draw("Sincerely,", 9);
  draw("Accounts Payable / Rebate Audit", 9, true);
  page.drawLine({ start: { x: 52, y: 40 }, end: { x: 560, y: 40 }, thickness: 0.5, color: rgb(0.75, 0.8, 0.84) });
  page.drawText("Prepared from ERP transaction records and reviewed program rules. Please validate against original invoices and contract documents before submission.",
    { x: 52, y: 27, size: 7, font: regular, color: rgb(0.4, 0.45, 0.5), maxWidth: 508 });
  return Buffer.from(await pdf.save());
}

export const generateAuditWorkbook = createAuditWorkbook;
export const generateDisputePdf = (result: ReconciliationResult): Promise<Buffer> => createDisputePdf(result);
