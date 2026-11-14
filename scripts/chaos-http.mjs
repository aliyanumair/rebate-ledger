import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const root = process.cwd();
const external = process.env.TEST_BASE_URL;
const port = Number(process.env.TEST_PORT || 37451);
const base = external || `http://127.0.0.1:${port}`;
const temporary = mkdtempSync(path.join(os.tmpdir(), 'rebate-chaos-'));
const controllerPassword = process.env.CONTROLLER_PASSWORD || randomBytes(18).toString('base64url');
const adminPassword = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
if (external && (!process.env.CONTROLLER_PASSWORD || !process.env.ADMIN_PASSWORD)) throw new Error('Live chaos QA requires explicitly supplied test account passwords.');
let server;
const findings = [];
const outcomes = [];
const logs = [];
const childEnv = { ...process.env, REBATE_DATA_DIR: temporary, SESSION_SECRET: randomBytes(48).toString('hex'), CONTROLLER_PASSWORD: controllerPassword, ADMIN_PASSWORD: adminPassword };
function launch() {
  server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {cwd: root, env: childEnv, stdio:['ignore','pipe','pipe']});
  server.stdout.on('data', chunk => logs.push(String(chunk)));
  server.stderr.on('data', chunk => logs.push(String(chunk)));
}
async function ready() {
  for (let attempt=0; attempt<60; attempt++) {
    if (server?.exitCode != null) throw new Error('Production server exited before QA.');
    try {if ((await fetch(base, {signal:AbortSignal.timeout(3000)})).ok) return;} catch { /* wait for bind */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Production server readiness timed out.');
}
async function check(name, run) {
  try { await run(); outcomes.push({name, status:'PASS'}); console.log(`PASS ${name}`); }
  catch(error) {const message=error instanceof Error?error.message:String(error);findings.push({severity:'high',name,message});outcomes.push({name,status:'FAIL',message});console.error(`FAIL ${name}: ${message}`);}
}
async function request(route, options={}) {return fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(30000),...options});}
function headers(cookie) {return cookie?{Cookie:cookie}:{};}
async function login(email,password) {
  const response=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(response.status,200, 'Test account login must succeed');
  const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);return cookie;
}
async function rejectUpload(data, cookie) {
  const response=await request('/api/extract',{method:'POST',headers:headers(cookie),body:data});
  assert.ok([400,413,422].includes(response.status),`Expected readable 4xx error, got ${response.status}`);
  const json=await response.json();assert.equal(typeof json.error,'string');assert.ok(json.error.length>0);
}
function upload(bytes,name='agreement.pdf') {const form=new FormData();form.set('pdf',new Blob([bytes],{type:'application/pdf'}),name);return form;}
function intake(pdf,csv) {
  const form=new FormData();
  for(const [key,value] of Object.entries({name:'Adversarial Test',company:'Synthetic QA Only',email:'qa@example.test',supplier:'Synthetic Supplier'})) form.set(key,value);
  form.set('pdf',new Blob([pdf],{type:'application/pdf'}),'agreement.pdf');form.set('csv',new Blob([csv],{type:'text/csv'}),'purchases.csv');return form;
}
async function rejectIntake(form) {
  const response=await request('/api/intake',{method:'POST',body:form});
  assert.ok([400,413,422].includes(response.status),`Malformed intake must not enter queue; got ${response.status}`);
  assert.equal(typeof (await response.json()).error,'string');
}
async function stop() {
  if(server?.exitCode===null) {const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited;}
}
try {
  if(!external) launch();
  await ready();
  for (const route of ['/dashboard','/dashboard/upload','/dashboard/audits/demo-q3','/admin']) {
    await check(`Anonymous route ${route} redirects to sign-in`,async()=>{const r=await request(route);assert.ok([302,303,307,308].includes(r.status),`Unexpected ${r.status}`);assert.ok(r.headers.get('location')?.includes('/login'));});
  }
  await check('Malformed sign-in JSON rejected cleanly',async()=>{const r=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'});assert.equal(r.status,400);assert.equal(typeof(await r.json()).error,'string');});
  await check('Wrong sign-in password rejected',async()=>{const r=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@rebateledger.com',password:'incorrect-password'})});assert.equal(r.status,401);});
  await check('Cross-origin mutation rejected',async()=>{const r=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json',Origin:'https://unrelated.example'},body:'{}'});assert.equal(r.status,403);});
  const controller=await login('controller@acme-hvac.com',controllerPassword);
  const admin=await login('admin@rebateledger.com',adminPassword);
  await check('Controller forbidden from admin intake API',async()=>assert.equal((await request('/api/audits',{headers:headers(controller)})).status,403));
  await check('Controller cannot retrieve intake source files',async()=>assert.equal((await request('/api/intakes/00000000-0000-0000-0000-000000000000/files/pdf',{headers:headers(controller)})).status,403));
  await check('Forged cookie cannot access audit API',async()=>assert.equal((await request('/api/audits/demo-q3',{headers:{Cookie:'rebate_session=forged.signature'}})).status,401));
  await check('Anonymous extract API rejected',async()=>assert.equal((await request('/api/extract',{method:'POST',body:upload('invalid')})).status,401));
  await check('Empty PDF uses controlled validation error',()=>rejectUpload(upload(''),controller));
  await check('Corrupt PDF uses controlled validation error',()=>rejectUpload(upload('%PDF-1.7\ncorrupt-no-cross-reference'),controller));
  await check('Wrong extraction file extension rejected',()=>rejectUpload(upload('SKU,Cost\nA,10','not-a-pdf.csv'),controller));
  const blank=await PDFDocument.create();blank.addPage();const scannedLike=await blank.save();
  await check('Unreadable image-only/blank PDF cannot invent rules',()=>rejectUpload(upload(scannedLike),controller));
  const contract=readFileSync(path.join(root,'data/benchmark/sample_set_1/carrier_hvac_2026_rebate_agreement.pdf'));
  const csv=readFileSync(path.join(root,'data/benchmark/sample_set_1/wholesaler_erp_purchases_q3.csv'));
  await check('Empty public-intake PDF rejected',()=>rejectIntake(intake('',csv)));
  await check('Corrupt public-intake PDF rejected',()=>rejectIntake(intake('not a PDF',csv)));
  await check('Empty public-intake CSV rejected',()=>rejectIntake(intake(contract,'')));
  await check('Malformed unclosed CSV quote rejected',()=>rejectIntake(intake(contract,'SKU,Date,Qty,Extended Cost\n"unclosed,2026-07-01,1,10')));
  await check('Duplicate public-intake CSV headers rejected',()=>rejectIntake(intake(contract,'SKU,SKU,Date\nA,A,2026-07-01')));
  await check('Malformed multipart upload rejected cleanly',async()=>{const r=await request('/api/intake',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=missing'},body:'broken'});assert.ok([400,422].includes(r.status),`Unexpected ${r.status}`);});
  if(!external) {
    await check('Valid intake persists across production-server restart',async()=>{
      const r=await request('/api/intake',{method:'POST',body:intake(contract,csv)});assert.equal(r.status,201);
      const created=await r.json();const id=created.intake.id;assert.ok(id);
      const form=new FormData();
      form.set('supplier','Synthetic HVAC');
      form.set('rules',JSON.stringify({supplierName:'Synthetic HVAC',programName:'Restart persistence test',verification:{status:'verified',verifiedBy:'QA reviewer',ruleVersion:'restart-v1'},tiers:[{minSpend:'0',ratePercent:'2',mode:'retroactive',citation:'Clause 2'}],eligibleSkus:['K-1'],clauseCitations:['Clause 2']}));
      form.set('mapping',JSON.stringify({date:'Date',sku:'SKU',qty:'Qty',extended_cost:'Extended Cost',txn_type:'Txn Type',invoice_id:'Invoice'}));
      form.set('payments',JSON.stringify([{scope:'program',amount:'1.00'}]));
      form.set('csv',new Blob(['Date,SKU,Qty,Extended Cost,Txn Type,Invoice\n2026-07-01,K-1,1,100.00,PURCHASE,INV-RESTART-1'],{type:'text/csv'}),'audit.csv');
      form.set('contract',new Blob([contract],{type:'application/pdf'}),'agreement.pdf');
      const calculated=await request('/api/reconcile',{method:'POST',headers:headers(controller),body:form});assert.equal(calculated.status,200);
      const audit=await calculated.json();assert.equal(audit.result.totals.unclaimedRecoveryFound,'1.00');
      await stop();launch();await ready();const freshAdmin=await login('admin@rebateledger.com',adminPassword);
      const queue=await request('/api/audits',{headers:headers(freshAdmin)});assert.equal(queue.status,200);assert.ok((await queue.json()).audits.some(item=>item.id===id));
      const file=await request(`/api/intakes/${id}/files/pdf`,{headers:headers(freshAdmin)});assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),contract);
      const persisted=await request(`/api/audits/${audit.auditId}`,{headers:headers(freshAdmin)});assert.equal(persisted.status,200);assert.equal((await persisted.json()).result.totals.unclaimedRecoveryFound,'1.00');
      const workbook=await request(`/api/audits/${audit.auditId}/exports/xlsx`,{headers:headers(freshAdmin)});assert.equal(workbook.status,200);
      const pdf=await request(`/api/audits/${audit.auditId}/exports/dispute`,{headers:headers(freshAdmin)});assert.equal(pdf.status,200);
    });
  }
  await check('Admin queue remains reachable after malformed inputs',async()=>{const current=external?admin:await login('admin@rebateledger.com',adminPassword);assert.equal((await request('/api/audits',{headers:headers(current)})).status,200);});
} finally {
  await stop();
  const output=path.join(root,'artifacts');mkdirSync(output,{recursive:true});
  writeFileSync(path.join(output,'chaos-http-results.json'),JSON.stringify({base,generatedAt:new Date().toISOString(),outcomes,findings},null,2));
  if(!external) rmSync(temporary,{recursive:true,force:true});
}
if(findings.length) {console.error(`${findings.length} high-priority adversarial checks failed.`);process.exitCode=1;}
else console.log(`All ${outcomes.length} adversarial HTTP checks passed.`);
