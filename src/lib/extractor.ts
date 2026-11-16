import Decimal from "decimal.js";
import PDFParser from "pdf2json";
import { PDFDocument } from "pdf-lib";

/** Deterministic PDF-to-rule extraction. This module extracts citations and rules only; it never calculates rebates. */
export type RuleCitation = { source: string; pageNumber: number | null; clauseId: string | null; excerpt: string };
export type RebateTierRule = { minimumSpend: string; maximumSpend: string | null; ratePercent: string; calculation: "retroactive" | "incremental" | "unspecified"; citation: RuleCitation };
export type ExclusionRule = { category: "sku" | "freight" | "tax" | "other"; values: string[]; description: string; citation: RuleCitation };
export type SpaSkuRule = { sku: string; standardCost: string | null; supportedPrice: string | null; approvedContractors: string[]; citation: RuleCitation };
export type SpaClaimbackRule = { description: string; citation: RuleCitation };
export type ClaimDeadlineRule = { days: number; trigger: string; citation: RuleCitation };
export type ExtractedSupplierRules = { schemaVersion: 1; source: string; extractionMethod: "deterministic-regex" | "claude-structured"; currency: string; programName?: string | null; supplierName?: string | null; effectiveStartDate?: string | null; effectiveEndDate?: string | null; tiers: RebateTierRule[]; exclusions: ExclusionRule[]; spaSkus: SpaSkuRule[]; spaClaimbackRules: SpaClaimbackRule[]; claimDeadlines: ClaimDeadlineRule[]; warnings: string[] };
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
    const isHeading = /^(?:\d+(?:\.\d+)*[.)]?\s|schedule\s+[a-z]|[A-Z0-9]{1,12}[-/][A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*\s*\|)/i.test(line);
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
  for (const line of lines) {
    const match = line.text.match(/(?:approved (?:mechanical )?contractors?|participating contractors?)\s*:\s*(.+?)(?=\s+and\s+(?:may|must|shall)\b|;|$)/i);
    if (!match) continue;
    match[1].split(/[,;|]|\band\b/i).map(x => x.trim().replace(/;$/, "")).filter(Boolean).forEach(x => contractors.add(x));
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
  const period = text.match(/effective\s+(?:period|dates?)\s*:?\s*(\d{4}-\d{2}-\d{2})\s*(?:through|to|until|–|-)\s*(\d{4}-\d{2}-\d{2})/i);
  const programName = text.match(/program\s*:\s*(.+?)(?=\s+supplier\s*:|\r?\n|$)/i)?.[1]?.trim() ?? null;
  const supplierName = text.match(/supplier\s*:\s*(.+?)(?=\s+(?:effective|currency)\s*:|\r?\n|$)/i)?.[1]?.trim() ?? null;
  const rules: ExtractedSupplierRules = { schemaVersion: 1, source: sourceName, extractionMethod: "deterministic-regex", currency: /\b(?:USD|US dollars?)\b/i.test(text) || text.includes("$") ? "USD" : "UNSPECIFIED", programName, supplierName, effectiveStartDate: period?.[1] ?? null, effectiveEndDate: period?.[2] ?? null, tiers: parseTiers(lines, sourceName), exclusions: parseExclusions(lines, sourceName), spaSkus: parseSpaSkus(lines, sourceName), spaClaimbackRules: parseSpaClaimbacks(lines, sourceName), claimDeadlines: parseDeadlines(lines, sourceName), warnings: [] };
  if (!rules.tiers.length) rules.warnings.push("No volume rebate tiers were confidently detected; verify the agreement manually.");
  if (rules.tiers.some(x => x.calculation === "unspecified")) rules.warnings.push("At least one tier does not state whether it is retroactive or incremental.");
  if (!rules.exclusions.length) rules.warnings.push("No explicit exclusion clauses were detected.");
  if (!rules.claimDeadlines.length) rules.warnings.push("No claim submission deadline was detected.");
  return rules;
}

/** Optional callback seam for deterministic extraction tests and deployments that inject a provider. */
export type AssistedRuleExtractor = (text: string, sourceName: string) => Promise<ExtractedSupplierRules>;
const CLAUDE_RULES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["programName", "supplierName", "tiers", "spaItems", "exclusions", "sourceCitations"],
  properties: {
    programName: { type: ["string", "null"] },
    supplierName: { type: ["string", "null"] },
    tiers: { type: "array", items: { type: "object", additionalProperties: false, required: ["minSpend", "maxSpend", "rebateRate", "retroactive", "citationIndex"], properties: { minSpend: { type: "string" }, maxSpend: { type: ["string", "null"] }, rebateRate: { type: "string" }, retroactive: { type: ["boolean", "null"] }, citationIndex: { type: "integer" } } } },
    spaItems: { type: "array", items: { type: "object", additionalProperties: false, required: ["sku", "standardCost", "supportedPrice", "approvedContractors", "citationIndex"], properties: { sku: { type: "string" }, standardCost: { type: ["string", "null"] }, supportedPrice: { type: ["string", "null"] }, approvedContractors: { type: "array", items: { type: "string" } }, citationIndex: { type: "integer" } } } },
    exclusions: { type: "array", items: { type: "object", additionalProperties: false, required: ["category", "values", "description", "citationIndex"], properties: { category: { type: "string", enum: ["sku", "freight", "tax", "other"] }, values: { type: "array", items: { type: "string" } }, description: { type: "string" }, citationIndex: { type: "integer" } } } },
    sourceCitations: { type: "array", items: { type: "object", additionalProperties: false, required: ["pageNumber", "clauseId", "excerpt"], properties: { pageNumber: { type: ["integer", "null"] }, clauseId: { type: ["string", "null"] }, excerpt: { type: "string" } } } },
  },
} as const;
export type ClaudeRules = {
  programName: string | null; supplierName: string | null;
  tiers: Array<{ minSpend: string; maxSpend: string | null; rebateRate: string; retroactive: boolean | null; citationIndex: number }>;
  spaItems: Array<{ sku: string; standardCost: string | null; supportedPrice: string | null; approvedContractors: string[]; citationIndex: number }>;
  exclusions: Array<{ category: ExclusionRule["category"]; values: string[]; description: string; citationIndex: number }>;
  sourceCitations: Array<{ pageNumber: number | null; clauseId: string | null; excerpt: string }>;
};
function citationAt(citations: ClaudeRules["sourceCitations"], index: number, source: string): RuleCitation {
  const citation = Number.isInteger(index) && index >= 0 ? citations[index] : undefined;
  return { source, pageNumber: citation?.pageNumber ?? null, clauseId: citation?.clauseId ?? null, excerpt: citation?.excerpt?.slice(0, 500) ?? "" };
}
export function mapClaudeCandidateRules(value: ClaudeRules, sourceName: string, text: string): ExtractedSupplierRules {
  const citations = Array.isArray(value.sourceCitations) ? value.sourceCitations : [];
  const regexRules = extractRulesFromText(text, sourceName);
  const normalizedRate = (rate: string) => rate.trim().replace(/\s*%$/, "");
  return {
    schemaVersion: 1, source: sourceName, extractionMethod: "claude-structured", programName: value.programName ?? regexRules.programName ?? null, supplierName: value.supplierName ?? regexRules.supplierName ?? null, effectiveStartDate: regexRules.effectiveStartDate ?? null, effectiveEndDate: regexRules.effectiveEndDate ?? null,
    currency: /\b(?:USD|US dollars?)\b/i.test(text) || text.includes("$") ? "USD" : "UNSPECIFIED",
    tiers: (value.tiers ?? []).map(tier => {
      const ratePercent = normalizedRate(tier.rebateRate);
      const deterministic = regexRules.tiers.find(candidate => candidate.minimumSpend === tier.minSpend && normalizedRate(candidate.ratePercent) === ratePercent);
      // Never spread one tier's contract language across every tier. Keep an
      // ambiguous candidate unresolved unless its own deterministic source line
      // establishes the calculation method.
      const calculation = tier.retroactive === true ? "retroactive" : tier.retroactive === false ? "incremental" : deterministic?.calculation ?? "unspecified";
      return { minimumSpend: tier.minSpend, maximumSpend: tier.maxSpend, ratePercent, calculation, citation: citationAt(citations, tier.citationIndex, sourceName) };
    }),
    exclusions: (value.exclusions ?? []).map(rule => ({ category: rule.category, values: rule.values, description: rule.description, citation: citationAt(citations, rule.citationIndex, sourceName) })),
    spaSkus: (value.spaItems ?? []).map(item => ({ sku: item.sku, standardCost: item.standardCost, supportedPrice: item.supportedPrice, approvedContractors: item.approvedContractors, citation: citationAt(citations, item.citationIndex, sourceName) })),
    spaClaimbackRules: [], claimDeadlines: [], warnings: ["Claude extracted candidate contract terms. A reviewer must verify every applicable rule before reconciliation.", ...(value.programName ? [] : ["Program name not found in the contract."]), ...(value.supplierName ? [] : ["Supplier name not found in the contract."])],
  };
}
async function extractRulesWithClaude(text: string, sourceName: string): Promise<ExtractedSupplierRules> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(8_000),
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, output_config: { format: { type: "json_schema", schema: CLAUDE_RULES_SCHEMA } }, messages: [{ role: "user", content: `Extract only explicit candidate terms from the supplied contract text. Never calculate rebates or infer missing terms. Use exact decimal strings for amounts and rates. For unclear or absent values, use null, empty arrays, or retroactive=null. Each source citation must quote a short exact excerpt, and every rule must reference its citation by zero-based citationIndex. Do not treat tier opportunities as earned amounts. Source: ${sourceName}\n\n<contract_text>\n${text.slice(0, 100_000)}\n</contract_text>` }] }),
  });
  if (!response.ok) throw new Error(`Anthropic extraction returned HTTP ${response.status}.`);
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const raw = payload.content?.find(block => block.type === "text")?.text;
  if (!raw) throw new Error("Anthropic returned no structured contract data.");
  const rules = JSON.parse(raw) as ClaudeRules;
  return mapClaudeCandidateRules(rules, sourceName, text);
}
export async function extractRulesWithProvider(text: string, sourceName = "supplier-document.pdf"): Promise<ExtractedSupplierRules> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    try { return await extractRulesWithClaude(text, sourceName); }
    catch (error) {
      const fallback = extractRulesFromText(text, sourceName);
      fallback.warnings.push(`Claude extraction was unavailable; deterministic extraction was used. ${error instanceof Error ? error.message : "Unknown extractor error."}`);
      return fallback;
    }
  }
  return extractRulesFromText(text, sourceName);
}
function decodePdfText(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
function extractUncompressedPdfText(buffer: Uint8Array): string {
  const source = Buffer.from(buffer).toString("latin1");
  if (/\/Encrypt\b/.test(source)) return "";
  const streams = [...source.matchAll(/<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  if (!streams.length || streams.some(match => /\/Filter\b/.test(match[1]))) return "";
  const unescape = (literal: string) => literal.replace(/\\([nrtbf()\\])|\\([0-7]{1,3})/g, (_match, named: string | undefined, octal: string | undefined) => {
    if (octal) return String.fromCharCode(parseInt(octal, 8));
    if (!named) return "";
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[named] ?? "";
  });
  const text: string[] = [];
  for (const [pageIndex, stream] of streams.entries()) {
    text.push(`[[PAGE ${pageIndex + 1}]]`);
    const literals = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    for (const match of stream[2].matchAll(literals)) text.push(unescape(match[1]));
  }
  return text.join("\n");
}
export async function extractRulesFromPdf(buffer: Buffer | Uint8Array, sourceName = "supplier-document.pdf", assistedExtractor?: AssistedRuleExtractor): Promise<ExtractedSupplierRules> {
  if (buffer.length === 0 || Buffer.from(buffer).subarray(0, 5).toString() !== "%PDF-") throw new Error("Unreadable PDF. Use Manual Contract Rule Entry.");
  const parser = new PDFParser(null, true, "");
  const text = await new Promise<string>((resolve, reject) => {
    let settled = false;
    parser.on("pdfParser_dataError", (error) => {
      parser.destroy();
      const nestedError = (error as { parserError?: unknown }).parserError;
      const detail = nestedError instanceof Error ? nestedError.message : error instanceof Error ? error.message : String(nestedError ?? error);
      void PDFDocument.load(Buffer.from(buffer), { updateMetadata: false }).then(document => {
        const fallbackText = extractUncompressedPdfText(buffer);
        if (!settled && document.getPageCount() > 0 && fallbackText.trim().length >= 20) {
          settled = true;
          resolve(fallbackText);
        } else if (!settled) {
          settled = true;
          reject(new Error(`Unreadable or unsupported PDF. Use Manual Contract Rule Entry. ${detail}`));
        }
      }).catch(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Unreadable or unsupported PDF. Use Manual Contract Rule Entry. ${detail}`));
        }
      });
    });
    parser.on("pdfParser_dataReady", (data) => {
      if (settled) return;
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
      settled = true;
      resolve(pages.join("\n"));
    });
    parser.parseBuffer(Buffer.from(buffer));
  }).finally(() => parser.destroy());
  if (text.replace(/\[\[PAGE \d+\]\]/g, "").trim().length < 20) throw new Error("Scanned or unreadable PDF. Use Manual Contract Rule Entry and verify against the source.");
  if (assistedExtractor) return assistedExtractor(text, sourceName);
  return extractRulesWithProvider(text, sourceName);
}
