import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

const root = process.cwd();
const port = 37449;
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rebate-ledger-http-'));
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, REBATE_DATA_DIR: dataDir, SESSION_SECRET: 'automated-workflow-test-secret-not-for-deployment' },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch { /* wait for the local server to bind */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Next.js server did not become ready.');
}
async function status(pathname, cookie) {
  return fetch(`${base}${pathname}`, { headers: cookie ? { Cookie: cookie } : {} });
}

try {
  await waitForServer();
  for (const route of ['/', '/login', '/dashboard', '/dashboard/upload', '/dashboard/audits/demo-q3']) {
    const response = await status(route);
    assert.equal(response.status, 200, `${route} should return HTTP 200`);
  }

  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@rebateledger.com', password: 'Admin1234!' }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(adminCookie, 'admin session cookie should be set');

  const controllerLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'controller@acme-hvac.com', password: 'Demo1234!' }),
  });
  assert.equal(controllerLogin.status, 200);
  const controllerCookie = controllerLogin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(controllerCookie);
  assert.equal((await status('/api/audits', controllerCookie)).status, 403, 'intake queue must be admin-only');

  const sampleDir = path.join(root, 'data/benchmark/sample_set_1');
  const contract = readFileSync(path.join(sampleDir, 'carrier_hvac_2026_rebate_agreement.pdf'));
  const extractForm = new FormData();
  extractForm.set('pdf', new Blob([contract], { type: 'application/pdf' }), 'carrier_agreement.pdf');
  const extractResponse = await fetch(`${base}/api/extract`, { method: 'POST', body: extractForm });
  assert.equal(extractResponse.status, 200);
  const extracted = await extractResponse.json();
  assert.equal(extracted.rules.tiers.length, 2);
  assert.equal(extracted.rules.tiers[1].citation.pageNumber, 1, 'tier citation must refer to the agreement page');
  assert.equal(extracted.rules.tiers[1].citation.clauseId, '2', 'tier citation must refer to Clause 2');
  const invalidPdfForm = new FormData();
  invalidPdfForm.set('pdf', new Blob(['not a PDF']), 'broken.pdf');
  const invalidPdfResponse = await fetch(`${base}/api/extract`, { method: 'POST', body: invalidPdfForm });
  assert.equal(invalidPdfResponse.status, 422, 'invalid PDFs must return a recoverable extraction error');
  const invalidPdfBody = await invalidPdfResponse.json();
  assert.ok(invalidPdfBody.error && !invalidPdfBody.rules, 'extraction errors must never be represented as blank rules');

  const intakeForm = new FormData();
  intakeForm.set('name', 'Synthetic Reviewer');
  intakeForm.set('company', 'Benchmark HVAC');
  intakeForm.set('email', 'reviewer@example.test');
  intakeForm.set('supplier', 'Carrier HVAC');
  intakeForm.set('pdf', new Blob([contract], { type: 'application/pdf' }), 'agreement.pdf');
  const purchases = readFileSync(path.join(sampleDir, 'wholesaler_erp_purchases_q3.csv'));
  intakeForm.set('csv', new Blob([purchases], { type: 'text/csv' }), 'purchases.csv');
  const intakeResponse = await fetch(`${base}/api/intake`, { method: 'POST', body: intakeForm });
  assert.equal(intakeResponse.status, 201);
  const intake = await intakeResponse.json();
  const queueResponse = await status('/api/audits', adminCookie);
  assert.equal(queueResponse.status, 200);
  const queue = await queueResponse.json();
  assert.equal(queue.audits.length, 1);
  const persistedAgreement = await status(`/api/intakes/${intake.intake.id}/files/pdf`, adminCookie);
  const persistedPurchases = await status(`/api/intakes/${intake.intake.id}/files/csv`, adminCookie);
  assert.equal(persistedAgreement.status, 200);
  assert.equal(persistedPurchases.status, 200);
  assert.deepEqual(Buffer.from(await persistedAgreement.arrayBuffer()), contract, 'agreement role must persist and retrieve the agreement bytes');
  assert.deepEqual(Buffer.from(await persistedPurchases.arrayBuffer()), purchases, 'purchase role must persist and retrieve the CSV bytes');

  const draftForm = new FormData();
  draftForm.set('supplier', 'Carrier HVAC');
  draftForm.set('rules', JSON.stringify(extracted.rules));
  draftForm.set('columnMap', JSON.stringify({ txn_id: 'txn_id', date: 'date', vendor_name: 'vendor_name', sku: 'sku', qty: 'qty', extended_cost: 'extended_cost', txn_type: 'txn_type' }));
  draftForm.set('agreement', new Blob([contract], { type: 'application/pdf' }), 'carrier_agreement.pdf');
  const creditCsv = readFileSync(path.join(sampleDir, 'manufacturer_q3_credit_statement.csv'));
  draftForm.set('credits', new Blob([creditCsv], { type: 'text/csv' }), 'manufacturer-credit-statement.csv');
  draftForm.set('purchases', new Blob([purchases], { type: 'text/csv' }), 'purchases.csv');
  const invalidDraftForm = new FormData();
  invalidDraftForm.set('supplier', 'Carrier HVAC'); invalidDraftForm.set('rules', JSON.stringify({ schemaVersion: 1, source: 'fake.pdf', tiers: [], spaSkus: [], warnings: [] }));
  invalidDraftForm.set('columnMap', JSON.stringify({ txn_id: 'txn_id' }));
  invalidDraftForm.set('agreement', new Blob([contract], { type: 'application/pdf' }), 'carrier_agreement.pdf');
  invalidDraftForm.set('purchases', new Blob([purchases], { type: 'text/csv' }), 'purchases.csv');
  assert.equal((await fetch(`${base}/api/drafts`, { method: 'POST', headers: { Cookie: controllerCookie }, body: invalidDraftForm })).status, 422, 'invalid or unverified rules must block draft save/reconciliation');
  const draftResponse = await fetch(`${base}/api/drafts`, { method: 'POST', headers: { Cookie: controllerCookie }, body: draftForm });
  assert.equal(draftResponse.status, 201, await draftResponse.clone().text());
  const saved = await draftResponse.json();
  assert.equal(saved.draft.files.find(file => file.role === 'agreement').originalName, 'carrier_agreement.pdf');
  const freshSessionLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'controller@acme-hvac.com', password: 'Demo1234!' }) });
  const freshCookie = freshSessionLogin.headers.get('set-cookie')?.split(';')[0];
  const restoredDrafts = await status('/api/drafts', freshCookie);
  assert.equal(restoredDrafts.status, 200, 'a new authenticated browser session must read persisted drafts');
  const restored = await restoredDrafts.json();
  assert.equal(restored.drafts[0].id, saved.draft.id);
  const restoredAgreement = await status(`/api/drafts/${saved.draft.id}/files/agreement`, freshCookie);
  const restoredCredit = await status(`/api/drafts/${saved.draft.id}/files/credits`, freshCookie);
  assert.equal(restoredAgreement.status, 200);
  assert.equal(restoredCredit.status, 200);
  assert.deepEqual(Buffer.from(await restoredAgreement.arrayBuffer()), contract, 'explicit agreement role must retrieve the agreement, regardless of credit selection order');
  assert.deepEqual(Buffer.from(await restoredCredit.arrayBuffer()), creditCsv);
  const runAudit = await fetch(`${base}/api/drafts/${saved.draft.id}/reconcile`, { method: 'POST', headers: { Cookie: freshCookie } });
  assert.equal(runAudit.status, 200, await runAudit.clone().text());
  const draftAudit = await runAudit.json();
  assert.equal(draftAudit.result.totals.netEligibleSpend, '399800.00');
  assert.equal(draftAudit.result.totals.rebateEarned, '7996.00');
  assert.equal(draftAudit.result.totals.supplierPaid, '7246.00');
  assert.equal(draftAudit.result.totals.unclaimedRecoveryFound, '750.00');
  assert.equal(draftAudit.result.totals.quarterEndTierOpportunity, '4004.00');
  assert.equal((await status(`/api/audits/${saved.draft.id}`, freshCookie)).status, 200, 'saved reconciliation must be available as an audit after a fresh session');
  assert.equal((await status(`/api/audits/${saved.draft.id}/exports/xlsx`, freshCookie)).status, 200);
  assert.equal((await status(`/api/audits/${saved.draft.id}/exports/dispute`, freshCookie)).status, 200);

  const auditResponse = await status('/api/audits/demo-q3', controllerCookie);
  assert.equal(auditResponse.status, 200);
  const audit = await auditResponse.json();
  assert.equal(audit.result.totals.netEligibleSpend, '399800.00');
  assert.equal(audit.result.totals.rebateEarned, '7996.00');
  assert.equal(audit.result.totals.supplierPaid, '7246.00');
  assert.equal(audit.result.totals.unclaimedRecoveryFound, '750.00');
  assert.equal(audit.result.totals.quarterEndTierOpportunity, '4004.00');
  const workbookResponse = await status('/api/audits/demo-q3/exports/xlsx', controllerCookie);
  assert.equal(workbookResponse.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await workbookResponse.arrayBuffer()));
  assert.equal(workbook.worksheets.length, 4);
  const pdfResponse = await status('/api/audits/demo-q3/exports/dispute', controllerCookie);
  assert.equal(pdfResponse.status, 200);
  assert.equal((await PDFDocument.load(await pdfResponse.arrayBuffer())).getPageCount(), 1);

  console.log('HTTP workflow checks passed: public routes, auth/role checks, cited PDF extraction and error path, explicit source roles, persistent source files after a fresh session, server-bound rule verification, uploaded-file reconciliation to exact benchmark totals, and both exports.');
} finally {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
  rmSync(dataDir, { recursive: true, force: true });
}
