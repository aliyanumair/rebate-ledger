"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { autoMapCsvHeaders, parseCsv, requiredCsvFields, validateCsvColumnMap } from "@/lib/csv";
import type { ExtractedSupplierRules } from "@/lib/extractor";
import { validateExtractedRules } from "@/lib/rule-validation";
import type { DraftRecord, StoredFileRole } from "@/lib/store";

const EXPECTED = ["txn_id", "date", "vendor_name", "sku", "description", "qty", "unit_cost", "extended_cost", "customer_name", "project_code", "txn_type"];
const OPTIONAL = new Set(["description", "unit_cost", "customer_name", "project_code"]);
const ROLE_LABELS: Record<StoredFileRole, string> = { agreement: "Supplier agreement", purchases: "ERP purchase export", credits: "Manufacturer credit statement" };
const ACCEPT: Record<StoredFileRole, string> = { agreement: ".pdf", purchases: ".csv", credits: ".pdf,.csv" };
type FileSet = Partial<Record<StoredFileRole, File>>;

export function UploadWorkspace() {
  const router = useRouter();
  const [files, setFiles] = useState<FileSet>({});
  const [savedRefs, setSavedRefs] = useState<DraftRecord["files"]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [ruleText, setRuleText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [ruleLocked, setRuleLocked] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [csvError, setCsvError] = useState("");
  const [supplier, setSupplier] = useState("");
  const [draftId, setDraftId] = useState("");
  const [saving, setSaving] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    async function restore() {
      try {
        const response = await fetch("/api/drafts", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { drafts?: DraftRecord[] };
        const draft = data.drafts?.[0];
        if (!draft || cancelled) return;
        setDraftId(draft.id); setSupplier(draft.supplier); setSavedRefs(draft.files);
        setRuleText(JSON.stringify(draft.rules, null, 2)); setRuleLocked(true); setMap(draft.columnMap);
        const csvResponse = await fetch(`/api/drafts/${draft.id}/files/purchases`, { cache: "no-store" });
        if (csvResponse.ok) {
          const parsed = parseCsv(await csvResponse.text());
          if (!cancelled) { setHeaders(parsed.headers); setRows(parsed.rows.slice(0, 5)); }
        }
        const agreement = await fetch(`/api/drafts/${draft.id}/files/agreement`, { cache: "no-store" });
        if (agreement.ok && !cancelled) { objectUrl = URL.createObjectURL(await agreement.blob()); setPdfUrl(objectUrl); }
        if (!cancelled) setNotice(`Restored saved draft ${draft.id.slice(0, 8)} from ${data.drafts ? "persistent server storage" : "storage"}. Source files are still available.`);
      } catch { /* A new workspace remains usable when there is no saved draft. */ }
    }
    void restore();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, []);

  const mappedCount = useMemo(() => Object.keys(map).filter(field => map[field]).length, [map]);
  const requiredFields = useMemo(() => requiredCsvFields(), []);
  const mappingErrors = useMemo(() => headers.length ? validateCsvColumnMap(map, requiredFields).filter(error => !error.startsWith("Map the required field") || !OPTIONAL.has(error.slice(26).replaceAll(" ", "_"))) : [], [headers, map, requiredFields]);

  async function selectFile(role: StoredFileRole, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFiles(previous => ({ ...previous, [role]: file })); setNotice("");
    if (role === "agreement") {
      if (pdfUrl.startsWith("blob:")) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(file)); setRuleLocked(false); setRuleText(""); setExtractError(""); setExtracting(true);
      const request = new FormData(); request.set("pdf", file);
      try {
        const response = await fetch("/api/extract", { method: "POST", body: request });
        const data = await response.json() as { rules?: ExtractedSupplierRules; error?: string };
        if (!response.ok || !data.rules) throw new Error(data.error || "The agreement could not be extracted.");
        setRuleText(JSON.stringify(data.rules, null, 2));
      } catch (error) {
        setExtractError(error instanceof Error ? error.message : "The agreement could not be extracted.");
        setRuleText("");
      } finally { setExtracting(false); }
    }
    if (role === "purchases") {
      setCsvError("");
      try {
        const parsed = parseCsv(await file.text());
        const inferred = autoMapCsvHeaders(parsed.headers, EXPECTED);
        setHeaders(parsed.headers); setRows(parsed.rows.slice(0, 5)); setMap(inferred);
      } catch (error) { setHeaders([]); setRows([]); setMap({}); setCsvError(error instanceof Error ? error.message : "Could not read the CSV."); }
    }
  }

  function changeMapping(field: string, header: string) {
    setMap(previous => {
      const next = { ...previous };
      if (!header) delete next[field]; else next[field] = header;
      return next;
    });
  }

  async function save() {
    setNotice("");
    let rules: unknown;
    try { rules = JSON.parse(ruleText); } catch { setExtractError("Rules must be valid JSON before saving."); return; }
    if (!ruleLocked || !validateExtractedRules(rules)) { setExtractError("Lock only verified rules that have supported rates, methods, and page/clause citations."); return; }
    if (!files.agreement || !files.purchases) { setNotice("Choose an agreement PDF and purchase CSV for this saved draft. Previously saved source files remain available after reload."); return; }
    if (mappingErrors.length) { setNotice(mappingErrors[0]); return; }
    setSaving(true);
    try {
      const body = new FormData(); body.set("supplier", supplier); body.set("rules", JSON.stringify(rules)); body.set("columnMap", JSON.stringify(map));
      for (const role of ["agreement", "purchases", "credits"] as const) if (files[role]) body.set(role, files[role]!);
      const response = await fetch("/api/drafts", { method: "POST", body });
      const result = await response.json() as { draft?: DraftRecord; storage?: string; error?: string };
      if (!response.ok || !result.draft) throw new Error(result.error || "Could not save this audit draft.");
      setDraftId(result.draft.id); setSavedRefs(result.draft.files); setNotice(`Saved securely to ${result.storage}. Draft ID ${result.draft.id.slice(0, 8)}. Refresh this page to verify persistence.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not persist the audit draft."); }
    finally { setSaving(false); }
  }

  async function runReconciliation() {
    if (!draftId) return;
    setNotice(""); setReconciling(true);
    try {
      const response = await fetch(`/api/drafts/${draftId}/reconcile`, { method: "POST" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Reconciliation could not be completed.");
      router.push(`/dashboard/audits/${draftId}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Reconciliation could not be completed."); }
    finally { setReconciling(false); }
  }

  return <div className="dashboard-page upload-page">
    <div className="crumb-back"><Link href="/dashboard">← Back to overview</Link></div>
    <div className="page-header"><div><div className="eyebrow">NEW AUDIT WORKSPACE</div><h1>Upload supplier files</h1><p>Start with one supplier and a complete audit period.</p></div><span className="tag tag-neutral">STEP 1 OF 3</span></div>
    <div className="upload-layout"><div>
      <section className="panel upload-panel"><div className="panel-head"><div><h2>Source documents</h2><p>Choose each document by role so the agreement can never be confused with the credit statement.</p></div><span className="required-note">Agreement + purchases required</span></div>
        <div className="document-list">{(["agreement", "purchases", "credits"] as const).map(role => {
          const file = files[role]; const saved = savedRefs.find(ref => ref.role === role);
          return <div className="document-row" key={role}><span className={`doc-icon ${file || saved ? "doc-ready" : ""}`}>{role === "purchases" ? "CSV" : "PDF"}</span><span><b>{ROLE_LABELS[role]}</b><small>{file?.name || saved?.originalName || (role === "credits" ? "Optional · select a credit statement" : "Required · select a source file")}</small></span><label className="button button-secondary file-select">Choose file<input type="file" accept={ACCEPT[role]} onChange={event => void selectFile(role, event)}/></label><span className={file || saved ? "doc-status ready" : "doc-status"}>{file || saved ? "Added" : role === "credits" ? "Optional" : "Missing"}</span></div>;
        })}</div>
        <p className="form-note">Stored server-side for this workflow: local persistent filesystem in development, Netlify Blobs on Netlify. Netlify upload limit: 4 MB per file and 5 MB combined.</p>
      </section>

      {pdfUrl && <section className="panel verifier-panel"><div className="panel-head"><div><h2>Side-by-side rule verifier</h2><p>Source preview always uses the file selected in the Agreement field.</p></div><span className={`tag ${ruleLocked ? "tag-green" : "tag-amber"}`}>{ruleLocked ? "Rules verified" : "Review required"}</span></div><div className="verifier-grid"><div className="pdf-viewer"><div className="viewer-label">SOURCE AGREEMENT · {files.agreement?.name || savedRefs.find(ref => ref.role === "agreement")?.originalName}</div><iframe title="Supplier agreement PDF" src={pdfUrl}/></div><div className="rule-editor"><div className="viewer-label">STRUCTURED RULES · JSON</div>{extracting ? <div className="extract-loading">Reading agreement clauses…</div> : <><textarea aria-label="Editable extracted contract rules" spellCheck={false} value={ruleText} onChange={event => { setRuleText(event.target.value); setRuleLocked(false); }} readOnly={ruleLocked}/>{extractError && <p className="form-error" role="alert">{extractError} Correct the source or enter cited rules manually.</p>}<div className="verifier-actions"><span>{ruleLocked ? "Verified citations and calculation methods are saved with this draft." : "Check every rate and citation against the agreement PDF."}</span><button className="button button-primary" disabled={!validateSafely(ruleText)} onClick={() => { try { const parsed = JSON.parse(ruleText); if (!validateExtractedRules(parsed)) throw new Error("Rules need a calculation method and source page/clause citation."); setRuleLocked(value => !value); setExtractError(""); } catch (error) { setExtractError(error instanceof Error ? error.message : "Rules are not valid."); } }}>{ruleLocked ? "Unlock rules" : "Lock verified rules"}</button></div></>}</div></div></section>}

      {(headers.length > 0 || csvError) && <section className="panel mapping-panel"><div className="panel-head"><div><h2>Smart column mapping</h2><p>Each source column can map to one field. Required and optional fields are shown separately.</p></div><span className="tag tag-green"><i/> {mappedCount} mapped</span></div>{csvError && <p className="form-error" role="alert">{csvError}</p>}<div className="mapping-table"><div className="mapping-line mapping-head"><span>RebateLedger field</span><span>CSV column</span></div>{EXPECTED.map(field => {
        const assignedElsewhere = new Set(Object.entries(map).filter(([key]) => key !== field).map(([, value]) => value));
        const required = requiredFields.has(field);
        return <div key={field} className="mapping-line"><span>{field.replaceAll("_", " ")} <small>{required ? "Required" : "Optional"}</small></span><select aria-label={`${field} CSV column`} value={map[field] || ""} onChange={event => changeMapping(field, event.target.value)}><option value="">{required ? "Select required column" : "Not provided (optional)"}</option>{headers.map(header => <option key={header} value={header} disabled={assignedElsewhere.has(header)}>{header}</option>)}</select></div>;
      })}</div>{mappingErrors.length > 0 && <p className="form-error" role="alert">{mappingErrors[0]}</p>}{rows.length > 0 && <div className="preview-wrap"><b>Sample rows</b><div className="table-wrap"><table><thead><tr>{headers.slice(0, 5).map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(0, 3).map((row, index) => <tr key={index}>{row.slice(0, 5).map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div></div>}</section>}
    </div>
    <aside className="panel upload-side"><div className="eyebrow">AUDIT SETUP</div><h3>One supplier.<br/>One clear answer.</h3><p>Upload one supplier’s contract and quarter data. Extraction is deterministic and runs locally in the app; no AI API key is used.</p><label>Supplier name<input value={supplier} onChange={event => setSupplier(event.target.value)} placeholder="e.g. Carrier HVAC"/></label><div className="side-divider"/><div className="checkline"><span>✓</span><div><b>Contract terms</b><small>Extract, verify, and lock cited rules</small></div></div><div className="checkline"><span>✓</span><div><b>Purchase transactions</b><small>Map and review ERP headings</small></div></div><div className="checkline"><span>✓</span><div><b>Source file persistence</b><small>Retained server-side across reloads</small></div></div>{draftId && <p className="form-note">Current saved draft: {draftId}</p>}{notice && <p className="success-inline" role="status">{notice}</p>}<button className="button button-primary submit-wide" onClick={() => void save()} disabled={saving || extracting || !ruleLocked || !supplier.trim() || mappingErrors.length > 0}>{saving ? "Saving…" : "Save verified audit draft"}<span>→</span></button>{draftId && <button className="button button-dark submit-wide" onClick={() => void runReconciliation()} disabled={reconciling || !ruleLocked}>{reconciling ? "Reconciling…" : "Run reconciliation"}<span>→</span></button>}<p className="form-note">Reconciliation is blocked until the rules match the selected agreement and required source files are persisted.</p></aside></div>
  </div>;
}

function validateSafely(value: string) { try { return validateExtractedRules(JSON.parse(value)); } catch { return false; } }
