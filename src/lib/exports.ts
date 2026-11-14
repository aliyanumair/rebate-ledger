import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ReconciliationResult } from "./reconciliation";

const fmt = (v: string): number => Number(v || 0);

export async function createAuditWorkbook(result: ReconciliationResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
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
      earned: new Decimal(line.rebateEarned).plus(line.spaEarned).toNumber(), paid: fmt(line.supplierPaid), recovery: fmt(line.recoveryFound),
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
    citation: `${l.txnId} Â· ${l.sku} Â· ${l.citation ?? "SPA rule"}` }));
  if (alerts.rowCount === 1) alerts.addRow({ type: "No tier or SPA alerts", current: "", rate: "", next: "", nextRate: "", needed: "", uplift: 0, near: "", citation: "" });
  header(alerts); currencyColumns(alerts, [2, 4, 6, 7]);

  // Formulas are live, while cached results come from the exact-decimal audit snapshot.
  // Full-column references include added transaction rows without frozen summary ranges.
  const trail = "'Full Transaction Audit Trail'";
  const alertSheet = "'Tier & SPA Optimization Alerts'";
  const formula = (row: number, expression: string, value: string | number) => {
    summary.getCell(row, 2).value = { formula: expression, result: typeof value === "number" ? value : fmt(value) };
  };
  formula(4, `COUNTA(${trail}!A:A)-1`, result.totals.transactionCount);
  for (const [row, column, value] of [
    [5, "K", result.totals.grossSpend], [6, "L", result.totals.netEligibleSpend],
    [7, "M", result.totals.rebateEarned], [8, "N", result.totals.spaEarned],
    [9, "O", result.totals.supplierPaid], [10, "P", result.totals.unclaimedRecoveryFound],
  ] as const) formula(row, `ROUND(SUM(${trail}!${column}:${column}),2)`, value);
  formula(11, `ROUND(SUMIFS(${alertSheet}!G:G,${alertSheet}!A:A,"Quarter-end tier opportunity"),2)`, result.totals.quarterEndTierOpportunity);
  formula(12, `COUNTA(${trail}!Q:Q)-1-COUNTIF(${trail}!Q:Q,"ELIGIBLE_VERIFIED")`, result.totals.exceptionCount);
  for (let row = 5; row <= 11; row += 1) summary.getCell(row, 2).numFmt = "$#,##0.00";
  summary.getCell(4, 2).numFmt = "0";
  summary.getCell(12, 2).numFmt = "0";
  summary.addRow(["Workbook use", "Detail cells are snapshot inputs; summary formulas recalculate when details change. Re-run the verified audit for contractual calculations."]);
  summary.addRow(["Opportunity treatment", "Hypothetical tier uplift only; excluded from earned and recovery totals."]);
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row, index) => {
      if (index > 1) row.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10, color: { argb: "FF16324F" } };
        cell.alignment = { vertical: "top", wrapText: true };
      });
    });
    // ExcelJS has no native autofit: measure displayed content and cap long prose.
    sheet.columns.forEach((column) => {
      let width = 12;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const value = cell.type === ExcelJS.ValueType.Formula ? String(cell.result ?? "") : cell.text;
        width = Math.max(width, Math.min(56, value.length + 3));
      });
      column.width = width;
    });
  });
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

/** Width-based wrapping keeps long supplier names, invoice IDs and clauses inside the page. */
export async function createDisputePdf(result: ReconciliationResult, claimReference = "REBATE-CLAIM"): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Rebate claim - ${result.supplierName}`);
  pdf.setAuthor("Rebate Ledger");
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.09, 0.20, 0.31);
  let y = 746;
  // Standard-font PDFs cannot represent arbitrary Unicode; preserve readable IDs without crashing.
  const safe = (text: string) => text.normalize("NFKC").replace(/[–—−]/g, "-").replace(/[→↔]/g, ":").replace(/·/g, ";").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const wrap = (text: string, size: number, strong: boolean): string[] => {
    const font = strong ? bold : regular;
    const lines: string[] = [];
    let line = "";
    for (const word of safe(text).split(/\s+/)) {
      if (font.widthOfTextAtSize(word, size) > 508) {
        if (line) { lines.push(line); line = ""; }
        for (const character of word) {
          if (font.widthOfTextAtSize(line + character, size) > 508) { lines.push(line); line = ""; }
          line += character;
        }
      } else if (font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) > 508) {
        lines.push(line); line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines;
  };
  const draw = (text: string, size = 10, strong = false, maxLines = 10) => {
    const lines = wrap(text, size, strong);
    if (lines.length > maxLines) throw new Error("Dispute PDF text exceeds its verified one-page section limit; shorten metadata or use the audit workbook for detail.");
    for (const line of lines) {
      if (y < 75) throw new Error("Dispute PDF exceeds one-page capacity.");
      page.drawText(line, { x: 52, y, size, font: strong ? bold : regular, color: strong ? navy : rgb(0.16, 0.2, 0.24) });
      y -= size + 4;
    }
    y -= 5;
  };
  draw("REBATE PAYMENT DISCREPANCY", 17, true, 1);
  draw(`Claim: ${claimReference} | Prepared: ${new Date().toISOString().slice(0, 10)}`, 8, false, 2);
  draw(`To: ${result.supplierName} - Rebate Claims Team`, 10, true, 2);
  draw(`Program: ${result.programName}`, 9, false, 2);
  draw("Please review the contractual earnings and posted supplier credits summarized below. We request the net recovery supported by the accompanying transaction audit workbook.", 10, false, 3);
  draw(`NET RECOVERY REQUESTED: $${result.totals.unclaimedRecoveryFound}`, 14, true, 1);
  draw(`Eligible purchases: $${result.totals.netEligibleSpend} | Rebate earned: $${result.totals.rebateEarned}`, 9, false, 2);
  draw(`SPA earned: $${result.totals.spaEarned} | Supplier paid: $${result.totals.supplierPaid}`, 9, false, 2);
  draw("Affected invoices and claim detail", 10, true, 1);
  const claims = result.lines.filter((line) => new Decimal(line.recoveryFound).gt(0));
  const shown = claims.slice(0, 5);
  if (!claims.length) draw("No positive unpaid variance was found in the supplied payment data.", 9, false, 2);
  for (const line of shown) draw(`${line.invoiceId ?? line.txnId} | txn ${line.txnId} | earned $${new Decimal(line.rebateEarned).plus(line.spaEarned).toFixed(2)} | paid $${line.supplierPaid} | owed $${line.recoveryFound}`, 8, false, 2);
  if (claims.length > shown.length) draw(`${claims.length - shown.length} additional affected lines are itemized in Discrepancy & Claim Lines in the attached workbook.`, 8, false, 2);
  draw("Exact contractual basis", 10, true, 1);
  const citations = [...new Set([...result.clauseCitations, ...claims.map((line) => line.citation).filter((value): value is string => Boolean(value))])];
  if (!citations.length) throw new Error("A dispute letter requires verified contract clause citations.");
  for (const citation of citations.slice(0, 4)) draw(citation, 8, false, 3);
  if (citations.length > 4) draw("Additional exact rule citations appear against each transaction in the audit workbook.", 8, false, 2);
  draw(`The separate $${result.totals.quarterEndTierOpportunity} tier opportunity is hypothetical and is not included in this claim.`, 8, false, 2);
  draw("Please confirm receipt, identify any disputed invoice or clause, and issue the supported credit. This letter and workbook remain subject to original-document review before submission.", 9, false, 3);
  draw("Accounts Payable / Rebate Audit", 9, true, 1);
  page.drawLine({ start: { x: 52, y: 47 }, end: { x: 560, y: 47 }, thickness: 0.5, color: rgb(0.75, 0.8, 0.84) });
  page.drawText("Rebate Ledger | Contract rules + deterministic transaction reconciliation | Supporting workbook required", { x: 52, y: 33, size: 7, font: regular, color: rgb(0.4, 0.45, 0.5) });
  return Buffer.from(await pdf.save());
}

export const generateAuditWorkbook = createAuditWorkbook;
export const generateDisputePdf = (result: ReconciliationResult): Promise<Buffer> => createDisputePdf(result);
