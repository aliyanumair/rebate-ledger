"use client";

import { useState } from "react";
import Decimal from "decimal.js";

export function LeakageCalculator() {
  const [revenue, setRevenue] = useState("25000000");
  const [suppliers, setSuppliers] = useState("20");
  const valid = /^\d{1,12}(\.\d{0,2})?$/.test(revenue) && /^\d{1,4}$/.test(suppliers) && new Decimal(suppliers).gte(1);
  const money = (amount: Decimal) => "$" + amount.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const annual = valid ? new Decimal(revenue) : new Decimal(0);
  const low = annual.mul("0.025");
  const high = annual.mul("0.04");
  return <div className="calculator-card">
    <div className="calc-inputs"><label htmlFor="annual-revenue">Annual wholesale revenue (USD/CAD)<input id="annual-revenue" type="number" min="0" max="999999999999" step="0.01" inputMode="decimal" value={revenue} onChange={event => setRevenue(event.target.value)} /></label><label htmlFor="supplier-count">Number of suppliers<input id="supplier-count" type="number" min="1" max="9999" step="1" inputMode="numeric" value={suppliers} onChange={event => setSuppliers(event.target.value)} /></label></div>
    <div className="calc-result" aria-live="polite"><div><small>Illustrative annual missed-rebate scenario · 2.5%–4%</small><strong>{valid ? `${money(low)} – ${money(high)}` : "Enter valid inputs"}</strong></div></div>
    {valid && <p className="calc-per-supplier">Equal-share scenario: {money(low.div(suppliers))} – {money(high.div(suppliers))} per supplier.</p>}
    {!valid && <p className="form-error" role="alert">Enter a nonnegative revenue amount (up to 12 digits) and 1–9,999 suppliers.</p>}
    <a href="#free-audit" className="button button-dark">Verify one supplier <span>→</span></a>
    <small className="fine-print">Illustration, not an industry benchmark or a verified recovery estimate. Revenue is not qualifying spend. The 2.5%–4% assumption is a planning scenario; supplier count only divides that scenario equally. Actual earned rebates require verified contract rules and eligible transactions.</small>
  </div>;
}
