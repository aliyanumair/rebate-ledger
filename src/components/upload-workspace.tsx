"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useState } from "react";
import { CSV_FIELDS, detectColumnMapping, parseCsvTable, validateColumnMapping } from "@/lib/csv";
import { validateReconciliationRules, type ReconciliationResult, type ReconciliationRules } from "@/lib/reconciliation";
import type { ExtractedSupplierRules } from "@/lib/extractor";

const DRAFT_KEY = "rebateledger:workspace:v2";
const REQUIRED_CSV_FIELDS = ["date", "vendor_name", "sku", "qty", "extended_cost", "txn_type"];
const MANUAL_START = { rate: "", mode: "retroactive", clause: "", program: "", minimumSpend: "0", excludedTerms: "freight,shipping,tax,return,credit", opportunityMethod: "rate-difference-at-target", nearMissThreshold: "15000" };
const formatMoney = (value: string) => { const [whole, cents] = value.split("."); return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents ?? "00"}`; };
function asCandidate(extracted: ExtractedSupplierRules, supplier: string): ReconciliationRules {
  const skuExclusions = extracted.exclusions.filter(rule => rule.category === "sku");
  const prefixExclusions = skuExclusions.flatMap(rule => rule.description.match(/\bprefix\s+([A-Z0-9][A-Z0-9_-]*)/i)?.[1] ?? []);
  const clauses = [...extracted.tiers.map(tier => `${tier.citation.source}, Clause ${tier.citation.clauseId ?? "?"}`), ...extracted.exclusions.map(rule => `${rule.citation.source}, Clause ${rule.citation.clauseId ?? "?"}`), ...extracted.spaSkus.map(rule => `${rule.citation.source}, Clause ${rule.citation.clauseId ?? "?"}`)];
  return { supplierName: supplier.trim() || extracted.supplierName?.trim() || "", programName: extracted.programName?.trim() || extracted.source, verification: { status: "unverified", verifiedBy: "", ruleVersion: "1" }, opportunityMethod: "rate-difference-at-target", nearMissThreshold: "15000", effectiveStartDate: extracted.effectiveStartDate ?? undefined, effectiveEndDate: extracted.effectiveEndDate ?? undefined,
    tiers: extracted.tiers.map(tier => ({ minSpend: tier.minimumSpend, ratePercent: tier.ratePercent, mode: tier.calculation === "unspecified" ? undefined : tier.calculation, citation: `${tier.citation.source}, page ${tier.citation.pageNumber ?? "?"}, Clause ${tier.citation.clauseId ?? "?"}` })), eligibleSkus: [], allSupplierSkusEligible: false,
    excludedSkus: skuExclusions.flatMap(rule => rule.values.filter(value => !prefixExclusions.some(prefix => value.startsWith(prefix)))), excludedSkuPrefixes: prefixExclusions, freightAndTaxTerms: extracted.exclusions.filter(rule => rule.category === "freight" || rule.category === "tax").flatMap(rule => rule.category === "freight" ? ["freight", "shipping", "fuel surcharge", "pallet"] : ["tax"]),
    spas: extracted.spaSkus.map(rule => ({ sku: rule.sku, standardPrice: rule.standardCost ?? undefined, supportedPrice: rule.supportedPrice ?? "", approvedCustomers: rule.approvedContractors, stackWithVolumeRebate: false, citation: `${rule.citation.source}, page ${rule.citation.pageNumber ?? "?"}, Clause ${rule.citation.clauseId ?? "?"}` })), clauseCitations: [...new Set(clauses)] };
}
function parseStoredRules(stored: Record<string, unknown>): ReconciliationRules | null {
  try {
    const value = stored.rules ?? (typeof stored.ruleText === "string" ? JSON.parse(stored.ruleText) : null);
    return value && Array.isArray((value as ReconciliationRules).tiers) ? value as ReconciliationRules : null;
  } catch { return null; }
}

export function UploadWorkspace() {
  const [files, setFiles] = useState<File[]>([]), [headers, setHeaders] = useState<string[]>([]), [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}), [notice, setNotice] = useState(""), [pdfUrl, setPdfUrl] = useState("");
  const [ruleDraft, setRuleDraft] = useState<ReconciliationRules | null>(null), [extracting, setExtracting] = useState(false), [ruleLocked, setRuleLocked] = useState(false), [extractError, setExtractError] = useState("");
  const [supplier, setSupplier] = useState(""), [reviewer, setReviewer] = useState(""), [manual, setManual] = useState(false), [form, setForm] = useState(MANUAL_START), [hydrated, setHydrated] = useState(false);
  const [payments, setPayments] = useState(""), [running, setRunning] = useState(false), [auditId, setAuditId] = useState(""), [result, setResult] = useState<ReconciliationResult | null>(null);
  const ruleText = ruleDraft ? JSON.stringify(ruleDraft) : "";

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as Record<string, unknown> | null;
      if (stored) {
        setHeaders(Array.isArray(stored.headers) ? stored.headers as string[] : []); setRows(Array.isArray(stored.rows) ? stored.rows as string[][] : []);
        setMapping(stored.mapping && typeof stored.mapping === "object" ? stored.mapping as Record<string, string> : {}); setRuleDraft(parseStoredRules(stored));
        setSupplier(typeof stored.supplier === "string" ? stored.supplier : ""); setReviewer(typeof stored.reviewer === "string" ? stored.reviewer : "");
        setRuleLocked(Boolean(stored.ruleLocked)); setManual(Boolean(stored.manual));
      } else setMapping(JSON.parse(localStorage.getItem("rebateledger:column-map") || "{}"));
    } catch { setNotice("Stored draft could not be read. Please remap the CSV."); }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ headers, rows: rows.slice(0, 3), mapping, rules: ruleDraft, ruleText, supplier, reviewer, ruleLocked, manual }));
      localStorage.setItem("rebateledger:column-map", JSON.stringify(mapping));
    } catch { setNotice("Browser storage is unavailable. Keep this page open and export your draft before leaving."); }
  }, [hydrated, headers, rows, mapping, ruleDraft, ruleText, supplier, reviewer, ruleLocked, manual]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  function updateRules(update: (current: ReconciliationRules) => ReconciliationRules) {
    setRuleDraft(current => current ? { ...update(current), verification: { ...current.verification, status: "unverified", verifiedBy: "", ruleVersion: current.verification?.ruleVersion || "1" } } : current);
    setRuleLocked(false);
  }
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files || []);
    if (incoming.some(file => file.size > 12 * 1024 * 1024)) { setNotice("Each file must be 12 MB or smaller."); return; }
    setFiles(previous => [...previous, ...incoming]); setNotice("");
    const pdf = incoming.find(file => file.name.toLowerCase().endsWith(".pdf"));
    if (pdf) {
      setPdfUrl(URL.createObjectURL(pdf)); setRuleLocked(false); setExtracting(true); setExtractError("");
      const request = new FormData(); request.set("pdf", pdf);
      try {
        const response = await fetch("/api/extract", { method: "POST", body: request });
        const contentType = response.headers.get("content-type") || "";
        const data = contentType.includes("application/json") ? await response.json() : null;
        if (!data) throw new Error(`PDF extraction service returned an unexpected response (HTTP ${response.status}). Use Manual Contract Rule Entry or retry later.`);
        if (!response.ok) throw new Error(data.error || "Could not extract contract rules.");
        const candidate = asCandidate(data.rules, supplier); setRuleDraft(candidate); if (!supplier.trim() && candidate.supplierName) setSupplier(candidate.supplierName); setManual(data.rules.tiers.length === 0);
        if (!data.rules.tiers.length) setExtractError("No reliable tiers found. Enter the contract rule manually.");
      } catch (error) { setExtractError(error instanceof Error ? error.message : "Unreadable PDF."); setRuleDraft(null); setManual(true); }
      finally { setExtracting(false); }
    }
    const csv = incoming.find(file => /\.csv$/i.test(file.name));
    if (csv) { setAuditId(""); setResult(null); try { const parsed = parseCsvTable(await csv.text()); setHeaders(parsed.headers); setRows(parsed.rows); setMapping(previous => detectColumnMapping(parsed.headers, previous)); } catch (error) { setHeaders([]); setRows([]); setNotice(error instanceof Error ? error.message : "Could not read CSV."); } }
  }
  function setManualRules() {
    const candidate: ReconciliationRules = { supplierName: supplier.trim(), programName: form.program.trim(), verification: { status: "unverified", verifiedBy: "", ruleVersion: `manual-${Date.now()}` }, opportunityMethod: form.opportunityMethod as "rate-difference-at-target" | "incremental-total-rebate", nearMissThreshold: form.nearMissThreshold, tiers: [{ minSpend: form.minimumSpend, ratePercent: form.rate, mode: form.mode as "retroactive" | "incremental", citation: form.clause.trim() }], freightAndTaxTerms: form.excludedTerms.split(",").map(term => term.trim()).filter(Boolean), clauseCitations: [form.clause.trim()] };
    setRuleDraft(candidate); setRuleLocked(false); setManual(false); setExtractError(""); setNotice("Manual rule prepared. Review the displayed terms and source citation, then verify them before reconciliation.");
  }
  function toggleLock() {
    if (ruleLocked) { setRuleLocked(false); setNotice("Rules unlocked. Changes require verification again."); return; }
    try {
      if (!reviewer.trim()) throw new Error("Enter the reviewer's name before verifying rules.");
      if (!ruleDraft) throw new Error("Extract rules from a readable PDF or enter them manually first.");
      const candidate = { ...ruleDraft, supplierName: supplier.trim(), verification: { status: "verified" as const, verifiedBy: reviewer.trim(), ruleVersion: ruleDraft.verification?.ruleVersion || `review-${Date.now()}` } };
      validateReconciliationRules(candidate); setRuleDraft(candidate); setRuleLocked(true); setExtractError(""); setNotice("Verified rules saved in this browser draft. Any rule change invalidates verification.");
    } catch (error) { setExtractError(error instanceof Error ? error.message : "Invalid rules. Reconciliation remains blocked."); }
  }
  async function runReconciliation() {
    try {
      if (!ruleLocked || !ruleDraft) throw new Error("Reconciliation blocked: verify and lock the contract rules first.");
      const rules = ruleDraft; validateReconciliationRules(rules); validateColumnMapping(mapping, headers);
      if (!supplier.trim() || rules.supplierName !== supplier.trim()) throw new Error("Enter the contract supplier name and verify the rule set for that supplier.");
      if (!payments.trim()) throw new Error("Enter the supplier credit total from the statement; use 0.00 when no payment was received.");
      const csv = files.find(file => file.name.toLowerCase().endsWith(".csv"));
      if (!csv) throw new Error("Re-select the purchase CSV before running this audit. The browser does not retain source files after reload.");
      const contract = files.find(file => file.name.toLowerCase().endsWith(".pdf"));
      const body = new FormData(); body.set("supplier", supplier.trim()); body.set("rules", JSON.stringify(rules)); body.set("mapping", JSON.stringify(mapping));
      body.set("payments", JSON.stringify([{ scope: "program", amount: payments.trim(), reference: "Supplier statement total entered by reviewer" }])); body.set("csv", csv);
      if (contract) body.set("contract", contract);
      setRunning(true); setNotice(""); const response = await fetch("/api/reconcile", { method: "POST", body }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reconciliation was blocked.");
      setAuditId(data.auditId); setResult(data.result as ReconciliationResult);
      setNotice("Reconciliation completed with the verified rules and exact-decimal engine. Review the results and supporting source before making a claim.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not run reconciliation."); }
    finally { setRunning(false); }
  }
  const optionalFields = CSV_FIELDS.filter(field => !REQUIRED_CSV_FIELDS.includes(field));
  return <div className="dashboard-page upload-page" data-extraction-runtime="pdf2json-node-text-v1">
    <div className="crumb-back"><Link href="/dashboard">← Back to overview</Link></div>
    <div className="page-header"><div><div className="eyebrow">NEW AUDIT WORKSPACE</div><h1>Upload supplier files</h1><p>One supplier, one audit period. Unverified rules cannot be reconciled.</p></div><span className="tag tag-neutral">DRAFT WORKSPACE</span></div>
    <div className="upload-layout"><div>
      <section className="panel upload-panel"><div className="panel-head"><div><h2>Source documents</h2><p>Agreement PDF, purchase CSV, and credit statement.</p></div></div>
        <label className="dropzone"><input aria-label="Upload supplier audit files" type="file" multiple accept=".pdf,.csv" onChange={choose}/><span className="drop-icon">↑</span><b>Choose PDF or CSV files</b><small>Up to 12 MB each · mappings persist across reloads</small></label>
        {files.map((file, index) => <p className="upload-file" key={`${file.name}-${index}`}>{file.name}</p>)}
        <button aria-expanded={manual} className="button button-secondary manual-toggle" onClick={() => { setManual(open => !open); setRuleLocked(false); }}>{manual ? "Hide manual rule entry" : "Enter rules manually"}</button>
      </section>
      {manual && <section className="panel manual-rule-panel"><div className="panel-head"><div><h2>Manual Contract Rule Entry</h2><p>Use when the agreement is scanned or extraction needs correction. Copy the exact terms and citation.</p></div></div>
        {extractError && <p role="alert" className="form-error">{extractError}</p>}
        <div className="rule-editor manual-fields"><label>Program name<input aria-label="Manual program name" value={form.program} onChange={event => setForm({ ...form, program: event.target.value })}/></label><label>Minimum eligible spend<input aria-label="Manual minimum eligible spend" inputMode="decimal" value={form.minimumSpend} onChange={event => setForm({ ...form, minimumSpend: event.target.value })}/></label><label>Rebate rate (%)<input aria-label="Manual rebate rate" inputMode="decimal" value={form.rate} onChange={event => setForm({ ...form, rate: event.target.value })}/></label>
          <label>Tier method<select aria-label="Manual tier method" value={form.mode} onChange={event => setForm({ ...form, mode: event.target.value })}><option value="retroactive">Retroactive to first eligible dollar</option><option value="incremental">Incremental band only</option></select></label><label>Opportunity estimate<select value={form.opportunityMethod} onChange={event => setForm({ ...form, opportunityMethod: event.target.value })}><option value="rate-difference-at-target">Rate difference at target spend</option><option value="incremental-total-rebate">Next tier rebate minus current earned</option></select></label><label>Near-miss alert window<input inputMode="decimal" value={form.nearMissThreshold} onChange={event => setForm({ ...form, nearMissThreshold: event.target.value })}/></label>
          <label>Source clause and page<input aria-label="Manual source clause" value={form.clause} onChange={event => setForm({ ...form, clause: event.target.value })} placeholder="Agreement p. 1, Clause 2"/></label><label className="field-span">Excluded terms<input value={form.excludedTerms} onChange={event => setForm({ ...form, excludedTerms: event.target.value })}/><small>Comma-separated terms stated in the agreement.</small></label><button className="button button-primary" onClick={setManualRules}>Prepare manual rule</button>
        </div></section>}
      {(pdfUrl || ruleDraft || extracting) && <section className="panel verifier-panel"><div className="panel-head"><div><h2>Source rule verifier</h2><p>Review each tier, calculation method, exclusion, and source citation before locking.</p></div><span className={`tag ${ruleLocked ? "tag-green" : "tag-amber"}`}>{ruleLocked ? "Verified" : "Needs Review"}</span></div>
        <div className="verifier-grid">{pdfUrl && <div className="pdf-viewer"><iframe title="Supplier agreement PDF" src={pdfUrl}/></div>}<div className="rule-editor human-rules">
          {extracting ? <p role="status">Reading agreement clauses…</p> : ruleDraft ? <>
            <label>Program name<input aria-label="Program name" value={ruleDraft.programName} readOnly={ruleLocked} onChange={event => updateRules(current => ({ ...current, programName: event.target.value }))}/></label>
            <div className="tier-card-list"><div className="tier-card-heading"><h3>Rebate tiers</h3><button type="button" className="text-button" onClick={() => updateRules(current => ({ ...current, tiers: [...current.tiers, { minSpend: "0", ratePercent: "", mode: "retroactive", citation: "" }] }))} disabled={ruleLocked}>Add tier</button></div>
              {ruleDraft.tiers.map((tier, index) => <fieldset className="tier-rule-card" key={`tier-${index}`}><legend>Tier {index + 1}</legend><div className="rule-fields">
                <label>Minimum eligible spend<input aria-label={`Tier ${index + 1} minimum spend`} inputMode="decimal" value={tier.minSpend} readOnly={ruleLocked} onChange={event => updateRules(current => ({ ...current, tiers: current.tiers.map((item, tierIndex) => tierIndex === index ? { ...item, minSpend: event.target.value } : item) }))}/></label>
                <label>Rebate rate (%)<input aria-label={`Tier ${index + 1} rebate rate`} inputMode="decimal" value={tier.ratePercent} readOnly={ruleLocked} onChange={event => updateRules(current => ({ ...current, tiers: current.tiers.map((item, tierIndex) => tierIndex === index ? { ...item, ratePercent: event.target.value } : item) }))}/></label>
                <label>Calculation method<select aria-label={`Tier ${index + 1} calculation method`} value={tier.mode || "unspecified"} disabled={ruleLocked} onChange={event => updateRules(current => ({ ...current, tiers: current.tiers.map((item, tierIndex) => tierIndex === index ? { ...item, mode: event.target.value === "unspecified" ? undefined : event.target.value as "retroactive" | "incremental" } : item) }))}><option value="unspecified">Needs confirmation</option><option value="retroactive">Retroactive</option><option value="incremental">Incremental</option></select></label>
                <label className="field-span">Source clause and page<input aria-label={`Tier ${index + 1} source citation`} value={tier.citation || ""} readOnly={ruleLocked} onChange={event => updateRules(current => ({ ...current, tiers: current.tiers.map((item, tierIndex) => tierIndex === index ? { ...item, citation: event.target.value } : item) }))}/></label>
              </div>{ruleDraft.tiers.length > 1 && <button type="button" className="text-button remove-tier" disabled={ruleLocked} onClick={() => updateRules(current => ({ ...current, tiers: current.tiers.filter((_, tierIndex) => tierIndex !== index) }))}>Remove tier</button>}</fieldset>)}
            </div>
            <label>Eligible SKUs<input aria-label="Eligible SKUs" value={(ruleDraft.eligibleSkus || []).join(", ")} readOnly={ruleLocked || ruleDraft.allSupplierSkusEligible === true} onChange={event => updateRules(current => ({ ...current, eligibleSkus: event.target.value.split(",").map(value => value.trim()).filter(Boolean), allSupplierSkusEligible: false }))}/><small>Comma-separated SKU allowlist. Unlisted items stay in Needs Review and do not count toward tiers.</small></label>
            <label className="scope-confirmation"><input aria-label="All supplier SKUs qualify" type="checkbox" checked={ruleDraft.allSupplierSkusEligible === true} disabled={ruleLocked} onChange={event => updateRules(current => ({ ...current, eligibleSkus: [], allSupplierSkusEligible: event.target.checked }))}/> I verified that all SKUs from this supplier qualify under this contract.</label>
            <label>Excluded SKUs<input aria-label="Excluded SKUs" value={(ruleDraft.excludedSkus || []).join(", ")} readOnly={ruleLocked} onChange={event => updateRules(current => ({ ...current, excludedSkus: event.target.value.split(",").map(value => value.trim()).filter(Boolean) }))}/><small>Comma-separated part numbers from the agreement.</small></label>
            <label>Freight and tax exclusions<input aria-label="Freight and tax exclusions" value={(ruleDraft.freightAndTaxTerms || []).join(", ")} readOnly={ruleLocked} onChange={event => updateRules(current => ({ ...current, freightAndTaxTerms: event.target.value.split(",").map(value => value.trim()).filter(Boolean) }))}/></label>
            <label>Verified by<input aria-label="Verified by" value={reviewer} onChange={event => { setReviewer(event.target.value); if (ruleLocked) setRuleLocked(false); }}/></label>
            {extractError && !manual && <p role="alert" className="form-error">{extractError}</p>}
            <button className="button button-primary" onClick={toggleLock}>{ruleLocked ? "Edit rules" : "Lock verified rules"}</button>
          </> : <p role="status">No structured terms were extracted. Use manual entry and verify the source clauses.</p>}
        </div></div></section>}
      {headers.length > 0 && <section className="panel mapping-panel"><div className="panel-head"><div><h2>CSV column mapping</h2><p>Map the required fields first. Customer supports SPA eligibility matching.</p></div></div>
        <div className="mapping-table">{CSV_FIELDS.filter(field => REQUIRED_CSV_FIELDS.includes(field)).map(field => <MappingField key={field} field={field} headers={headers} mapping={mapping} onChange={setMapping}/>)}</div>
        <details className="optional-mappings"><summary>Optional columns <span>({optionalFields.length})</span></summary><div className="mapping-table">{optionalFields.map(field => <MappingField key={field} field={field} headers={headers} mapping={mapping} onChange={setMapping}/>)}</div></details>
        <div className="table-wrap"><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(0, 3).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table><p className="form-note">Previewing 3 of {rows.length.toLocaleString()} rows; all parsed rows are included in reconciliation.</p></div>
      </section>}
    </div><aside className="panel upload-side"><div className="eyebrow">AUDIT SETUP</div><h3>One supplier.<br/>One clear answer.</h3>
      <label>Supplier name<input aria-label="Supplier name" value={supplier} onChange={event => { setSupplier(event.target.value); if (ruleLocked) setRuleLocked(false); setResult(null); }}/></label>
      <label>Supplier credits received<input aria-label="Supplier credits received" inputMode="decimal" value={payments} onChange={event => { setPayments(event.target.value); setResult(null); }} placeholder="0.00 when none paid"/><small>Total posted credits for this supplier and period, from its statement.</small></label>
      <p className={`tag ${ruleLocked ? "tag-green" : "tag-amber"}`}>{ruleLocked ? "Rules verified" : "Reconciliation blocked"}</p>{notice && <p role="status" className="success-inline">{notice}</p>}
      <button className="button button-primary submit-wide" disabled={running} onClick={runReconciliation}>{running ? "Reconciling…" : "Run verified reconciliation"}</button>
      {result && auditId && <section className="result-ready" aria-live="polite"><h3>Reconciliation ready</h3><p>Net eligible spend <b>{formatMoney(result.totals.netEligibleSpend)}</b></p><p>Earned rebate <b>{formatMoney(result.totals.rebateEarned)}</b></p><p>Supplier paid <b>{formatMoney(result.totals.supplierPaid)}</b></p><p>Underpayment variance <b>{formatMoney(result.totals.unclaimedRecoveryFound)}</b></p><p>Separate tier opportunity <b>{formatMoney(result.totals.quarterEndTierOpportunity)}</b></p><Link className="button button-dark submit-wide" href={`/dashboard/audits/${auditId}`}>Review audit and export files →</Link></section>}
      <p className="form-note">Rules are calculated with exact decimal math after reviewer verification. Re-select source files after a page reload; the column mapping and rules remain in this browser.</p>
    </aside></div>
  </div>;
}

function MappingField({ field, headers, mapping, onChange }: { field: string; headers: string[]; mapping: Record<string, string>; onChange: (update: (previous: Record<string, string>) => Record<string, string>) => void }) {
  return <div className="mapping-line"><label htmlFor={`map-${field}`}>{field.replaceAll("_", " ")}</label><select id={`map-${field}`} value={mapping[field] || ""} onChange={event => onChange(previous => ({ ...previous, [field]: event.target.value }))}><option value="">Not mapped</option>{headers.map(header => <option key={header}>{header}</option>)}</select></div>;
}
