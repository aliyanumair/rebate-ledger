import { normalizeSku } from "./reconciliation";

export const CSV_FIELDS = ["txn_id", "invoice_id", "date", "vendor_name", "sku", "description", "qty", "unit_cost", "extended_cost", "customer_name", "project_code", "txn_type"];
const aliases: Record<string, string[]> = {
  txn_id: ["txnid", "transactionid", "lineid", "rowid"], invoice_id: ["invoiceid", "invoicenumber", "invoiceno", "invoicenum", "invno", "invnumber"], date: ["date", "transactiondate", "invoicedate", "postingdate", "posteddate"],
  vendor_name: ["vendorname", "suppliername", "manufacturer", "vendor", "supplier"], sku: ["suppliersku", "sku", "itemnumber", "itemno", "partnumber", "partno", "productcode", "itemcode"],
  description: ["description", "productdescription", "itemdescription", "detail"], qty: ["qty", "quantity", "units", "qtyshipped"],
  unit_cost: ["unitcost", "unitprice", "priceeach", "costperunit"], extended_cost: ["extendedcost", "lineamount", "extamt", "extendedamount", "linetotal", "netamount", "extendedprice"],
  customer_name: ["customername", "customer", "customerid", "custid", "soldto", "accountname"], project_code: ["projectcode", "job", "jobnumber", "contract"], txn_type: ["txntype", "transactiontype", "linetype", "doctype", "type"],
};
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export function detectColumnMapping(headers: string[], previous: Record<string, string> = {}) {
  const mapping: Record<string, string> = {};
  for (const field of CSV_FIELDS) {
    if (headers.includes(previous[field])) mapping[field] = previous[field];
    else {
      const exact = aliases[field].map(alias => headers.find(header => normalize(header) === alias)).find(Boolean);
      const partial = headers.filter(header => aliases[field].some(alias => alias.length > 4 && normalize(header).includes(alias)));
      if (exact) mapping[field] = exact;
      else if (partial.length === 1) mapping[field] = partial[0];
    }
  }
  return mapping;
}
export function parseCsvTable(text: string): { headers: string[]; rows: string[][] } {
  if (text.length > 12 * 1024 * 1024) throw new Error("CSV must be 12 MB or smaller.");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const content = text.replace(/^\uFEFF/, "");
  const firstLine = content.split(/\r?\n/)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : (firstLine.split(";").length > firstLine.split(",").length ? ";" : ",");
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"' && quoted && content[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') { if (!quoted && cell.trim()) throw new Error("Malformed CSV quote; export a valid CSV and retry."); quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Malformed CSV: closing quote is missing.");
  if (cell.length || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  const headers = rows.shift() ?? [];
  if (headers.length < 2 || headers.some(header => !header) || new Set(headers.map(normalize)).size !== headers.length) throw new Error("CSV headers are missing, empty, or duplicated.");
  if (!rows.length) throw new Error("CSV contains no transaction rows.");
  if (rows.length > 50000) throw new Error("Split files larger than 50,000 rows into audit periods.");
  if (rows.some(record => record.length !== headers.length)) throw new Error("CSV row width does not match the headers.");
  return { headers, rows };
}
export function validateColumnMapping(mapping: Record<string, string>, headers: string[]): void {
  for (const field of ["date", "sku", "qty", "extended_cost", "txn_type"]) {
    if (!mapping[field] || !headers.includes(mapping[field])) throw new Error(`Map the required ${field.replaceAll("_", " ")} column.`);
  }
  if (new Set(Object.values(mapping).filter(Boolean)).size !== Object.values(mapping).filter(Boolean).length) throw new Error("Each CSV column must map to only one field.");
}
export function validMappedSku(value: string): boolean { return Boolean(normalizeSku(value)); }
