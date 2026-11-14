import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { loadBenchmarkAudit } from '../src/lib/benchmark';
import { createAuditWorkbook, createDisputePdf } from '../src/lib/exports';

async function main() {
  const { result } = await loadBenchmarkAudit();
  assert.equal(result.totals.netEligibleSpend, '399800.00');
  assert.equal(result.totals.rebateEarned, '7996.00');
  assert.equal(result.totals.supplierPaid, '7246.00');
  assert.equal(result.totals.unclaimedRecoveryFound, '750.00');
  assert.equal(result.totals.quarterEndTierOpportunity, '4004.00');
  const bytes = await createAuditWorkbook(result);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.equal(workbook.worksheets.length, 4);
  const summary = workbook.getWorksheet('Executive Summary')!;
  const audit = workbook.getWorksheet('Full Transaction Audit Trail')!;
  const totals = [result.totals.grossSpend, result.totals.netEligibleSpend, result.totals.rebateEarned, result.totals.spaEarned, result.totals.supplierPaid, result.totals.unclaimedRecoveryFound];
  for (let i = 0; i < totals.length; i += 1) {
    const cell = summary.getCell(5 + i, 2);
    assert.match(cell.formula, /^ROUND\(SUM\(/);
    assert.equal(new Decimal(String(cell.result)).toFixed(2), totals[i]);
    let sum = new Decimal(0);
    audit.getColumn(11 + i).eachCell((value, row) => { if (row > 1) sum = sum.plus(String(value.value)); });
    assert.equal(sum.toFixed(2), totals[i], 'detail must equal engine/UI metric to $0.00');
    assert.equal(cell.numFmt, '$#,##0.00');
  }
  assert.match(summary.getCell(11, 2).formula, /SUMIFS/);
  assert.equal(new Decimal(String(summary.getCell(11, 2).result)).toFixed(2), result.totals.quarterEndTierOpportunity);
  assert.match(summary.getCell(5, 2).formula, /K:K/, 'added rows remain included');
  assert.equal(summary.getCell(4, 2).result, result.lines.length);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0].state, 'frozen');
    assert.ok(sheet.columns.every((column) => column.width && column.width >= 12 && column.width <= 56));
  }
  const pdfBytes = await createDisputePdf(result, 'BENCHMARK-FIDELITY');
  assert.equal((await PDFDocument.load(pdfBytes)).getPageCount(), 1);
  const parser = new PDFParse({ data: pdfBytes });
  try {
    const text = (await parser.getText()).text;
    assert.match(text, /NET RECOVERY REQUESTED/);
    for (const value of [result.totals.unclaimedRecoveryFound, result.totals.rebateEarned, result.totals.supplierPaid, result.totals.quarterEndTierOpportunity]) assert.ok(text.includes(`$${value}`));
    for (const line of result.lines.filter((item) => new Decimal(item.recoveryFound).gt(0)).slice(0, 5)) assert.ok(text.includes(line.invoiceId ?? line.txnId));
    assert.match(text, /Clause|clause/);
  } finally { await parser.destroy(); }
  await assert.rejects(createDisputePdf({ ...result, supplierName: 'W'.repeat(3000) }), /section limit|capacity/);
  await mkdir('.artifacts', { recursive: true });
  await writeFile('.artifacts/benchmark-audit.xlsx', bytes);
  await writeFile('.artifacts/benchmark-dispute.pdf', pdfBytes);
  console.log('Export fidelity PASS: live formulas, exact detail/cache totals, four frozen tabs, parsed one-page claim, invoice/clause citations, explicit overflow rejection.');
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
