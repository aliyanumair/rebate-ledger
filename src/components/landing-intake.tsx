"use client";

import { FormEvent, useState } from "react";

export function LandingIntake() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const agreement = data.get("agreement") as File;
    const purchases = data.get("purchases") as File;
    if (!agreement?.name.toLowerCase().endsWith(".pdf")) { setError("Please choose a supplier agreement in PDF format."); return; }
    if (!purchases || !purchases.name.toLowerCase().endsWith(".csv")) { setError("Please choose an ERP purchase export in CSV format."); return; }
    const request = new FormData();
    request.set("name", String(data.get("name") || "")); request.set("company", String(data.get("company") || ""));
    request.set("email", String(data.get("email") || "")); request.set("supplier", String(data.get("supplier") || ""));
    request.set("pdf", agreement); request.set("csv", purchases);
    try {
      const response = await fetch("/api/intake", { method: "POST", body: request });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit the audit.");
      setError(""); setSent(true); form.reset();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not submit the audit."); }
  }
  if (sent) return <div className="intake-card intake-success"><div className="success-icon">✓</div><div className="eyebrow">REQUEST RECEIVED</div><h3>Your supplier is in the queue.</h3><p>Your files were added to the audit queue. A controller can review the submission from the admin workspace.</p><button className="button button-dark" onClick={() => setSent(false)}>Submit another supplier</button></div>;
  return <form className="intake-card" onSubmit={submit}><div className="form-card-head"><div><span className="tiny-label">GET STARTED</span><h3>Request your free audit</h3></div><span className="step-badge">01 / 01</span></div><label>Your name<input required name="name" placeholder="Jordan Lee"/></label><label>Company name<input required name="company" placeholder="Acme Mechanical Supply"/></label><div className="form-row"><label>Work email<input required name="email" type="email" placeholder="you@company.com"/></label><label>Supplier<input required name="supplier" placeholder="e.g. Carrier"/></label></div><label className="upload-field"><span><b>Supplier agreement (PDF)</b><small>Contract, rebate agreement, or SPA</small></span><span className="upload-button">Choose PDF</span><input required name="agreement" type="file" accept="application/pdf,.pdf"/></label><label className="upload-field"><span><b>Purchase export (CSV)</b><small>ERP transactions for your audit period</small></span><span className="upload-button">Choose CSV</span><input required name="purchases" type="file" accept=".csv"/></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary submit-wide" type="submit">Submit for review <span>→</span></button><p className="form-note">Your agreement and CSV are uploaded to the audit intake queue.</p></form>;
}
