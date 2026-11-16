import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { PDFDocument } from 'pdf-lib';
import PDFParser from 'pdf2json';
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
  assert.equal(workbook.creator, 'MarginsRecovery');
  assert.equal(workbook.title, `MarginsRecovery | ${result.programName} Audit Workbook`);
  const summary = workbook.getWorksheet('Executive Summary')!;
  const audit = workbook.getWorksheet('Full Transaction Audit Trail')!;
  const totals = [result.totals.grossSpend, result.totals.netEligibleSpend, result.totals.rebateEarned, result.totals.spaEarned, result.totals.supplierPaid, result.totals.unclaimedRecoveryFound];
  for (let i = 0; i < totals.length; i += 1) {
    const cell = summary.getCell(5 + i, 2);
    if (i < 4) assert.match(cell.formula, /^ROUND\(SUM\(/);
    if (i === 4) assert.match(cell.formula, /SUMIFS/);
    if (i === 5) assert.match(cell.formula, /MAX\(B7\+B8-B9,0\)/);
    assert.equal(new Decimal(String(cell.result)).toFixed(2), totals[i]);
    let sum = new Decimal(0);
    audit.getColumn(11 + i).eachCell((value, row) => { if (row > 1) sum = sum.plus(String(value.value)); });
    if (i < 4) assert.equal(sum.toFixed(2), totals[i], 'transaction detail must equal engine/UI metric to $0.00');
    if (i === 4) assert.equal(sum.plus(result.totals.unallocatedProgramPayment).toFixed(2), totals[i], 'supplier paid equals direct detail plus unallocated statement payments');
    if (i === 5) assert.equal(result.lines.reduce((total, line) => total.plus(line.recoveryFound), new Decimal(0)).toFixed(2), '0.00', 'program-scope totals must not create invoice-level recovery rows');
    assert.equal(cell.numFmt, '$#,##0.00');
  }
  assert.match(summary.getCell(11, 2).formula, /SUMIFS/);
  assert.equal(new Decimal(String(summary.getCell(11, 2).result)).toFixed(2), result.totals.quarterEndTierOpportunity);
  assert.match(summary.getCell(5, 2).formula, /K:K/, 'added rows remain included');
  assert.equal(summary.getCell(4, 2).result, result.lines.length);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.headerFooter.oddHeader, '&BMarginsRecovery');
    assert.ok(sheet.columns.every((column) => column.width && column.width >= 12 && column.width <= 56));
  }
  const pdfBytes = await createDisputePdf(result, 'BENCHMARK-FIDELITY');
  const disputeDocument = await PDFDocument.load(pdfBytes);
  assert.equal(disputeDocument.getPageCount(), 1);
  assert.equal(disputeDocument.getTitle(), `MarginsRecovery Rebate Claim - ${result.supplierName}`);
  assert.equal(disputeDocument.getAuthor(), 'MarginsRecovery');
  const parser = new PDFParser(null, true, '');
  const text = await new Promise<string>((resolve, reject) => {
    parser.on('pdfParser_dataError', (error) => reject((error as { parserError?: Error }).parserError ?? error));
    parser.on('pdfParser_dataReady', (data) => resolve(data.Pages.flatMap(page => page.Texts.flatMap(item => item.R.map(run => { try { return decodeURIComponent(run.T); } catch { return run.T; } }))).join(' ')));
    parser.parseBuffer(pdfBytes);
  }).finally(() => parser.destroy());
  assert.match(text, /NET RECOVERY REQUESTED/);
  assert.match(text, /MarginsRecovery/);
  for (const value of [result.totals.unclaimedRecoveryFound, result.totals.rebateEarned, result.totals.supplierPaid, result.totals.quarterEndTierOpportunity]) assert.ok(text.includes(`$${value}`));
  assert.match(text, /Aggregate statement reconciliation only/);
  assert.match(text, /not allocated to individual invoices/);
  assert.match(text, /invoice-specific paid amounts or affected invoice IDs are asserted/);
  assert.match(text, /CM-2607-118/);
  assert.match(text, /Clause|clause/);
  await assert.rejects(createDisputePdf({ ...result, supplierName: 'W'.repeat(3000) }), /section limit|capacity/);
  await mkdir('.artifacts', { recursive: true });
  await writeFile('.artifacts/benchmark-audit.xlsx', bytes);
  await writeFile('.artifacts/benchmark-dispute.pdf', pdfBytes);
  console.log('Export fidelity PASS: live formulas, exact detail/cache totals, four frozen tabs, parsed one-page aggregate claim with statement/clause references, explicit overflow rejection.');
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
