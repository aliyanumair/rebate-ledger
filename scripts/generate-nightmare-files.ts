import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const out = path.join(process.cwd(), 'data', 'benchmark', 'nightmare_set');
const money = (n: number) => `${n < 0 ? '(' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${n < 0 ? ')' : ''}`;
const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

async function pdf(name: string, title: string, pages: string[][]) {
  const escape = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const pageCount = pages.length, pagesId = 2 * pageCount + 4, catalogId = pagesId + 1, infoId = pagesId + 2;
  const objects: string[] = [
    '<< /F1 2 0 R /F2 3 0 R >>',
    '<< /BaseFont /Helvetica /Encoding /WinAnsiEncoding /Name /F1 /Subtype /Type1 /Type /Font >>',
    '<< /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding /Name /F2 /Subtype /Type1 /Type /Font >>',
  ];
  pages.forEach((lines, index) => {
    const pageId = 4 + index, streamId = 4 + pageCount + index;
    const commands = ['1 0 0 1 0 0 cm', 'BT /F2 16 Tf 19.2 TL 54 738 Td', `(${escape(title)}) Tj ET`];
    lines.forEach((line, lineIndex) => commands.push(`BT /F1 10 Tf 12 TL 54 ${700 - 24 * lineIndex} Td (${escape(line)}) Tj ET`));
    const stream = `${commands.join('\n')}\n`;
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font 1 0 R /ProcSet [ /PDF /Text /ImageB /ImageC /ImageI ] >> /Contents ${streamId} 0 R /Rotate 0 /Trans << >> >>`;
    objects[streamId - 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;
  });
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map((_, index) => `${4 + index} 0 R`).join(' ')}] >>`;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /PageMode /UseNone >>`;
  objects.push(`<< /Title (${escape(title)}) /Author (MarginsRecovery stress fixture) /Producer (RebateLedger deterministic fixture generator) >>`);
  let document = '%PDF-1.4\n%\u0093\u008c\u008b\u009e ReportLab Generated PDF document (opensource)\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(document, 'latin1');
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, 'latin1');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objects.length; id++) document += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R /ID [<00000000000000000000000000000000><00000000000000000000000000000000>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  await writeFile(path.join(out, name), Buffer.from(document, 'latin1'));
}

async function main() {
  await mkdir(out, { recursive: true });
  await pdf('trane_commercial_rebate_q3_2026.pdf', 'Trane Commercial Rebate Program - Q3 2026', [
    ['Program: Q3 2026 Commercial Volume Rebate', 'Supplier: Trane Commercial', 'Effective Period: 2026-07-01 through 2026-09-30', 'Currency: USD', 'Qualified net purchases exclude returns and listed items.'],
    ['Volume Rebate Tiers', 'Tier 1: $0.00 - $99,999.99 earns 0% retroactive to dollar 1.', 'Tier 2: $100,000.00 - $249,999.99 earns 2.25% retroactive to dollar 1.', 'Tier 3: Minimum spend of $250,000.00 earns 3.75% retroactive to dollar 1.', 'All rates apply retroactively to all qualified net spend in the quarter.'],
    ['Clause 4.3 - Exclusions', 'The following are excluded from qualified net purchases: freight, fuel surcharge, sales tax, pallet charges, and RMA returns.', 'Products with SKU prefix TRN-ACC- are not eligible for the volume rebate.', 'A transaction qualifies only when its invoice date falls within the effective period.'],
  ]);
  await pdf('watts_plumbing_spa_q3_2026.pdf', 'Watts Plumbing Special Pricing Agreement - Q3 2026', [
    ['Program: Q3 2026 Contractor Special Pricing Agreement', 'Supplier: Watts Plumbing', 'Currency: USD', 'Approved contractors: Metro Mechanical LLC and Summit Piping Corp.'],
    ['Special Pricing Items', 'WTS-909-RPZ | Standard $1,200.00 | Supported $960.00', 'WTS-LF009 | Standard $1,200.00 | Supported $960.00', 'WTS-BD115 | Standard $1,200.00 | Supported $960.00', 'WTS-757-DCDA | Standard $1,200.00 | Supported $960.00'],
    ['Clause 6.1 - Anti-stacking', 'SPA credits are limited to approved contractors and may not be stacked with any volume rebate.', 'Only documented eligible units receive the $240.00 per-unit price support.'],
  ]);

  const headers = ['Line_ID', 'Invoice_ID', 'Inv_Date', 'Vendor_Name', 'Item_Part_Number', 'Item_Desc', 'Ship_Qty', 'Unit_Cost', 'Ext_Net_Amt', 'Sold_To_Customer', 'Doc_Type'];
  const rows: Array<Array<string | number>> = [];
  const add = (date: string, vendor: string, sku: string, description: string, qty: number, unit: number, ext: number, customer = 'Northstar Mechanical', type = 'INVOICE') => {
    const n = rows.length + 1;
    rows.push([`LINE-${String(n).padStart(5, '0')}`, `INV-26Q3-${String(n).padStart(5, '0')}`, date, vendor, sku, description, qty, money(unit), money(ext), customer, type]);
  };
  for (let i = 0; i < 1940; i++) add(i % 3 === 0 ? '2026-07-15' : i % 3 === 1 ? '2026-08-15' : '2026-09-15', 'Trane Commercial', 'TRN-COM-100', 'Commercial HVAC equipment', 1, 133, 133);
  for (let i = 0; i < 20; i++) add('2026-09-20', 'Trane Commercial', 'TRN-COM-100', 'Commercial HVAC equipment', 1, 299, 299);
  const charges = ['Freight service', 'Sales tax charge', 'Pallet charge'];
  for (let i = 0; i < 7; i++) add('2026-08-10', 'Trane Commercial', i % 3 === 0 ? 'FRT-001' : 'CHG-001', charges[i % charges.length], 1, 1000, 1000, 'Northstar Mechanical', 'CHARGE');
  add('2026-08-10', 'Trane Commercial', 'FRT-001', 'Fuel surcharge and freight', 1, 12400, 12400, 'Northstar Mechanical', 'CHARGE');
  for (let i = 0; i < 8; i++) add('2026-09-02', 'Trane Commercial', 'TRN-COM-100', 'RMA return credit', -1, 2500, -2500, 'Northstar Mechanical', 'RMA');
  add('2026-09-02', 'Trane Commercial', 'TRN-COM-100', 'RMA return credit', -1, 2850, -2850, 'Northstar Mechanical', 'RMA');
  for (let i = 0; i < 12; i++) add('2026-08-21', 'Trane Commercial', `TRN-ACC-${String(i + 1).padStart(3, '0')}`, 'Accessory excluded under Clause 4.3', 1, 1000, 1000);
  add('2026-08-21', 'Trane Commercial', 'TRN-ACC-099', 'Accessory excluded under Clause 4.3', 1, 4200, 4200);
  for (let i = 0; i < 5; i++) add('2026-06-30', 'Trane Commercial', 'TRN-COM-100', 'Outside effective period', 1, 5000, 5000);
  add('2026-10-01', 'Trane Commercial', 'TRN-COM-100', 'Outside effective period', 1, 6000, 6000);
  for (let i = 0; i < 5; i++) add('2026-08-25', 'Trane Commercial', `MYSTERY-${i + 1}`, 'Unknown product requires review', 1, 2500, 2500);
  const spaSkus = ['WTS-909-RPZ', 'WTS-LF009', 'WTS-BD115', 'WTS-757-DCDA'];
  for (let i = 0; i < 15; i++) add('2026-08-12', 'Watts Plumbing', spaSkus[i % spaSkus.length], 'Approved SPA purchase', 1, 960, 960, i % 2 ? 'Summit Piping Corp.' : 'Metro Mechanical LLC');
  for (let i = 0; i < 8; i++) add('2026-08-13', 'Watts Plumbing', spaSkus[i % spaSkus.length], 'Unapproved contractor SPA purchase', 1, 960, 960, 'Unapproved Contractor Inc.');
  const csv = [headers.join(','), ...rows.map(row => row.map((value, index) => index === 7 || index === 8 ? csvCell(value) : csvCell(value)).join(','))].join('\r\n') + '\r\n';
  await writeFile(path.join(out, 'dirty_erp_export_q3_2026.csv'), csv, 'utf8');
  await writeFile(path.join(out, 'supplier_credit_memo_q3_2026.csv'), [
    'Credit_ID,Credit_Type,Eligible_Spend_Basis,Rate_Percent,Paid_Credit,Invoice_References',
    `CM-TRANE-Q3,Volume rebate,${csvCell(money(264000))},2.25%,${csvCell(money(5940))},Q3 2026 program statement`,
    `CM-WATTS-Q3,SPA credit,${csvCell(money(6 * 1200))},20%,${csvCell(money(1440))},Q3 2026 SPA statement`,
  ].join('\r\n') + '\r\n', 'utf8');
  await writeFile(path.join(out, 'ground_truth.json'), JSON.stringify({
    fixture: 'Q3 2026 Trane volume rebate plus Watts SPA', currency: 'USD', sourceTransactionRows: rows.length,
    expected: { eligibleVolumeSpend: '264000.00', volumeRebateEarned: '9900.00', spaEarned: '3600.00', totalEarned: '13500.00', volumePaid: '5940.00', spaPaid: '1440.00', totalPaid: '7380.00', volumeRecovery: '3960.00', spaRecovery: '2160.00', totalRecovery: '6120.00' },
    traps: { freightTaxPalletGross: '19400.00', rmaReturns: '-22850.00', excludedTraneAccessories: '16200.00', outsideWindow: '31000.00', unknownSkuQuarantine: '12500.00', approvedSpaUnits: 15, unapprovedSpaUnits: 8, unknownSkuClassification: 'UNMATCHED_SKU_NEEDS_REVIEW' },
    provenance: 'Independent fixture authoring values. Not calculated from the application reconciliation result.'
  }, null, 2) + '\n', 'utf8');
  console.log(`Generated ${rows.length} ERP rows and two contract PDFs in ${out}`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
