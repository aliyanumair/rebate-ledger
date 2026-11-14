export type CsvTable = { headers: string[]; rows: string[][] };

/** RFC 4180 compatible record reader: handles escaped quotes, embedded newlines, CRLF, and BOM. */
export function parseCsv(text: string): CsvTable {
  const input = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.length > 0)) records.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (cell.length > 0 || row.length > 0) { row.push(cell); records.push(row); }
  const [rawHeaders = [], ...rows] = records;
  const headers = rawHeaders.map((header) => header.trim());
  if (!headers.length || headers.some((header) => !header)) throw new Error("CSV must include non-empty column headers.");
  if (new Set(headers.map(normalizeHeader)).size !== headers.length) throw new Error("CSV contains duplicate column names after normalization.");
  return { headers, rows: rows.map((values) => headers.map((_, index) => values[index] ?? "")) };
}

function normalizeHeader(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

const ALIASES: Record<string, string[]> = {
  txn_id: ["invoice_number", "invoice_no", "invoice", "txn_id", "transaction_id", "document_number", "reference"],
  date: ["transaction_date", "invoice_date", "date", "posted_date"],
  vendor_name: ["vendor_name", "supplier_name", "vendor", "supplier", "manufacturer"],
  sku: ["sku", "part_no", "part_number", "item_number", "product_code", "item_code"],
  description: ["description", "item_description", "product_description", "item_name"],
  qty: ["qty", "quantity", "units"],
  unit_cost: ["unit_cost", "unit_price", "price_each", "cost_per_unit"],
  extended_cost: ["extended_cost", "extended_amount", "ext_amt", "line_total", "amount", "total"],
  customer_name: ["customer_name", "customer", "account_name", "sold_to"],
  project_code: ["project_code", "project", "job_code", "job"],
  txn_type: ["txn_type", "transaction_type", "document_type", "type"],
};

const REQUIRED_FIELDS = new Set(["txn_id", "date", "vendor_name", "sku", "qty", "extended_cost", "txn_type"]);
export function requiredCsvFields(): Set<string> { return new Set(REQUIRED_FIELDS); }
function score(field: string, header: string): number {
  const normalized = normalizeHeader(header);
  const aliases = ALIASES[field] ?? [];
  const exact = aliases.findIndex((alias) => normalizeHeader(alias) === normalized);
  if (exact >= 0) return 100 - exact;
  if (normalized === normalizeHeader(field)) return 120;
  if (field === "txn_id" && /^(?:invoice|inv)(?:number|no|id)$/.test(normalized)) return 115;
  if (field === "date" && /^(?:transaction|txn|invoice|posted)date$/.test(normalized)) return 110;
  const compact = normalizeHeader(field);
  return normalized.includes(compact) || compact.includes(normalized) ? 10 : 0;
}

/** One-to-one auto assignment. High-confidence and exact aliases win before fuzzy matches. */
export function autoMapCsvHeaders(headers: string[], fields = Object.keys(ALIASES)): Record<string, string> {
  const candidates = fields.flatMap((field) => headers.map((header) => ({ field, header, score: score(field, header) })))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || fields.indexOf(a.field) - fields.indexOf(b.field) || headers.indexOf(a.header) - headers.indexOf(b.header));
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const candidate of candidates) {
    if (result[candidate.field] || used.has(candidate.header)) continue;
    result[candidate.field] = candidate.header;
    used.add(candidate.header);
  }
  return result;
}

export function validateCsvColumnMap(map: Record<string, string>, requiredFields = REQUIRED_FIELDS): string[] {
  const errors: string[] = [];
  const assigned = Object.entries(map).filter(([, header]) => header);
  const duplicates = assigned.filter(([, header], index) => assigned.findIndex(([, other]) => other === header) !== index);
  if (duplicates.length) errors.push(`CSV column “${duplicates[0][1]}” is assigned to more than one field.`);
  for (const field of requiredFields) if (!map[field]) errors.push(`Map the required field “${field.replaceAll("_", " ")}”.`);
  return errors;
}
