# Rebate Ledger synthetic benchmark: sample_set_1

All names, contracts, supplier statements, invoices, prices, and customer records here are fabricated for software testing. They are not real business documents.

## Files

- `carrier_hvac_2026_rebate_agreement.pdf` — two-page agreement; retroactive quarterly tiers, excluded SKUs, freight/tax exclusion, and claim deadline.
- `kohler_spa_program_q3.pdf` — Q3 SPA with 15 supported items and three approved contractors.
- `wholesaler_erp_purchases_q3.csv` — exactly 1,500 rows with messy SKU formats, 25 returns, 25 freight/tax lines, excluded SKUs, and a tier-cliff near miss.
- `manufacturer_q3_credit_statement.csv` and `.pdf` — eight credit lines, including five deliberately underpaid credits.
- `benchmark_rules.json` — deterministic structured rules and citations for the synthetic documents.
- `expected_ground_truth.json` — expected totals and exact planted variances for assertions.
- `generate_benchmark.py` — reproducibly regenerates all CSV, JSON, and PDF artifacts (fixed seed).

## Expected results

Eligible Q3 Carrier spend is **$399,800.00**. Under Clause 2 this falls in the retroactive 2% tier, earning **$7,996.00**. Supplier credits total **$7,246.00**. The exact planted recovery is **$750.00**, with variance lines of $100, $125, $150, $175, and $200. Those credit memos reference ERP invoice transactions `INV-Q3-0001` through `INV-Q3-0005`; each is a $25,000 eligible invoice with an expected 2% credit of $500.

The benchmark is $200 below the $400,000 threshold. Reaching the 3% tier retroactively on $400,000 would increase the estimated rebate to $12,000, a **$4,004.00** tier opportunity compared with the current $7,996.00 rebate. This opportunity estimate is separate from the $750 current-period underpayment.

## Regenerate

Run from the repository root:

```bash
python data/benchmark/sample_set_1/generate_benchmark.py
```

The generator requires Python 3 and ReportLab. It asserts the exact $399,800 eligible base and $750.00 payout variance before completing.
