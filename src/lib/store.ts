import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@netlify/blobs';
import type { ReconciliationResult } from './reconciliation';
export type IntakeRecord = { id:string;createdAt:string;company:string;name:string;email:string;supplier:string;pdfName:string;csvName:string;status:'queued'|'reviewing'|'complete' };
export type AuditRecord = { id:string;createdAt:string;ownerEmail:string;supplierName:string;csvName:string;contractName:string|null;result:ReconciliationResult };
export function dataDir() { return process.env.REBATE_DATA_DIR || path.join(process.cwd(),'data','runtime'); }
function cloud() { return process.env.NETLIFY === 'true' || Boolean(process.env.NETLIFY_BLOBS_CONTEXT); }
function blobs() { return getStore({name:'rebate-intakes',consistency:'strong'}); }
export async function listIntakes():Promise<IntakeRecord[]> {
  if(cloud()) { const store=blobs(); const {blobs:items}=await store.list({prefix:'records/'}); const values=await Promise.all(items.map(x=>store.get(x.key,{type:'json'}) as Promise<IntakeRecord|null>)); return values.filter((x):x is IntakeRecord=>Boolean(x)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  const dir=path.join(dataDir(),'records');
  const {readdir}=await import('node:fs/promises');
  try { const names=await readdir(dir); return (await Promise.all(names.filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await readFile(path.join(dir,n),'utf8')) as IntakeRecord))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT') return []; throw e; }
}
export async function getIntake(id:string):Promise<IntakeRecord|null> {
  if(cloud()) return blobs().get(`records/${id}`,{type:'json'});
  try { return JSON.parse(await readFile(path.join(dataDir(),'records',`${id}.json`),'utf8')); }
  catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT') return null; throw e; }
}
export async function addIntake(item:IntakeRecord) {
  if(cloud()) { await blobs().setJSON(`records/${item.id}`,item); return item; }
  const dir=path.join(dataDir(),'records'); await mkdir(dir,{recursive:true});
  const temp=path.join(dir,`${item.id}.tmp`); await writeFile(temp,JSON.stringify(item),'utf8'); await rename(temp,path.join(dir,`${item.id}.json`)); return item;
}
export async function saveIntakeFiles(id:string,pdf:Uint8Array,csv:Uint8Array) {
  if(cloud()) { const s=blobs(); await Promise.all([s.set(`uploads/${id}/pdf`,new Uint8Array(pdf).buffer as ArrayBuffer),s.set(`uploads/${id}/csv`,new Uint8Array(csv).buffer as ArrayBuffer)]); return; }
  const dir=path.join(dataDir(),'uploads',id); await mkdir(dir,{recursive:true}); await Promise.all([writeFile(path.join(dir,'supplier.pdf'),pdf),writeFile(path.join(dir,'purchases.csv'),csv)]);
}
export async function readIntakeFile(id:string,kind:string):Promise<Uint8Array> {
  if(cloud()) { const body=await blobs().get(`uploads/${id}/${kind}`,{type:'arrayBuffer'}); if(!body) throw new Error('File unavailable'); return new Uint8Array(body); }
  return readFile(path.join(dataDir(),'uploads',id,kind==='pdf'?'supplier.pdf':'purchases.csv'));
}
export async function saveAudit(record:AuditRecord):Promise<void> {
  if(cloud()) { await blobs().setJSON(`audits/${record.id}`,record); return; }
  const dir=path.join(dataDir(),'audits'); await mkdir(dir,{recursive:true});
  const temp=path.join(dir,`${record.id}.tmp`); await writeFile(temp,JSON.stringify(record),'utf8'); await rename(temp,path.join(dir,`${record.id}.json`));
}
export async function getAudit(id:string):Promise<AuditRecord|null> {
  if(cloud()) return blobs().get(`audits/${id}`,{type:'json'});
  try { return JSON.parse(await readFile(path.join(dataDir(),'audits',`${id}.json`),'utf8')) as AuditRecord; }
  catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT') return null; throw e; }
}
export async function listAudits(ownerEmail?:string):Promise<AuditRecord[]> {
  let records:AuditRecord[];
  if(cloud()) {
    const store=blobs(); const {blobs:items}=await store.list({prefix:'audits/'});
    const values=await Promise.all(items.map(item=>store.get(item.key,{type:'json'}) as Promise<AuditRecord|null>));
    records=values.filter((value):value is AuditRecord=>Boolean(value));
  } else {
    try {
      const names=await readdir(path.join(dataDir(),'audits'));
      records=await Promise.all(names.filter(name=>name.endsWith('.json')).map(async name=>JSON.parse(await readFile(path.join(dataDir(),'audits',name),'utf8')) as AuditRecord));
    } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') records=[]; else throw error; }
  }
  return records.filter(record=>!ownerEmail || record.ownerEmail.toLowerCase()===ownerEmail.toLowerCase()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function deleteAudit(id:string):Promise<void> {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid audit ID.');
  if(cloud()) {
    const store=blobs();
    await Promise.all([store.delete(`uploads/${id}/pdf`),store.delete(`uploads/${id}/csv`)]);
    await store.delete(`audits/${id}`);
    return;
  }
  await rm(path.join(dataDir(),'uploads',id),{recursive:true,force:true});
  await rm(path.join(dataDir(),'audits',`${id}.json`),{force:true});
}
