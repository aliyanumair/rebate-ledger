import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { addIntake, saveIntakeFiles } from '@/lib/store';
import { guardRequest } from '@/lib/request-guard';
import { parseCsvTable } from '@/lib/csv';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  const rejected=guardRequest(request,10); if(rejected) return rejected;
  const form=await request.formData().catch(()=>null);
  if(!form) return NextResponse.json({error:'Malformed upload.'},{status:400});
  const fields=Object.fromEntries(['company','name','email','supplier'].map(k=>[k,String(form.get(k)||'').trim()]));
  if(Object.values(fields).some(x=>!x || x.length>254) || !/^\S+@\S+\.\S+$/.test(fields.email)) return NextResponse.json({error:'Complete company, name, valid email, and supplier (maximum 254 characters each).'},{status:400});
  const pdf=form.get('pdf'),csv=form.get('csv');
  if(!(pdf instanceof File)||!(csv instanceof File)||!pdf.name.toLowerCase().endsWith('.pdf')||!csv.name.toLowerCase().endsWith('.csv')) return NextResponse.json({error:'Attach a supplier PDF and ERP CSV.'},{status:400});
  if(!pdf.size||!csv.size) return NextResponse.json({error:'Files must not be empty.'},{status:422});
  if(pdf.size>10*1024*1024||csv.size>10*1024*1024) return NextResponse.json({error:'Each file must be 10 MB or smaller.'},{status:413});
  const pdfBytes=new Uint8Array(await pdf.arrayBuffer()),csvBytes=new Uint8Array(await csv.arrayBuffer());
  // A scanned PDF is accepted for human review; corrupt/non-PDF uploads are not.
  const {PDFDocument}=await import('pdf-lib');
  try { const parsed=await PDFDocument.load(pdfBytes); if(!parsed.getPageCount()) throw new Error('No pages'); } catch { return NextResponse.json({error:'The PDF is corrupt or encrypted. Send a readable PDF or request manual rule entry.'},{status:422}); }
  const csvText=new TextDecoder('utf-8',{fatal:false}).decode(csvBytes);
  try {
    if (csvText.includes('\0')) throw new Error('CSV contains invalid binary data.');
    parseCsvTable(csvText);
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : 'CSV needs a valid unique header row and at least one transaction.'},{status:422});
  }
  const id=randomUUID();
  try {
    await saveIntakeFiles(id,pdfBytes,csvBytes);
    await addIntake({id,createdAt:new Date().toISOString(),...fields,company:fields.company,name:fields.name,email:fields.email,supplier:fields.supplier,pdfName:pdf.name,csvName:csv.name,status:'queued'});
    return NextResponse.json({ok:true,intake:{id,status:'queued'}},{status:201});
  } catch { return NextResponse.json({error:'Durable intake storage is unavailable. Your submission was not confirmed; please retry later.'},{status:503}); }
}
