import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

const root = process.cwd();
const port = 37449;
const base = `http://127.0.0.1:${port}`;
const adminEmail = 'admin@smoke.example';
const demoEmail = 'controller@smoke.example';
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rebate-ledger-http-'));
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, SESSION_SECRET:'smoke-only-secret-at-least-32-characters', DEMO_EMAIL:demoEmail, DEMO_PASSWORD:'Demo1234!', ADMIN_EMAIL:adminEmail, ADMIN_PASSWORD:'Admin1234!', DEMO_LOGIN_ENABLED:'true', REBATE_DATA_DIR: dataDir },
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
    if (route === '/login') {
      const html = await response.text();
      assert.match(html, /<form[^>]+action="\/api\/auth\/login"[^>]+method="post"/i, 'login form must submit with POST before React hydrates');
      assert.match(html, /Continue as demo controller/i, 'enabled one-click controller demo must be visible');
    }
  }

  const demoOpenA = await fetch(`${base}/api/auth/demo`, { method:'POST' });
  const demoOpenBodyA = await demoOpenA.json();
  assert.equal(demoOpenA.status, 200, 'demo login should open a controller session when enabled');
  assert.equal(demoOpenBodyA.role, 'controller', 'demo login must never grant admin role');
  assert.match(demoOpenBodyA.email, /^demo-[0-9a-f-]+@anonymous\.invalid$/i, 'demo session must use a random isolated owner identity');
  const demoCookieA = demoOpenA.headers.get('set-cookie')?.split(';')[0];
  assert.ok(demoCookieA, 'demo login should issue an HttpOnly session cookie');
  const demoOpenB = await fetch(`${base}/api/auth/demo`, { method:'POST' });
  const demoOpenBodyB = await demoOpenB.json();
  assert.equal(demoOpenB.status, 200);
  assert.notEqual(demoOpenBodyA.email, demoOpenBodyB.email, 'each demo session must have a unique audit owner');
  assert.equal((await status('/api/audits', demoCookieA)).status, 403, 'one-click demo controller cannot access admin queue');
  assert.equal((await status('/api/audits/mine', demoCookieA)).status, 200, 'one-click demo controller can access only its own audit list');
  const crossOriginDemo = await fetch(`${base}/api/auth/demo`, { method:'POST', headers:{Origin:'https://attacker.example'} });
  assert.equal(crossOriginDemo.status, 403, 'cross-origin demo session creation must be rejected');

  const nativeLogin = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({email:demoEmail,password:'Demo1234!'}), redirect:'manual' });
  assert.equal(nativeLogin.status, 303, 'native pre-hydration login must redirect after POST');
  assert.equal(new URL(nativeLogin.headers.get('location'), base).pathname, '/dashboard');
  assert.equal(new URL(nativeLogin.headers.get('location'), base).search, '', 'login credentials must never be reflected in a redirect URL');
  assert.ok(nativeLogin.headers.get('set-cookie')?.includes('rebate_session='));

  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: 'Admin1234!' }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(adminCookie, 'admin session cookie should be set');

  const controllerLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: demoEmail, password: 'Demo1234!' }),
  });
  assert.equal(controllerLogin.status, 200);
  const controllerCookie = controllerLogin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(controllerCookie);
  const sameOriginLogin = await fetch(`${base}/api/auth/login`, {method:'POST',headers:{'content-type':'application/json',Origin:base},body:JSON.stringify({email:demoEmail,password:'Demo1234!'})});
  assert.equal(sameOriginLogin.status, 200, 'same-origin browser login should not be rejected behind the Next server');
  assert.equal((await fetch(`${base}/api/auth/logout`, {method:'POST',headers:{Origin:'https://attacker.example',Cookie:controllerCookie}})).status, 403, 'cross-origin logout mutation should be rejected');
  assert.equal((await status('/api/audits', controllerCookie)).status, 403, 'intake queue must be admin-only');
  assert.equal((await status('/api/audits/mine')).status, 401, 'audit index must require a session');

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

  const reconciliation = new FormData();
  reconciliation.set('supplier', 'Synthetic HVAC');
  reconciliation.set('rules', JSON.stringify({ supplierName:'Synthetic HVAC', programName:'One-line test', verification:{status:'verified',verifiedBy:'Smoke reviewer',ruleVersion:'test-v1'}, opportunityMethod:'rate-difference-at-target', nearMissThreshold:'150', tiers:[{minSpend:'0',ratePercent:'2',mode:'retroactive',citation:'Clause 2'},{minSpend:'200',ratePercent:'4',mode:'retroactive',citation:'Clause 2'}], eligibleSkus:['K-1'], clauseCitations:['Clause 2'] }));
  reconciliation.set('mapping', JSON.stringify({ date:'Date', vendor_name:'Manufacturer', sku:'Part_No', qty:'Qty', extended_cost:'Ext_Amt', customer_name:'Cust_ID', txn_type:'Txn Type', invoice_id:'Invoice' }));
  reconciliation.set('payments', JSON.stringify([{ scope:'program', amount:'1.00', reference:'synthetic credit statement' }]));
  reconciliation.set('csv', new Blob(['Date,Manufacturer,Part_No,Qty,Ext_Amt,Cust_ID,Txn Type,Invoice\n2026-07-01,Synthetic HVAC,K-1,1,100.00,ACME,PURCHASE,INV-SYN-01'], {type:'text/csv'}), 'synthetic.csv');
  const calculated = await fetch(`${base}/api/reconcile`, {method:'POST',body:reconciliation,headers:{Cookie:controllerCookie}});
  assert.equal(calculated.status, 200);
  const created = await calculated.json();
  assert.equal(created.result.totals.rebateEarned, '2.00');
  assert.equal(created.result.totals.supplierPaid, '1.00');
  assert.equal(created.result.totals.unclaimedRecoveryFound, '1.00');
  assert.equal(created.result.totals.quarterEndTierOpportunity, '4.00');
  assert.equal(created.result.lines[0].invoiceId, 'INV-SYN-01');
  assert.equal(created.result.lines[0].recoveryFound, '0.00', 'aggregate payment totals must not generate invoice recovery claims');
  assert.equal(created.result.totals.programStatementProvided, true);
  const missingStatement = new FormData();
  for (const [key,value] of reconciliation.entries()) missingStatement.set(key,value);
  missingStatement.set('payments', '[]');
  assert.equal((await fetch(`${base}/api/reconcile`, {method:'POST',body:missingStatement,headers:{Cookie:controllerCookie}})).status, 422, 'aggregate statement total is required, including explicit zero');
  const stored = await status(`/api/audits/${created.auditId}`, controllerCookie);
  const storedBody = await stored.json();
  const storedAdmin = await status(`/api/audits/${created.auditId}`, adminCookie);
  assert.equal(storedAdmin.status, 200, JSON.stringify({controller:storedBody,admin:await storedAdmin.json()}));
  assert.equal(stored.status, 200, JSON.stringify(storedBody));
  assert.equal(storedBody.result.totals.unclaimedRecoveryFound, '1.00');
  const myAuditsResponse = await status('/api/audits/mine', controllerCookie);
  assert.equal(myAuditsResponse.status, 200);
  assert.ok((await myAuditsResponse.json()).audits.some(item => item.id === created.auditId));
  const calculatedWorkbook = await status(`/api/audits/${created.auditId}/exports/xlsx`, controllerCookie);
  assert.equal(calculatedWorkbook.status, 200);
  const actualWorkbook = new ExcelJS.Workbook();
  await actualWorkbook.xlsx.load(Buffer.from(await calculatedWorkbook.arrayBuffer()));
  assert.equal(actualWorkbook.worksheets.length, 4);
  const calculatedPdf = await status(`/api/audits/${created.auditId}/exports/dispute`, controllerCookie);
  assert.equal(calculatedPdf.status, 200);
  assert.equal((await PDFDocument.load(await calculatedPdf.arrayBuffer())).getPageCount(), 1);
  assert.equal((await fetch(`${base}/api/audits/${created.auditId}`, {method:'DELETE'})).status, 401, 'unauthenticated users cannot delete audits');
  assert.equal((await fetch(`${base}/api/audits/demo-q3`, {method:'DELETE',headers:{Cookie:controllerCookie}})).status, 404, 'seeded demo audit cannot be deleted');
  const auditRecordPath = path.join(dataDir, 'audits', `${created.auditId}.json`);
  const originalRecord = readFileSync(auditRecordPath, 'utf8');
  const changedOwner = JSON.parse(originalRecord); changedOwner.ownerEmail = 'another-controller@example.test'; writeFileSync(auditRecordPath, JSON.stringify(changedOwner));
  assert.equal((await fetch(`${base}/api/audits/${created.auditId}`, {method:'DELETE',headers:{Cookie:controllerCookie}})).status, 404, 'controllers cannot delete another owner’s audit');
  writeFileSync(auditRecordPath, originalRecord);
  assert.equal((await fetch(`${base}/api/audits/${created.auditId}`, {method:'DELETE',headers:{Cookie:controllerCookie}})).status, 200, 'audit owner can remove an audit');
  assert.equal(existsSync(path.join(dataDir, 'uploads', created.auditId)), false, 'audit source uploads are deleted with the record');
  assert.equal((await status(`/api/audits/${created.auditId}`, controllerCookie)).status, 404, 'deleted audit is no longer readable');
  const unverified = new FormData();
  for (const [key,value] of reconciliation.entries()) unverified.set(key,value);
  unverified.set('rules', JSON.stringify({ supplierName:'Synthetic HVAC', programName:'Unverified', verification:{status:'unverified',verifiedBy:'',ruleVersion:'test-v1'}, tiers:[{minSpend:'0',ratePercent:'2',mode:'retroactive',citation:'Clause 2'}] }));
  assert.equal((await fetch(`${base}/api/reconcile`, {method:'POST',body:unverified,headers:{Cookie:controllerCookie}})).status, 422);

  console.log('HTTP smoke checks passed: progressive POST login, auth/role checks, owner-scoped audit listing/deletion, source-file cleanup, PDF extraction, intake storage, deterministic upload reconciliation, unverified-rule blocking, and both exports.');
} finally {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
  rmSync(dataDir, { recursive: true, force: true });
}
