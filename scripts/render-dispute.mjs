import { PDFParse } from 'pdf-parse';
import { readFile, writeFile } from 'node:fs/promises';
const parser = new PDFParse({data: await readFile('.artifacts/benchmark-dispute.pdf')});
try { const rendered=await parser.getScreenshot({scale:1.5}); await writeFile('.artifacts/benchmark-dispute.png',rendered.pages[0].data); console.log('Rendered claim PDF'); } finally { await parser.destroy(); }
