import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@netlify/blobs';
export type IntakeRecord = { id:string;createdAt:string;company:string;name:string;email:string;supplier:string;pdfName:string;csvName:string;status:'queued'|'reviewing'|'complete' };
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
