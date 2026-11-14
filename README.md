# RebateLedger

Local-first rebate reconciliation workspace for HVAC and plumbing distributors. It extracts cited contract rules, maps ERP CSV columns one-to-one, keeps source files attached to explicit roles, and provides exact-decimal reconciliation reports.

## Run locally

Requirements: Node.js 22 and Python 3. Install the Python `reportlab` package only if you regenerate the synthetic PDFs.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Demo accounts

| Workspace | Email | Password |
|---|---|---|
| Client Controller | `controller@acme-hvac.com` | `Demo1234!` |
| Founder Admin | `admin@rebateledger.com` | `Admin1234!` |

These accounts and source credentials are for local and non-production preview evaluation only. Production login must use a unique `SESSION_SECRET` and replace the demo authentication with customer-managed accounts before release.

## Synthetic benchmark

`data/benchmark/sample_set_1` contains only fabricated documents and transactions. It includes a two-page rebate agreement, a 15-SKU SPA, 1,500 ERP rows, and a credit statement with five planted short payments.

Verified benchmark results:

| Measure | Result |
|---|---:|
| Eligible purchases | $399,800.00 |
| Rebate earned | $7,996.00 |
| Supplier paid | $7,246.00 |
| Current-period underpayment | $750.00 |
| Quarter-end tier opportunity | $4,004.00 |

The tier estimate is reported separately and is not included in current-period rebate earned or underpayment. Freight/tax lines, RMAs/returns, excluded SKUs, and unmatched SKUs are classified separately and excluded from eligible spend. The synthetic rules use retroactive-to-first-dollar tiers and cited Clauses 2, 4.1, 4.2, and 7.1.

Regenerate the fixtures with:

```bash
npm run generate:benchmark
```

The generator uses a fixed seed and asserts the exact qualifying spend and statement variance.

## Upload workflow and storage

1. Sign in as a controller and open **Upload supplier files**.
2. Select the agreement, purchase CSV, and optional credit statement in their labeled roles. The agreement preview and extractor always use the Agreement field.
3. Review the deterministic extracted terms and citations. Rules without a recognized calculation method and page/clause citations cannot be locked or saved.
4. Confirm the one-to-one CSV field mapping. Required fields must be mapped; optional absent fields remain explicitly marked optional.
5. Save the verified draft. Draft metadata and original file bytes are stored server-side and can be restored after a reload or a fresh login.

Local development writes to `data/runtime` (or `REBATE_DATA_DIR`) and requires a persistent volume if hosted outside the developer machine. Netlify deployments use a site-wide `@netlify/blobs` store; production and non-production keys have separate namespaces. Netlify Blobs persists across deploys, with strong consistency requested for this workflow. Blob storage is listed as available on Netlify Free; the account’s overall usage is still subject to Netlify’s current monthly credit allowance and limits. See [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) and [Netlify plan details](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/).

Netlify Functions have a documented 6 MB buffered request/response limit. The app therefore limits each file to 4 MB and the combined multipart upload to 5 MB to leave room for request fields and multipart boundaries. Larger files must be compressed or split before upload. Netlify Blobs stores individual objects up to 5 GB, but the Functions request limit applies before the file reaches Blobs.

No paid API key or third-party AI service is used. PDF text extraction is deterministic; the app explicitly loads the native canvas dependency required by PDF.js for `DOMMatrix`. Scanned PDFs with no extractable text return an actionable error and must be OCR’d or entered manually. Files are not sent to OpenAI, Anthropic, or another model provider.

## Checks

```bash
npx tsc --noEmit
npm run typecheck
npm run lint
npm run test:reconciliation
npm run test:routes
npm run build
```

`test:reconciliation` asserts exact benchmark cents, PDF citation extraction, CSV quoting and mapping, and generated XLSX/PDF validity. `test:routes` starts a production server and checks route status, extraction errors, auth roles, saved file bytes after a fresh authenticated session, seeded results, and exports.

## Netlify preview and release

Netlify uses `npm run build` and the Next.js framework adapter. Configure `SESSION_SECRET` in Netlify for non-local authenticated previews. Do not merge the repair branch or promote a deploy preview to production without reviewing its diff and explicitly approving the release.
