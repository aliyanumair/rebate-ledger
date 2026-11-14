# Rebate Ledger

A local-first rebate reconciliation workspace for HVAC and plumbing distributors. It turns supplier program documents and ERP purchases into a reviewable, exact-decimal audit, with downloadable Excel and dispute-letter exports.

## Start locally

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Demo accounts

| Workspace | Email | Password |
|---|---|---|
| Client Controller | controller@acme-hvac.com | Demo1234! |
| Founder Admin | admin@rebateledger.com | Admin1234! |

The seeded credentials are for local evaluation only. For a deployment, set unique `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DEMO_EMAIL`, and `DEMO_PASSWORD` values in the host's secret/environment settings. Production does not fall back to the seeded passwords. `CONTROLLER_PASSWORD` remains supported as a legacy alias for `DEMO_PASSWORD`.

## Run verification

```bash
npm run typecheck
npm run lint
npm run test:reconciliation
npm run build
npm run test:routes
```

`data/benchmark/sample_set_1` contains synthetic contract PDFs, ERP purchases, credit statement, and ground truth. `npm run generate:benchmark` regenerates them deterministically.

## Data and deployment

The local demo stores the intake queue and uploaded files under `data/runtime` (or `REBATE_DATA_DIR`). Keep that folder private and back it up. A Vercel Function has only ephemeral writable scratch space; this no-key demo can run there, but upload persistence is not durable across serverless instances/redeployments. For durable production intake, configure a persistent storage adapter and database/object store. The deterministic reconciliation engine itself has no API-key or paid-service dependency.

Optional `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` environment variables are reserved for future extraction assistance. They are not required for the local deterministic rule extractor, reconciliation, or exports.

## Workflow

1. Upload a supplier contract/SPA PDF and purchase CSV, or use the sample benchmark.
2. Review the extracted rules and source citations beside the PDF.
3. Confirm the CSV column mapping and rule set before running the calculation.
4. Inspect classified transaction lines and variance totals.
5. Export the four-tab audit workbook and one-page dispute PDF.

All sample data and credentials are synthetic. Rebate rules should be reviewed against the governing agreement before a claim is sent.
