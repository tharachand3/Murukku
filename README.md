# Murukku

Murukku is an Order-to-Audit prototype for a small snack factory. It records sales orders, GST invoices, dispatches and payments alongside
raw-material purchases, BOM-based production, finished stock, costing and monthly reports. Every business event is entered once; inventory
and reports are derived from the documents and the append-only stock ledger.

What it does:
- Records salesman orders and lets ADMIN approve, invoice and dispatch them.
- Calculates GST, creates invoice PDFs and tracks payments and outstanding.
- Records purchases, BOM issues, production output, damaged materials and variance.
- Calculates weighted-average material rates and per-good-packet run costs.
- Connects the sales and production loops through finished-goods stock.

## Quick start A: Docker

Prerequisites: Docker Desktop with Docker Compose, and Git.

```sh
git clone https://github.com/tharachand3/Murukku.git
cd Murukku
docker compose up -d --build
```

Open [http://localhost:8080](http://localhost:8080). The API applies migrations and seeds demo data when the stack starts.

All six accounts use the password `Demo@123`. These accounts are demo data for evaluators.

| Role | Email |
| --- | --- |
| ADMIN | `admin@demo.com` |
| PRODUCTION | `production@demo.com` |
| SALESMAN A | `salesman.a@demo.com` |
| SALESMAN B | `salesman.b@demo.com` |
| ACCOUNTANT | `accountant@demo.com` |
| OWNER | `owner@demo.com` |

Check the running stack from the repository root:

```sh
npm run docker:smoke
```

The smoke check verifies the API health response, demo login, authenticated session, stock summary, SPA fallback, JSON API 404, and role
denial. Stop the stack with `docker compose down`.

## Quick start B: local development

Prerequisites: Node.js 20 and Docker Desktop.

Clone the repository as in Quick start A, then start PostgreSQL:

```sh
npm run db:up
```

Copy the backend environment template and edit the local settings:

```powershell
Copy-Item backend\.env.example backend\.env
```

`backend/.env.example` contains the local database URLs, port and CORS origin. Set `JWT_SECRET` to a private random value before using the app
beyond a local demo. The default development database is `oda` on port `5433`.

Apply migrations and create the demo data. Run these commands from `backend/`:

```sh
npx prisma migrate deploy
npx prisma generate
npm run seed
```

Start the backend and frontend in separate terminals at the repository root:

```sh
npm run dev:backend
```

```sh
npm run dev:frontend
```

The Vite development server opens on port `5173` and proxies `/api` requests to the backend. Sign in with any of the
demo accounts listed above.

### Test database setup

The tests require a separate migrated database named `oda_test`. Start the Compose database first. Create the test database with the
command used in [docs/PROGRESS.md](docs/PROGRESS.md):

```sh
docker compose exec -T db createdb -U oda oda_test
```

Set `DATABASE_URL` to `postgresql://oda:oda@localhost:5433/oda_test?schema=public`, then run `npx prisma migrate deploy` and `npx prisma generate` from `backend/`. Restore the development
database URL after migration and before starting the app. Tests refuse to run against a non-test database.

## Prove the benchmark in two minutes

Run the end-to-end benchmark from `backend/` against a healthy local API at `http://localhost:4000`:

```sh
npm run bench:full -- --reset
```

The `--reset` option resets and reseeds the connected database. Use only a disposable benchmark database; do not run it against
development data. The runner plays all nine public-API benchmark steps, checks reports and exports, invoice PDF and cost sheet, and verifies
final ledger balances. A successful run prints `BENCHMARK PASSED: 36/36 checks`. The most recent recorded run also reported 2 informational checks and 20
stage-specific skips; the runner's success summary counts passing checks, not skipped stages.

The recorded benchmark outcomes and browser walkthrough are in [docs/BENCHMARK.md](docs/BENCHMARK.md) and [docs/UI_BENCHMARK_CHECKLIST.md](docs/UI_BENCHMARK_CHECKLIST.md).

Run the backend tests from `backend/`:

```sh
npm test
```

Run the frontend tests from the repository root:

```sh
npm --prefix frontend test
```

The latest fully recorded backend suite passed 381 tests. The latest recorded full frontend run had 259 passing tests and 8 existing UI
assertion failures; the focused UI and app-shell suites passed 14/14. These counts describe the recorded test runs, not a claim that the
full frontend suite is currently green.

## Benchmark scenario and expected results

The benchmark starts from the seeded demo company, opening balances and BOM. The values below come from the benchmark specification and
recorded run in [docs/BENCHMARK.md](docs/BENCHMARK.md).

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Purchase 60 kg flour at Rs 45/kg | Flour increases from 100 kg to 160 kg. |
| 2 | Issue 40 kg flour, 10.5 l oil and 1.2 kg spice | Flour 120 kg, oil 19.5 l, spice 3.8 kg remain. |
| 3 | Complete one run: 188 good packets, 6 pouch scrap, 9 cartons | Pouches 306, cartons 21, finished stock 238; yield -6.00% and oil +5.00% flagged. |
| 4 | SALESMAN A submits 150 packets for Retailer A | Taxable order value is Rs 7,500. |
| 5 | ADMIN approves, invoices and dispatches the order | Rs 7,500 + Rs 187.50 CGST + Rs 187.50 SGST = Rs 7,875; finished stock is 88. |
| 6 | SALESMAN B requests 120 packets for Distributor B | 88 are free; the submitted order is short by 32. Full-order preview is Rs 6,000 + Rs 300 IGST = Rs 6,300. |
| 7 | Record Rs 4,000 payment from Retailer A | Outstanding balance is Rs 3,875. |
| 8 | Add Rs 1,200 labour and Rs 600 power/gas overhead | Cost is Rs 5,855 total, Rs 31.14 per good packet; margin is 37.71%. |
| 9 | Generate monthly reports and exports | Ten reports are registered; CSV, XLSX and PDF exports are available. |

The variance threshold is 3.00%, and a variance is flagged only when its absolute value is strictly greater than the threshold:

- Cartons: 9 used versus 10 planned is -10.00%, so it is flagged.
- Pouches: 194 issued (188 used plus 6 damaged) versus 200 planned is -3.00%,
  exactly the threshold, so it is not flagged.

See [docs/BENCHMARK.md](docs/BENCHMARK.md) for recorded actuals and [docs/UI_BENCHMARK_CHECKLIST.md](docs/UI_BENCHMARK_CHECKLIST.md) for the manual role-by-role browser procedure.

## Costing method

Material rates use weighted average over positive, priced `OPENING`, `PURCHASE` and `SALES_RETURN` stock receipts up to the
issue date. Finished goods use opening receipts only. Production output is not treated as a priced material receipt. The implementation is
in [backend/src/services/costingService.js](backend/src/services/costingService.js).

For benchmark flour, opening stock is 100 kg valued at Rs 4,200 and the purchase is 60 kg valued at Rs 2,700:

```text
Rs 6,900 / 160 kg = Rs 43.125 per kg
40 kg issued x Rs 43.125 per kg = Rs 1,725
```

The run's material costs are flour Rs 1,725, oil Rs 1,470, spice Rs 240, pouches Rs 485 and cartons Rs 135, for Rs 4,055 total. Run
overheads (Rs 1,200 labour and Rs 600 power/gas) are charged fully to that run:

```text
Cost per good packet = (material cost + run overhead) / good packets
                     = Rs 5,855 / 188
                     = Rs 31.14 per packet (display rounded)
```

Damaged units remain part of the run's material cost but are not included in the good-packet divisor. Therefore damage raises the cost per
good packet. Cost-sheet details and implementation are in [backend/src/services/costSheetService.js](backend/src/services/costSheetService.js).

## Features by role

The backend capability matrix is [backend/src/config/permissions.js](backend/src/config/permissions.js); the frontend route and page registry is [frontend/src/app/registry.js](frontend/src/app/registry.js).

| Role | Main capabilities | Main screens |
| --- | --- | --- |
| SALESMAN | Create orders; read own orders; see assigned customer sales and finished-goods availability. | New order, My orders, Order details, My sales. |
| ADMIN | Manage orders and approvals, invoices, dispatches, payments, masters and users; read stock; access dashboard, alerts and reports. | Orders, Shortages, Invoices, Payments, Receivables, Stock, Purchases, Adjustments, Reports, Dashboard, Alerts. |
| PRODUCTION | Record purchases; manage BOMs and production runs; read stock and reports; add stock adjustments. | Purchases, Recipes (BOM), Production runs, Stock, Adjustments, Reports, Alerts. |
| ACCOUNTANT | Read reports, exports, invoices, payments, stock ledger, production and audit data; no business write capability. | Reports, Invoices, Payments, Receivables, Stock, Production runs, Alerts. |
| OWNER | Dashboard and broad read access to orders, sales, production, stock, costing, reports and audit records. | Dashboard, Orders, Shortages, Invoices, Payments, Receivables, Production, Stock, Reports, Alerts. |

Routes and backend capabilities are enforced separately: the frontend hides screens the role cannot use, while authenticated API endpoints
enforce the backend role/capability checks.

## Architecture

```mermaid
flowchart LR
    Browser[React browser app] --> Nginx[nginx]
    Nginx -->|/api proxy| Routes[Express routes]
    Routes --> Services[Business services]
    Services --> Ledger[Stock ledger service]
    Services --> Prisma[Prisma data access]
    Ledger --> Postgres[(PostgreSQL)]
    Prisma --> Postgres
```

### Two business flows

```text
Sales loop:
salesman order -> admin approval -> GST invoice -> dispatch -> payment
                                                   |
                                     dispatch movement reduces FG stock

Production loop:
purchase -> priced receipt -> BOM issue -> run output and scrap
                                          -> finished-goods stock
                                          -> variance and run cost
```

These flows meet at finished-goods stock. Approved, invoiced orders reserve available packets; a dispatch is the point at which finished
stock decreases. The balance shown by the app is calculated from ledger movements, not stored as a mutable quantity field.

### Stack and reasons

| Choice | Use and reason |
| --- | --- |
| PostgreSQL 16 | Relational constraints and transactions support traceable documents and stock movements. |
| Express on Node.js 20 | The team already knows the PERN stack; small routes can validate input and call focused services. |
| Prisma | The schema and migration history make relational models and database changes inspectable. |
| React 18 and Vite | A browser UI with fast local development and role-based pages. |
| `decimal.js` | Decimal rates and calculations avoid binary floating-point errors in money and quantities. |
| Vitest and Supertest | Unit, API and integration checks run with the project toolchain. |
| Docker Compose and nginx | A single local command starts the database and full web/API stack; nginx serves the SPA and proxies `/api`. |

### Data flow

1. Salesman submits an order with customer, items and quantities. Resolved
   prices and optional `clientRef` are saved with the order.
2. ADMIN approves the order, producing a reservation against free finished
   stock; approval does not yet create a stock-out.
3. Invoice creation snapshots the invoice parties, item descriptions, HSN,
   rates and line-level GST. The invoice PDF reads those saved values.
4. Dispatch appends negative finished-goods movements through the ledger.
   Payment receipts update the receivable reports.
5. Purchase receipts append priced positive movements for raw materials.
6. Production issues append raw-material movements; completion appends
   finished output and any scrap movements and saves the measured variances.
7. Costing and reports query those recorded documents and movements.

### Design rules (R1-R12)

- R1-R2: Stock is the sum of append-only, source-traceable ledger movements;
  corrections append adjustments.
- R3-R4: Money uses integer paise and Decimal rates; quantities use integer
  base units, converted only at system boundaries.
- R5: Multi-table writes use one Prisma transaction; stock writes use the ledger.
- R6: Routes validate and respond; business logic belongs in services.
- R7: Posted invoice snapshots are immutable; cancellation uses a credit note.
- R8: Required audit entries are written in the same transaction as the change.
- R9: Protected endpoints enforce role checks and Zod validation; `clientRef` makes
  retried offline order submissions idempotent.
- R10: Vitest tests cover money, GST, units, variance, ledger and benchmark behavior.
- R11: Dates use UTC storage and IST reporting.
- R12: Dependencies stay focused and secrets are not committed.

PostgreSQL triggers block updates and deletes to stock movements. The stock ledger implementation is in [backend/src/services/ledgerService.js](backend/src/services/ledgerService.js). Money, GST, unit
conversion and variance rules live in [backend/src/lib/money.js](backend/src/lib/money.js), [backend/src/lib/gst.js](backend/src/lib/gst.js), [backend/src/lib/units.js](backend/src/lib/units.js) and [backend/src/lib/variance.js](backend/src/lib/variance.js).

## Reports, exports and invoice PDF

The report registry is [backend/src/services/reports/index.js](backend/src/services/reports/index.js). It registers these ten report keys:

- `sales-register`
- `sales-by-customer`
- `sales-by-product`
- `gst-summary`
- `stock-summary`
- `stock-ledger`
- `purchase-register`
- `production-report`
- `receivables-ageing`
- `product-costing`

Report data can be downloaded as CSV, XLSX or PDF. CSV exports select a section for multi-section reports. The reports catalog only returns
reports permitted for the signed-in role.

GST invoices can be downloaded as PDF. The share action creates a signed public PDF link that expires after seven days; it can also prepare
WhatsApp and email links, but does not send messages.

## Testing

Run the backend test suite from `backend/`:

```sh
npm test
```

Run frontend tests from the repository root:

```sh
npm --prefix frontend test
```

The suites cover money rounding and allocation, GST calculation, base-unit conversion, variance boundaries, ledger behavior and concurrency,
API roles and validation, end-to-end benchmark steps, reports and exports, invoice PDF and share links, costing, and frontend helpers and
page behavior.

Recorded counts: backend 381 passing. The latest recorded complete frontend run had 259 passing and 8 existing UI assertion failures;
focused UI and app-shell tests passed 14/14. This is the recorded state, not a claim that all frontend tests pass. Benchmark results are in
[docs/BENCHMARK.md](docs/BENCHMARK.md).

## Assumptions

The following assumptions are copied unchanged from [docs/PROGRESS.md](docs/PROGRESS.md):

- The `last7` date preset includes today and the previous six IST calendar days; `thisFY` runs from the current FY start through today.
- Project source/guidance live at the Git repository root; `sumInvoice(lines)` expects `taxablePaise`, `gstRateBp`, and `interState`.
- Opening finished goods are valued at Rs 30/packet (3000 paise), as the brief provides no cost; `seed:reset` preserves Prisma's `_prisma_migrations` table while truncating application tables.
- Purchase request quantities and rupee rates are decimal strings, keeping input conversion independent of binary floating-point.
- Customer price PUT accepts `{ prices: [...] }` and upserts only the submitted item prices.
- BOM PUT preserves notes when omitted; clone copies source notes and line overrides apply only to items present after replacements. Plan requires exactly one mode; issued quantities use the selected BOM item's dimension and convert to base units.
- The main benchmark intentionally leaves Distributor B's shortage order unapproved; a backorder is a new order after production replenishes stock.
- Receivables ageing includes customers with an eligible invoice and an outstanding balance or remaining credit; `detail=true` opts into invoice rows, and sections are capped at 50000 rows. Invoice PDFs use current customer phone and item display unit because the schema has no historical fields for them.
- Step 55 counts all orders created today and only POSTED invoices; variance counts cover the 30 inclusive IST calendar days ending today.

## Known limitations

- The salesman order form needs connectivity to load customer and item masters.
  Saved order submission can queue locally, but there is no PWA or offline shell.
- Invoice cancellation is full-invoice only in v1; partial credit notes are not
  implemented.
- Payment edit, delete and reversal are not available.
- Alerts and order updates use polling; there are no push or email alerts.
- HTTPS termination and Linux hosting/firewall configuration are manual; see
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Purchase editing, purchase cancellation, supplier payments and purchase GST
  input-credit tracking are not implemented.
- Finished-goods stock is not valued at the production-run cost; costing is
  shown separately in cost sheets and product-costing reports.
- The U3 UI consistency work is not complete: some page headers and first-load
  states still need standardization.

## Repository layout

```text
Murukku/
|-- AGENTS.md
|-- README.md
|-- docker-compose.yml
|-- docs/
|   |-- AI_CONTEXT.md
|   |-- BENCHMARK.md
|   |-- DATA_MODEL.md
|   |-- DEPLOYMENT.md
|   |-- PROGRESS.md
|   `-- UI_BENCHMARK_CHECKLIST.md
|-- backend/
|   |-- prisma/
|   |-- scripts/
|   |-- src/
|   |   |-- config/
|   |   |-- lib/
|   |   |-- middleware/
|   |   |-- routes/
|   |   `-- services/
|   `-- tests/
`-- frontend/
    |-- src/
    |   |-- app/
    |   |-- components/
    |   |-- context/
    |   |-- lib/
    |   `-- pages/
    `-- nginx.conf
```

## How this was built

Development used AI assistance and a three-file repository memory: [AGENTS.md](AGENTS.md), [docs/AI_CONTEXT.md](docs/AI_CONTEXT.md) and [docs/PROGRESS.md](docs/PROGRESS.md). Completed
implementation steps were reviewed with their relevant tests; the benchmark was run at its dedicated verification step. Git history records
the implementation steps and their verification evidence. Some seeded-browser walkthroughs and the remaining U3 UI consistency work are not
complete, as recorded in `docs/PROGRESS.md`.

## Project documentation

- [Data model](docs/DATA_MODEL.md)
- [Benchmark proof](docs/BENCHMARK.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Browser benchmark checklist](docs/UI_BENCHMARK_CHECKLIST.md)

Demo video: (add link)

Live URL: (add link if deployed)
