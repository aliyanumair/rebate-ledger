#!/usr/bin/env python3
"""Regenerate the deterministic synthetic Rebate Ledger benchmark data."""
from __future__ import annotations

import csv
import json
import random
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
CENT = Decimal("0.01")
SEED = 20261114


def money(value: Decimal) -> str:
    return str(value.quantize(CENT, rounding=ROUND_HALF_UP))


def write_pdf(path: Path, title: str, pages: list[list[str]]) -> None:
    c = canvas.Canvas(str(path), pagesize=letter)
    width, height = letter
    for page_num, lines in enumerate(pages, 1):
        c.setFont("Helvetica-Bold", 15)
        c.drawString(54, height - 54, title)
        c.setFont("Helvetica", 9)
        c.drawString(54, height - 70, "SYNTHETIC TRAINING DOCUMENT — NOT A REAL SUPPLIER CONTRACT")
        y = height - 104
        for line in lines:
            if line.startswith("## "):
                y -= 7
                c.setFont("Helvetica-Bold", 11)
                c.drawString(54, y, line[3:])
                c.setFont("Helvetica", 9)
                y -= 17
            else:
                words = line.split()
                wrapped: list[str] = []
                current = ""
                for word in words:
                    candidate = (current + " " + word).strip()
                    if c.stringWidth(candidate, "Helvetica", 9) > width - 108:
                        wrapped.append(current)
                        current = word
                    else:
                        current = candidate
                if current:
                    wrapped.append(current)
                for row in wrapped:
                    c.drawString(54, y, row)
                    y -= 14
            if y < 58:
                break
        c.setFont("Helvetica-Oblique", 8)
        c.drawString(54, 34, f"Synthetic example | Page {page_num} of {len(pages)}")
        c.showPage()
    c.save()


def make_contract() -> None:
    write_pdf(HERE / "carrier_hvac_2026_rebate_agreement.pdf", "Carrier HVAC — 2026 Quarterly Rebate Agreement", [
        ["## 1. Program term and eligible purchases",
         "This synthetic agreement applies to eligible net purchases invoiced to Acme HVAC Supply from January 1 through December 31, 2026. Quarter-end volume is measured on invoice date. Net eligible purchases exclude returned goods, freight, delivery charges, sales tax, and the excluded parts in Schedule A.",
         "## 2. Quarterly volume rebate tiers",
         "The quarterly rebate rate applies retroactively to the first eligible dollar once the relevant threshold is reached. Eligible quarterly spend of $50,000.00 through $399,999.99 earns 2%. Spend of $400,000.00 or more earns 3%. Rates are not incremental or stacked.",
         "Example: $125,000.00 of eligible quarterly spend earns $2,500.00 (2% × $125,000.00).",
         "## 3. Returns and credits",
         "Eligible credits and returns reduce the eligible net purchase base in the quarter in which the original invoice is credited. A return transaction itself is never a positive eligible purchase.",
         "## 4. Exclusions",
         "4.1 Excluded parts: CARR-CTRL-099, CARR-FILTER-000, and CARR-LEGACY-404 are not qualifying products."],
        ["## 4. Exclusions (continued)",
         "4.2 Freight, shipping, handling, delivery, fuel surcharges, and taxes are excluded from eligible spend, even when included on a product invoice.",
         "## 5. Payment and statement reconciliation",
         "Supplier credit statements should identify the applicable quarter and credit memo. Buyer may request supporting detail for any variance between rebate earned and rebate credited.",
         "## 7. Claims",
         "7.1 A written rebate claim with supporting invoice-level records must be received within 45 calendar days after quarter end. For Q3 2026, the claim deadline is November 14, 2026.",
         "## Schedule A — excluded parts and examples",
         "The following product codes are excluded: CARR-CTRL-099 (legacy wall control), CARR-FILTER-000 (service filter), CARR-LEGACY-404 (discontinued board).",
         "Qualifying example products include Carrier residential and light-commercial HVAC equipment listed in the buyer price book. A SKU must be normalized to a listed qualifying item before being counted.",
         "Source citation guide: tier terms page 1 Clause 2; excluded parts page 1 Clause 4.1; freight page 2 Clause 4.2; deadline page 2 Clause 7.1.",
         "This agreement and its examples are invented solely for software testing. No actual Carrier terms, claims, or commercial relationship are represented."],
    ])


def make_spa() -> None:
    skus = [f"KOH-{i:04d}" for i in range(1, 16)]
    rows = ["## Q3 2026 approved item schedule",
            "This synthetic Special Pricing Agreement (SPA) is valid July 1–September 30, 2026. Approved contractors: Apex Mechanical LLC; Blue River Plumbing & HVAC; Northstar Building Services.",
            "Eligible claim quantity is limited to purchases by an approved contractor for an identified project. Claims must reference the invoice and customer/project.",
            "## Clause 3.2 — SKU-specific supported price schedule",
            "SKU | Standard into-stock cost | Supported SPA price"]
    for i, sku in enumerate(skus, 1):
        standard = Decimal(35 + i * 13).quantize(CENT)
        spa = (standard * Decimal("0.82")).quantize(CENT)
        rows.append(f"{sku} | ${money(standard)} | ${money(spa)}")
    rows += ["## Claimback and exclusions",
             "The difference between standard into-stock cost and supported SPA price is reimbursable only for approved contractor/project sales. Duplicate claims and returned quantities are not payable.",
             "Claim must be submitted within 45 days after quarter end. Clause 3.1: contractor and project approval. Clause 3.2: SKU-specific supported price. Clause 5.1: claimback and return restrictions.",
             "Synthetic test content only; no real supplier, customer, or pricing agreement is represented."]
    write_pdf(HERE / "kohler_spa_program_q3.pdf", "Kohler — Q3 2026 Special Pricing Agreement", [rows[:10], rows[10:]])


def make_purchases() -> tuple[Decimal, list[dict[str, str]]]:
    rng = random.Random(SEED)
    products = [f"CARR-{i:03d}" for i in range(1, 31)]
    names = ["Apex Mechanical LLC", "Blue River Plumbing & HVAC", "Northstar Building Services", "Metro Climate Systems", "Acme HVAC Service"]
    descriptions = ["Variable-speed condenser", "Air handler assembly", "Heat pump outdoor unit", "Evaporator coil", "Thermostat control", "Refrigerant line kit", "Blower motor assembly", "Commercial rooftop unit"]
    records: list[dict[str, str]] = []
    eligible = Decimal("0.00")
    # 1,430 qualifying product invoices sum to exactly $399,800.00, a $200 near miss for the $400k tier.
    for i in range(1, 1431):
        sku = rng.choice(products)
        if i <= 5:
            # Five transparent $25k invoice bundles let planted credit variances map
            # directly to ERP invoices at the contract's 2% rate.
            qty = 20
            cost = Decimal("1250.00")
            ext = Decimal("25000.00")
        else:
            qty = rng.choice([1, 1, 1, 2, 3])
            cost = Decimal(rng.randrange(1_000, 4_500) / 100).quantize(CENT)
            ext = (cost * qty).quantize(CENT)
        # IDs for the five underpayment references are deliberately part of the ERP export.
        txn_id = f"INV-Q3-{i:04d}"
        if i == 1430:
            ext = Decimal("399800.00") - eligible
            qty = 1
            cost = ext
            ext = (cost * qty).quantize(CENT)
        eligible += ext
        raw_sku = sku if i % 4 else sku.lower().replace("-", " ")
        if i % 11 == 0:
            raw_sku = f" {raw_sku} "
        records.append({
            "txn_id": txn_id,
            "date": f"2026-{7 + ((i - 1) // 477):02d}-{1 + (i % 27):02d}",
            "vendor_name": "Carrier Distribution East",
            "sku": raw_sku,
            "description": rng.choice(descriptions),
            "qty": str(qty),
            "unit_cost": money(cost),
            "extended_cost": money(ext),
            "customer_name": rng.choice(names),
            "project_code": f"PRJ-{rng.randrange(1000, 9999)}",
            "txn_type": "INVOICE",
        })
    if eligible != Decimal("399800.00"):
        raise AssertionError(f"Synthetic spend is {eligible}, expected 399800.00")
    # 25 RMA returns; 25 freight/tax lines; 20 excluded non-qualifying SKUs.
    for i in range(1431, 1456):
        sku = rng.choice(products)
        amount = Decimal(rng.randrange(2500, 25000) / 100).quantize(CENT)
        records.append({"txn_id": f"RMA-Q3-{i:04d}", "date": f"2026-09-{1 + (i % 27):02d}", "vendor_name": "Carrier Distribution East",
                        "sku": sku, "description": "Customer return — credit memo", "qty": "-1", "unit_cost": money(amount),
                        "extended_cost": money(-amount), "customer_name": rng.choice(names), "project_code": f"PRJ-{rng.randrange(1000,9999)}", "txn_type": "RMA"})
    for i in range(1456, 1481):
        amount = Decimal(rng.randrange(1500, 12000) / 100).quantize(CENT)
        records.append({"txn_id": f"CHG-Q3-{i:04d}", "date": f"2026-09-{1 + (i % 27):02d}", "vendor_name": "Carrier Distribution East",
                        "sku": "FREIGHT" if i % 2 else "TAX", "description": "Freight / delivery / sales tax", "qty": "1", "unit_cost": money(amount),
                        "extended_cost": money(amount), "customer_name": rng.choice(names), "project_code": f"PRJ-{rng.randrange(1000,9999)}", "txn_type": "CHARGE"})
    excluded = ["CARR-CTRL-099", "CARR-FILTER-000", "CARR-LEGACY-404"]
    for i in range(1481, 1501):
        sku = excluded[i % len(excluded)]
        amount = Decimal(rng.randrange(3500, 35000) / 100).quantize(CENT)
        records.append({"txn_id": f"INV-Q3-{i:04d}", "date": f"2026-09-{1 + (i % 27):02d}", "vendor_name": "Carrier Distribution East",
                        "sku": sku, "description": "Excluded service part", "qty": "1", "unit_cost": money(amount),
                        "extended_cost": money(amount), "customer_name": rng.choice(names), "project_code": f"PRJ-{rng.randrange(1000,9999)}", "txn_type": "INVOICE"})
    fields = ["txn_id", "date", "vendor_name", "sku", "description", "qty", "unit_cost", "extended_cost", "customer_name", "project_code", "txn_type"]
    with (HERE / "wholesaler_erp_purchases_q3.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(records)
    return eligible, records


def make_statement(eligible: Decimal, purchase_records: list[dict[str, str]]) -> dict[str, object]:
    earned = (eligible * Decimal("0.02")).quantize(CENT)
    underpays = [Decimal("100.00"), Decimal("125.00"), Decimal("150.00"), Decimal("175.00"), Decimal("200.00")]
    rows: list[dict[str, str]] = []
    allocated = Decimal("0.00")
    for i, transaction in enumerate(purchase_records[:1430], 1):
        basis = Decimal(transaction["extended_cost"])
        expected = earned - allocated if i == 1430 else (earned * basis / eligible).quantize(CENT, rounding=ROUND_DOWN)
        allocated += expected
        short = underpays[i - 1] if i <= len(underpays) else Decimal("0.00")
        rows.append({"credit_memo_id": f"CM-Q3-26-{i:03d}", "reference_invoice_id": transaction["txn_id"],
                     "period": "Q3 2026", "eligible_spend_basis": money(basis), "rebate_rate": "2.00%",
                     "expected_credit": money(expected), "paid_credit": money(expected - short), "variance": money(short),
                     "status": "UNDERPAID" if short else "PAID_AS_EXPECTED"})
    with (HERE / "manufacturer_q3_credit_statement.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    paid = sum((Decimal(x["paid_credit"]) for x in rows), Decimal("0.00"))
    underpaid = sum(underpays, Decimal("0.00"))
    write_pdf(HERE / "manufacturer_q3_credit_statement.pdf", "Carrier Distribution — Q3 2026 Credit Statement", [
        ["## Account summary",
         "Customer: Acme HVAC Supply (synthetic training account)",
         "Program: 2026 Quarterly Rebate Agreement, Q3 2026",
         f"Eligible spend reported: ${money(eligible)} | Contract tier: 2% | Rebate earned: ${money(earned)}",
         f"Credits paid: ${money(paid)} | Open variance shown by benchmark: ${money(underpaid)}",
         "## Credit detail",
         "Five credits below were intentionally paid short in this benchmark. The CSV has a statement line for each eligible invoice; all remaining invoice credits were paid as expected."] + [f"{r['credit_memo_id']} | Invoice {r['reference_invoice_id']} | Expected ${r['expected_credit']} | Paid ${r['paid_credit']} | Variance ${r['variance']}" for r in rows[:5]],
        ["## Statement detail and reconciliation note"] + [f"Sample paid credit: {r['credit_memo_id']} | Invoice {r['reference_invoice_id']} | Expected ${r['expected_credit']} | Paid ${r['paid_credit']}" for r in rows[5:8]] + [
            "This file is invented for software testing. Supplier, customer, transaction, and credit data do not represent real entities or financial records."]
    ])
    gt = {
        "benchmark_id": "sample_set_1",
        "synthetic_only": True,
        "currency": "USD",
        "period": "Q3 2026",
        "qualifying_purchase_rows": 1430,
        "gross_eligible_spend": money(eligible),
        "tier": {"rate": "2.00%", "threshold": "50000.00", "next_threshold": "400000.00", "next_rate": "3.00%", "gap_to_next_tier": "200.00", "rebate_at_current_tier": money(earned), "rebate_at_next_tier": "12000.00", "quarter_end_tier_opportunity": "4004.00"},
        "rebate_earned": money(earned),
        "supplier_paid": money(paid),
        "unclaimed_recovery_found": money(underpaid),
        "variance": money(underpaid),
        "planted_underpayments": [{"credit_memo_id": r["credit_memo_id"], "reference_invoice_id": r["reference_invoice_id"], "expected_credit": r["expected_credit"], "paid_credit": r["paid_credit"], "recovery": r["variance"]} for r in rows if r["status"] == "UNDERPAID"],
        "planted_recovery_total": money(underpaid),
        "payout_reconciliation": "rebate_earned - supplier_paid = planted_recovery_total",
        "claim_deadline": "2026-11-14",
        "citations": {"tier": "carrier_hvac_2026_rebate_agreement.pdf, page 1, Clause 2", "freight_exclusion": "page 2, Clause 4.2", "deadline": "page 2, Clause 7.1"},
        "statement_mapping_note": "Each CM-Q3-26-001 through CM-Q3-26-005 references the matching ERP transaction INV-Q3-0001 through INV-Q3-0005. Each reference invoice has exactly $25,000.00 of eligible spend; at 2%, its expected credit is $500.00. The statement's five planted short payments total $750.00.",
    }
    (HERE / "expected_ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n", encoding="utf-8")
    rules = {
        "supplier": "Carrier Distribution East",
        "program": "Carrier HVAC 2026 Quarterly Rebate Agreement",
        "period": "Q3 2026",
        "currency": "USD",
        "tiers": [
            {"minimum_spend": "50000.00", "maximum_spend_exclusive": "400000.00", "rate": "0.02", "method": "retroactive_to_first_dollar"},
            {"minimum_spend": "400000.00", "maximum_spend_exclusive": None, "rate": "0.03", "method": "retroactive_to_first_dollar"},
        ],
        "excluded_skus": ["CARR-CTRL-099", "CARR-FILTER-000", "CARR-LEGACY-404"],
        "excluded_freight_terms": ["freight", "shipping", "handling", "delivery", "fuel surcharge", "sales tax", "tax"],
        "excluded_transaction_types": ["RMA"],
        "claim_deadline_days_after_quarter_end": 45,
        "quarter_end": "2026-09-30",
        "claim_deadline": "2026-11-14",
        "citations": {
            "tiers": {"document": "carrier_hvac_2026_rebate_agreement.pdf", "page": 1, "clause": "2"},
            "excluded_skus": {"document": "carrier_hvac_2026_rebate_agreement.pdf", "page": 2, "clause": "4.1"},
            "freight_and_tax": {"document": "carrier_hvac_2026_rebate_agreement.pdf", "page": 2, "clause": "4.2"},
            "deadline": {"document": "carrier_hvac_2026_rebate_agreement.pdf", "page": 2, "clause": "7.1"},
        },
        "spa_program": {
            "supplier": "Kohler Supply (synthetic)",
            "program": "Kohler Q3 2026 Special Pricing Agreement",
            "approved_contractors": ["Apex Mechanical LLC", "Blue River Plumbing & HVAC", "Northstar Building Services"],
            "claim_method": "standard_into_stock_cost_minus_supported_spa_price",
            "claims_require_project_code": True,
            "duplicate_or_returned_quantities_payable": False,
            "items": [{"sku": f"KOH-{i:04d}", "standard_cost": money(Decimal(35 + i * 13)), "supported_spa_price": money((Decimal(35 + i * 13) * Decimal("0.82")).quantize(CENT))} for i in range(1, 16)],
            "citation": {"document": "kohler_spa_program_q3.pdf", "page": 1, "clause": "3.1-3.2; 5.1"},
        },
        "planted_statement_variances": [{
            "credit_memo_id": f"CM-Q3-26-{i:03d}", "reference_invoice_id": f"INV-Q3-{i:04d}",
            "expected_credit": "500.00", "paid_credit": money(Decimal("500.00") - short), "recovery": money(short),
        } for i, short in enumerate(underpays, 1)],
        "statement_totals": {"rebate_earned": money(earned), "supplier_paid": money(paid), "recovery": money(underpaid)},
    }
    (HERE / "benchmark_rules.json").write_text(json.dumps(rules, indent=2) + "\n", encoding="utf-8")
    assert earned - paid == underpaid == Decimal("750.00")
    return gt


def main() -> None:
    HERE.mkdir(parents=True, exist_ok=True)
    make_contract()
    make_spa()
    eligible, records = make_purchases()
    gt = make_statement(eligible, records)
    print(json.dumps({"generated": len(records), "eligible_spend": money(eligible), "recovery": gt["unclaimed_recovery_found"]}, indent=2))


if __name__ == "__main__":
    main()
