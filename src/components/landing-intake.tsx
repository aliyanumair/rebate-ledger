"use client";

import { FormEvent, useState } from "react";

export function LandingIntake() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agreementName, setAgreementName] = useState("");
  const [purchaseName, setPurchaseName] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const form = e.currentTarget;
    const data = new FormData(form);
    const agreement = data.get("agreement") as File;
    const purchases = data.get("purchases") as File;
    if (!agreement?.name.toLowerCase().endsWith(".pdf") || !agreement.size) { setError("Please choose a nonempty supplier agreement PDF."); return; }
    if (!purchases?.name.toLowerCase().endsWith(".csv") || !purchases.size) { setError("Please choose a nonempty ERP purchase CSV."); return; }
    if (agreement.size > 10 * 1024 * 1024 || purchases.size > 10 * 1024 * 1024) { setError("Each file must be 10 MB or smaller."); return; }
    const request = new FormData();
    request.set("name", String(data.get("name") || "").trim()); request.set("company", String(data.get("company") || "").trim());
    request.set("email", String(data.get("email") || "").trim()); request.set("supplier", String(data.get("supplier") || "").trim());
    request.set("pdf", agreement); request.set("csv", purchases);
    setBusy(true);
    try {
      const response = await fetch("/api/intake", { method: "POST", body: request });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit the audit.");
      setSent(true); setAgreementName(""); setPurchaseName(""); form.reset();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not submit the audit. Your selected files are still here; please retry."); }
    finally { setBusy(false); }
  }
  if (sent) return <div className="intake-card intake-success" role="status"><div className="success-icon">✓</div><div className="eyebrow">REQUEST RECEIVED</div><h3>Your supplier is in the review queue.</h3><p>Your files were added to the admin intake queue. This confirms receipt, not a completed audit or a verified recovery.</p><button className="button button-dark" onClick={() => setSent(false)}>Submit another supplier</button></div>;
  return <form className="intake-card" onSubmit={submit} aria-busy={busy}><div className="form-card-head"><div><span className="tiny-label">NO CARD REQUIRED</span><h3>Free 1-supplier settled audit</h3></div><span className="step-badge">01 / 01</span></div><label>Your name<input required maxLength={120} name="name" autoComplete="name" placeholder="Jordan Lee"/></label><label>Company name<input required maxLength={200} name="company" autoComplete="organization" placeholder="Acme Mechanical Supply"/></label><div className="form-row"><label>Work email<input required maxLength={254} name="email" type="email" autoComplete="email" placeholder="you@company.com"/></label><label>Supplier<input required maxLength={200} name="supplier" placeholder="e.g. Carrier"/></label></div><label className="upload-field"><span><b>Supplier agreement (PDF)</b><small>{agreementName || "Contract, rebate agreement, or SPA · max 10 MB"}</small></span><span className="upload-button">Choose PDF</span><input required name="agreement" type="file" accept="application/pdf,.pdf" onChange={e => setAgreementName(e.target.files?.[0]?.name || "")}/></label><label className="upload-field"><span><b>Purchase export (CSV)</b><small>{purchaseName || "ERP transactions for your audit period · max 10 MB"}</small></span><span className="upload-button">Choose CSV</span><input required name="purchases" type="file" accept=".csv" onChange={e => setPurchaseName(e.target.files?.[0]?.name || "")}/></label>{error && <p className="form-error" role="alert">{error}</p>}<button disabled={busy} className="button button-primary submit-wide" type="submit">{busy ? "Uploading securely…" : "Submit Free 1-Supplier Settled Audit"}<span aria-hidden="true">→</span></button><p className="form-note">Send only files you are authorized to share. The audit intake queue is restricted to the admin review team.</p></form>;
}
