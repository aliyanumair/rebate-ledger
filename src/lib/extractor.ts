import Decimal from "decimal.js";
import PDFParser from "pdf2json";

/** Deterministic PDF-to-rule extraction. This module extracts citations and rules only; it never calculates rebates. */
export type RuleCitation = { source: string; pageNumber: number | null; clauseId: string | null; excerpt: string };
export type RebateTierRule = { minimumSpend: string; maximumSpend: string | null; ratePercent: string; calculation: "retroactive" | "incremental" | "unspecified"; citation: RuleCitation };
export type ExclusionRule = { category: "sku" | "freight" | "tax" | "other"; values: string[]; description: string; citation: RuleCitation };
export type SpaSkuRule = { sku: string; standardCost: string | null; supportedPrice: string | null; approvedContractors: string[]; citation: RuleCitation };
export type SpaClaimbackRule = { description: string; citation: RuleCitation };
export type ClaimDeadlineRule = { days: number; trigger: string; citation: RuleCitation };
export type ExtractedSupplierRules = { schemaVersion: 1; source: string; extractionMethod: "deterministic-regex"; currency: string; tiers: RebateTierRule[]; exclusions: ExclusionRule[]; spaSkus: SpaSkuRule[]; spaClaimbackRules: SpaClaimbackRule[]; claimDeadlines: ClaimDeadlineRule[]; warnings: string[] };
type LocatedLine = { text: string; pageNumber: number | null; clauseId: string | null };

const MONEY = String.raw`(?:\$\s*)?\d[\d,]*(?:\.\d{1,2})?\s*(?:k|thousand|million|M)?`;
function toMoney(value: string): string {
  const raw = value.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  const suffix = raw.match(/(k|thousand|million|m)$/i)?.[1]?.toLowerCase();
  const number = new Decimal(raw.replace(/\s*(k|thousand|million|m)$/i, ""));
  const factor = suffix === "k" || suffix === "thousand" ? 1_000 : suffix === "m" || suffix === "million" ? 1_000_000 : 1;
  if (!number.isFinite()) throw new Error("Invalid contract monetary value.");
  return number.mul(factor).toFixed(2);
}
function splitPages(text: string): LocatedLine[] {
  let pageNumber: number | null = null, clauseId: string | null = null;
  const lines: LocatedLine[] = [];
  for (const raw of text.split(/\r?\n|\f/)) {
    const line = raw.trim(); if (!line) continue;
    const page = line.match(/^\[\[?\s*PAGE\s+(\d+)\s*\]?\]$/i) ?? line.match(/^Page\s+(\d+)\s*(?:of\s+\d+)?$/i);
    if (page) { pageNumber = Number(page[1]); continue; }
    const clause = line.match(/\b(?:clause|section|paragraph)\s+([\d]+(?:\.[\d]+)*)\b/i) ?? line.match(/^\s*(\d+(?:\.\d+)*)[.)]?\s+/);
    if (clause) clauseId = clause[1];
    const previous = lines.at(-1);
    const isHeading = /^(?:\d+(?:\.\d+)*[.)]?\s|schedule\s+[a-z]|[A-Z]{1,5}[-/][A-Z0-9]{2,}\s*\|)/i.test(line);
    if (previous && previous.pageNumber === pageNumber && previous.clauseId === clauseId && !/[.!?]$/.test(previous.text) && !isHeading) previous.text += ` ${line}`;
    else lines.push({ text: line, pageNumber, clauseId });
  }
  return lines;
}
function cite(line: LocatedLine, source: string): RuleCitation { return { source, pageNumber: line.pageNumber, clauseId: line.clauseId, excerpt: line.text.slice(0, 500) }; }
function parseTiers(lines: LocatedLine[], source: string): RebateTierRule[] {
  const result: RebateTierRule[] = [];
  const rangeRe = new RegExp(String.raw`(${MONEY})\s*(?:-|to|through|–|—)\s*(${MONEY})[^\n%]{0,100}?([\d.]+)\s*%`, "i");
  const aboveRe = new RegExp(String.raw`(${MONEY})\s+(?:and above|or more|or greater|and over)\s*([\d.]+)\s*%`, "gi");
  const atRe = new RegExp(String.raw`(?:at|above|over|reach(?:es)?|spend(?: of)?|minimum(?: spend)?(?: of)?|threshold(?: of)?|or more|or greater|and above)\s*(${MONEY})[^\n%]{0,100}?([\d.]+)\s*%`, "i");
  const spendOrMoreRe = new RegExp(String.raw`spend\s+(?:of\s+)?(${MONEY})\s+(?:or more|or greater|and above|and over)[^\n%]{0,80}?([\d.]+)\s*%`, "i");
  const reverseRe = new RegExp(String.raw`([\d.]+)\s*%[^\n$]{0,100}?(?:at|above|over|reach(?:es)?|minimum(?: spend)?(?: of)?|threshold(?: of)?)\s*(${MONEY})`, "i");
  for (const line of lines) {
    if (!/(rebate|tier|volume|purchase|spend|qualif|earned)/i.test(line.text)) continue;
    const ranges = [...line.text.matchAll(new RegExp(rangeRe.source, "gi"))];
    const matches: Array<{ minimum: string; maximum: string | null; rate: string }> = ranges.map((m) => ({ minimum: toMoney(m[1]), maximum: toMoney(m[2]), rate: m[3] }));
    const aboveTiers = [...line.text.matchAll(new RegExp(aboveRe.source, "gi"))].map((m) => ({ minimum: toMoney(m[1]), maximum: null, rate: m[2] }));
    matches.push(...aboveTiers.filter((tier) => !matches.some((existing) => existing.minimum === tier.minimum && existing.rate === tier.rate)));
    const spendOrMore = line.text.match(spendOrMoreRe);
    if (spendOrMore) {
      const tier = { minimum: toMoney(spendOrMore[1]), maximum: null, rate: spendOrMore[2] };
      if (!matches.some((existing) => existing.minimum === tier.minimum && existing.rate === tier.rate)) matches.push(tier);
    }
    // Only try broad prose patterns when the line did not already yield explicit table tiers.
    // This prevents explanatory amounts later on the same PDF text line from being read as rates.
    if (matches.length === 0) {
      const thresholds = [...line.text.matchAll(new RegExp(atRe.source, "gi"))];
      matches.push(...thresholds.map((m) => ({ minimum: toMoney(m[1]), maximum: null, rate: m[2] })));
      if (matches.length === 0) {
        const reversed = [...line.text.matchAll(new RegExp(reverseRe.source, "gi"))];
        matches.push(...reversed.map((m) => ({ minimum: toMoney(m[2]), maximum: null, rate: m[1] })));
      }
    }
    const calculation = /retroactive|retroactively|back to (?:the )?first dollar|from (?:the )?first dollar|to dollar one/i.test(line.text) ? "retroactive" : /incremental|only (?:the )?amount above|portion (?:of spend )?above/i.test(line.text) ? "incremental" : "unspecified";
    for (const match of matches) result.push({ minimumSpend: match.minimum, maximumSpend: match.maximum, ratePercent: new Decimal(match.rate).toString(), calculation, citation: cite(line, source) });
  }
  return [...new Map(result.map(x => [`${x.minimumSpend}|${x.maximumSpend ?? ""}|${x.ratePercent}`, x])).values()].sort((a,b) => new Decimal(a.minimumSpend).cmp(b.minimumSpend));
}
function parseExclusions(lines: LocatedLine[], source: string): ExclusionRule[] {
  const out: ExclusionRule[] = [];
  for (const line of lines) {
    if (!/(exclude|excluded|not eligible|ineligible|does not qualify|shall not count)/i.test(line.text)) continue;
    const lower = line.text.toLowerCase(), categories: ExclusionRule["category"][] = [];
    if (/freight|shipping|delivery charge|handling charge/.test(lower)) categories.push("freight");
    if (/tax|sales tax|vat/.test(lower)) categories.push("tax");
    if (/sku|part(?:s)?\b|product code|part number|part no\.?|item number|model number/.test(lower)) categories.push("sku");
    if (!categories.length) categories.push("other");
    const values = categories.includes("sku") ? (line.text.match(/\b[A-Z0-9]+(?:[-_/][A-Z0-9]+)+\b/gi) ?? []).map(x => x.toUpperCase()) : [];
    for (const category of categories) out.push({ category, values, description: line.text, citation: cite(line, source) });
  }
  return out;
}
function parseSpaSkus(lines: LocatedLine[], source: string): SpaSkuRule[] {
  const contractors = new Set<string>();
  for (const line of lines) if (/approved (?:mechanical )?contractors?|participating contractors?/i.test(line.text)) {
    (line.text.split(/approved (?:mechanical )?contractors?\s*:?|participating contractors?\s*:?/i).pop() ?? "").split(/[,;|]|\band\b/i).map(x => x.trim().replace(/[.;]$/, "")).filter(Boolean).forEach(x => contractors.add(x));
  }
  const out: SpaSkuRule[] = [];
  for (const line of lines) {
    const match = line.text.match(/\bSKU\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/i) ?? line.text.match(/^\s*([A-Z]{1,5}[-/]?[A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*)\s*(?:\||,|\s{2,})/);
    const prices = [...line.text.matchAll(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g)].map(m => toMoney(m[1]));
    if (!match || prices.length < 2) continue;
    out.push({ sku: match[1].toUpperCase(), standardCost: prices[0] ?? null, supportedPrice: prices[1] ?? null, approvedContractors: [...contractors], citation: cite(line, source) });
  }
  return [...new Map(out.map(x => [x.sku, x])).values()];
}
function parseDeadlines(lines: LocatedLine[], source: string): ClaimDeadlineRule[] {
  const out: ClaimDeadlineRule[] = [];
  for (const line of lines) {
    if (!/(claim|submit|file|request).{0,70}(deadline|within|no later|days?)|(?:deadline|within|no later).{0,70}(claim|submit|file|request)/i.test(line.text)) continue;
    const match = line.text.match(/\b(\d{1,3})\s*(calendar\s+days?|business\s+days?|days?)\b/i); if (!match) continue;
    const days = Number(match[1]); if (days < 1 || days > 730) continue;
    const trigger = line.text.match(/(?:within|no later than)\s+\d{1,3}\s*(?:calendar\s+days?|business\s+days?|days?)\s+(?:of|after|following)\s+([^.;]+)/i)?.[1]?.trim() ?? "contract-stated trigger";
    out.push({ days, trigger, citation: cite(line, source) });
  }
  return out;
}
function parseSpaClaimbacks(lines: LocatedLine[], source: string): SpaClaimbackRule[] {
  const rules = lines.filter((line) => /claimback|reimbursable|claim quantity|duplicate claims|returned quantities|approved contractor.{0,30}project/i.test(line.text));
  return [...new Map(rules.map((line) => [line.text, { description: line.text, citation: cite(line, source) }])).values()];
}
export function extractRulesFromText(text: string, sourceName = "supplier-document.pdf"): ExtractedSupplierRules {
  const lines = splitPages(text);
  const rules: ExtractedSupplierRules = { schemaVersion: 1, source: sourceName, extractionMethod: "deterministic-regex", currency: /\b(?:USD|US dollars?)\b/i.test(text) || text.includes("$") ? "USD" : "UNSPECIFIED", tiers: parseTiers(lines, sourceName), exclusions: parseExclusions(lines, sourceName), spaSkus: parseSpaSkus(lines, sourceName), spaClaimbackRules: parseSpaClaimbacks(lines, sourceName), claimDeadlines: parseDeadlines(lines, sourceName), warnings: [] };
  if (!rules.tiers.length) rules.warnings.push("No volume rebate tiers were confidently detected; verify the agreement manually.");
  if (rules.tiers.some(x => x.calculation === "unspecified")) rules.warnings.push("At least one tier does not state whether it is retroactive or incremental.");
  if (!rules.exclusions.length) rules.warnings.push("No explicit exclusion clauses were detected.");
  if (!rules.claimDeadlines.length) rules.warnings.push("No claim submission deadline was detected.");
  return rules;
}

/** Optional, explicit seam for a future assisted extractor. API keys alone never cause a network request. */
export type AssistedRuleExtractor = (text: string, sourceName: string) => Promise<ExtractedSupplierRules>;
function decodePdfText(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
export async function extractRulesFromPdf(buffer: Buffer | Uint8Array, sourceName = "supplier-document.pdf", assistedExtractor?: AssistedRuleExtractor): Promise<ExtractedSupplierRules> {
  if (buffer.length === 0 || Buffer.from(buffer).subarray(0, 5).toString() !== "%PDF-") throw new Error("Unreadable PDF. Use Manual Contract Rule Entry.");
  const parser = new PDFParser(null, true, "");
  const text = await new Promise<string>((resolve, reject) => {
    parser.on("pdfParser_dataError", (error) => {
      parser.destroy();
      const nestedError = (error as { parserError?: unknown }).parserError;
      const detail = nestedError instanceof Error ? nestedError.message : error instanceof Error ? error.message : String(nestedError ?? error);
      reject(new Error(`Unreadable or unsupported PDF. Use Manual Contract Rule Entry. ${detail}`));
    });
    parser.on("pdfParser_dataReady", (data) => {
      const pages = data.Pages.map((page, index) => {
        const positioned = page.Texts.map((item) => ({ y: item.y, x: item.x, text: item.R.map((run) => decodePdfText(run.T)).join("") })).sort((a, b) => a.y - b.y || a.x - b.x);
        const rows: Array<{ y: number; items: typeof positioned }> = [];
        for (const item of positioned) {
          const row = rows.at(-1);
          if (row && Math.abs(row.y - item.y) < 0.12) row.items.push(item);
          else rows.push({ y: item.y, items: [item] });
        }
        const pageText = rows.map((row) => row.items.map((item) => item.text).join(" ")).join("\n");
        return `[[PAGE ${index + 1}]]\n${pageText}`;
      });
      resolve(pages.join("\n"));
    });
    parser.parseBuffer(Buffer.from(buffer));
  }).finally(() => parser.destroy());
  if (text.replace(/\[\[PAGE \d+\]\]/g, "").trim().length < 20) throw new Error("Scanned or unreadable PDF. Use Manual Contract Rule Entry and verify against the source.");
  return assistedExtractor ? assistedExtractor(text, sourceName) : extractRulesFromText(text, sourceName);
}
