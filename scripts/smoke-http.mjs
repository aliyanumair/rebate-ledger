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
  env: { ...process.env, SESSION_SECRET:'smoke-only-secret-at-least-32-characters', CONTROLLER_PASSWORD:'Demo1234!', ADMIN_PASSWORD:'Admin1234!', REBATE_DATA_DIR: dataDir },
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
  for (const route of ['/', '/login']) {
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
  const extractResponse = await fetch(`${base}/api/extract`, { method: 'POST', body: extractForm, headers:{Cookie:controllerCookie} });
  assert.equal(extractResponse.status, 200);
  const extracted = await extractResponse.json();
  assert.equal(extracted.rules.tiers.length, 3);

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
  assert.equal((await status(`/api/intakes/${intake.intake.id}/files/pdf`, adminCookie)).status, 200);
  assert.equal((await status(`/api/intakes/${intake.intake.id}/files/csv`, adminCookie)).status, 200);

  const auditResponse = await status('/api/audits/demo-q3', controllerCookie);
  assert.equal(auditResponse.status, 200);
  const audit = await auditResponse.json();
  assert.equal(audit.result.totals.unclaimedRecoveryFound, '750.00');
  const workbookResponse = await status('/api/audits/demo-q3/exports/xlsx', controllerCookie);
  assert.equal(workbookResponse.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await workbookResponse.arrayBuffer()));
  assert.equal(workbook.worksheets.length, 4);
  const pdfResponse = await status('/api/audits/demo-q3/exports/dispute', controllerCookie);
  assert.equal(pdfResponse.status, 200);
  assert.equal((await PDFDocument.load(await pdfResponse.arrayBuffer())).getPageCount(), 1);

  console.log('HTTP smoke checks passed: public routes, auth/role checks, PDF extraction, intake storage/admin retrieval, seeded audit, and both exports.');
} finally {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
  rmSync(dataDir, { recursive: true, force: true });
}
