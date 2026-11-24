# PROGRESS.md - live project memory (UPDATE AFTER EVERY STEP)
Last updated: 2026-11-24 by Copilot

## Next Step
Step 06 - Seed script with the section 5 benchmark master data

## How to run (keep accurate)
- Install dependencies: `npm --prefix backend install` and `npm --prefix frontend install`.
- Start PostgreSQL on host port 5433: `npm run db:up`; stop it with `npm run db:down`.
- Start the API and UI in separate terminals: `npm run dev:backend` and `npm run dev:frontend`.
- Test backend, including pure library unit tests: `npm test`; build frontend: `npm --prefix frontend run build`.
- Check library source for float parsing/formatting: from `backend/`, run `rg -n "parseFloat|toFixed" src/lib` (expect no matches).
- Run Prisma commands from `backend/`: `npx prisma format`, `npx prisma validate`, `npx prisma migrate dev --name sales_loop`, `npx prisma migrate status`.
- Copy `backend/.env.example` to `backend/.env` and set a private JWT secret before use.

## Step checklist (tick when DONE and VERIFIED)
### Phase 1 - Foundation
[x] 01 Monorepo scaffold, Docker Postgres, health check
[x] 02 Prisma schema A: users, units, items, customers, suppliers, settings
[x] 03 Prisma schema B: BOM, purchases, production runs, stock ledger, audit log
[x] 04 Prisma schema C: orders, invoices, dispatch, payments, credit notes, counters
[x] 05 Money, GST, units and variance libraries + unit tests
[ ] 06 Seed script with the section 5 benchmark master data
[ ] 07 Login, JWT and role middleware
[ ] 08 Validation, error handling and audit-log helper
### Phase 2 - Stock ledger and purchases
[ ] 09 Ledger service (addMovement, balances, running ledger) + tests
[ ] 10 Stock summary and ledger APIs + benchmark-check script
[ ] 11 Document numbering service (financial-year counters)
[ ] 12 Purchase API with supplier and per-unit rates
[ ] 13 Stock adjustment API (reason + audit)
[ ] 14 Master data CRUD APIs (items, customers, suppliers, settings, users)
### Phase 3 - BOM and production (highest weight)
[ ] 15 BOM API (create, view, update)
[ ] 16 Planned-consumption calculator (scale BOM by batches) + tests
[ ] 17 Production run: start and issue materials
[ ] 18 Production run: complete with actual output, scrap, damaged
[ ] 19 Variance engine and tolerance flags (per material and yield)
[ ] 20 Production run list, detail, cancel and audit trail
[ ] 21 Automated benchmark test: steps 1 to 3
### Phase 4 - Sales loop
[ ] 22 Price resolution (customer price, then default)
[ ] 23 Salesman order create API (idempotent clientRef)
[ ] 24 Order list and status APIs per role
[ ] 25 Finished-goods availability and shortage check
[ ] 26 Admin edit, approve and reject order
[ ] 27 GST calculation service (CGST/SGST vs IGST) wired to lines
[ ] 28 Create GST invoice from approved order (FY numbering)
[ ] 29 Dispatch: reduce finished-goods stock (partial optional)
[ ] 30 Payments and customer outstanding
[ ] 31 Cancel invoice with credit note and stock reversal
[ ] 32 Insufficient-stock flow (Distributor B, IGST)
[ ] 33 Automated benchmark test: steps 4 to 7
### Phase 5 - Costing
[ ] 34 Weighted-average cost service
[ ] 35 Overheads per run and allocation rule
[ ] 36 Cost per packet and margin API + test
### Phase 6 - Reports and PDF
[ ] 37 Sales register
[ ] 38 Customer-wise and product-wise sales
[ ] 39 GST summary (GSTR-1 / GSTR-3B shape)
[ ] 40 Stock summary and stock ledger reports
[ ] 41 Purchase register
[ ] 42 Production report (planned vs actual, yield, wastage)
[ ] 43 Outstanding receivables with ageing
[ ] 44 CSV/Excel export utility for every report
[ ] 45 GST invoice PDF
### Phase 7 - Frontend
[ ] 46 Frontend base: router, auth context, API client, role layouts
[ ] 47 Login page and role redirect
[ ] 48 Salesman mobile order screen
[ ] 49 Salesman my orders and customer-wise sales
[ ] 50 Admin orders inbox and approval screen
[ ] 51 Admin invoice, dispatch and payment screens
[ ] 52 Production screens: BOM view, new run, actual output
[ ] 53 Stock summary and ledger pages
[ ] 54 Reports pages with date filter and export
[ ] 55 Owner dashboard
[ ] 56 Variance alerts and low-stock indicators
### Phase 8 - Ship
[ ] 57 End-to-end benchmark script (all 9 steps) + final fixes
[ ] 58 Docker Compose full stack + deployment
[ ] 59 README and 2-page design note
[ ] 60 Demo video script, interview rehearsal sheet, final audit

## Log (newest first, max 5 lines per step, condense old entries when file > 250 lines)
- Step 05 (2026-11-24): Added `backend/src/lib/{money,gst,units,variance}.js` and four suites under `backend/tests/lib/`. `npm test` passes (16 tests); `rg -n "parseFloat|toFixed" src/lib` finds no matches. Assumption: `sumInvoice` lines contain taxable paise, GST basis points, and an inter-state flag.
- Step 04 (2026-11-24): Added order, invoice, dispatch, payment, credit-note, and document-counter models; documented invoice snapshots and credit-note cancellation. Added migration `20261124103152_sales_loop`; format, validate, migrate, and Prisma Client generation succeeded. Decision: no round-off line; GST is computed per line, then summed. No APIs or seeds.
- Step 03 (2026-11-24): Added BOM, purchase, production, stock-ledger, and audit-log models plus the Mermaid model and six-line explanation. Migration `20261124102201_ledger_bom_production` is applied and Prisma Client generated. `npx prisma migrate status` reports up to date; `npm test` passes (1 test).
- Step 01 (2026-11-24): Added root npm scripts/ignore rules, Postgres Compose service, Node/Express/Prisma API and health test, and React/Vite/Tailwind UI with API status. Added package manifests/lockfiles and backend env example/local env.
- Verified: Prisma client generation; `npm test`; frontend production build; `docker compose config --quiet`; Compose database health. The initial host mapping collided with the Windows PostgreSQL service on port 5432; Compose now uses host port 5433.
- Initial layout assumption (resolved): supplied guidance was under `starter-kit/`; housekeeping moved it and the project docs to the repository root.
- Step 02 (2026-11-24): Added identity/master-data enums and models, indexes, relation names, initial migration, and Mermaid data-model note. Prisma format/validate and backend tests passed; migration applied to the Compose database over its Docker network.
- Limitation: Direct host migration hit the pre-existing PostgreSQL on port 5432; Prisma Client generation is blocked while a running backend process holds its Windows engine DLL.
- Housekeeping (2026-11-24): Moved `AGENTS.md` and `starter-kit/docs/*` into the repository root locations, preserving the existing `docs/DATA_MODEL.md`; configured PostgreSQL host port 5433.
- Verified `npm run db:up`, `npx prisma migrate status` (up to date), and `npm test`; `npx prisma generate` still fails because a running process locks the Windows query-engine DLL.

## File map (path - purpose)
- `AGENTS.md` - repository instructions.
- `package.json`, `.gitignore`, `docker-compose.yml` - root scripts, ignore rules, and PostgreSQL service.
- `backend/` - Node ES-module API, validated configuration, Prisma client/schema/migrations, health route, pure money/GST/units/variance libraries, and tests. Steps 03-04 add BOM, purchasing, production, stock-ledger, audit, and sales-loop models.
- `backend/src/lib/`, `backend/tests/lib/` - pure Decimal-backed business helpers and focused Vitest coverage.
- `frontend/` - Vite/React UI, Tailwind v3/PostCSS, API client, and `/api` proxy.
- `docs/` - project context, progress tracker, step prompts, and Mermaid data-model note, now including BOM/purchase/production/ledger/audit/sales entities and invoice/cancellation notes.

## API endpoints (METHOD path - roles - purpose)
- `GET /api/health` - public - API/database status and ISO timestamp; HTTP 200 if the database query fails.
- No endpoints added in Steps 03-04 (schema/documentation only).
- Step 05 adds pure functions only; no endpoints.

## Decisions (deviations from AI_CONTEXT.md and why)
- DB host port is 5433 because the Windows PostgreSQL service occupies 5432
- No round-off line; GST is computed per invoice line and then summed.

## Assumptions (copy into README at the end)
- Project source and project guidance live at the Git repository root.
- `sumInvoice(lines)` expects each line to provide `taxablePaise`, `gstRateBp`, and `interState`.

## Known issues / TODO
- `npm install` reported 13 backend and 4 frontend dependency audit findings; review before deployment.
- No Step 05-specific known issues.

## Benchmark status (stage: PASS/FAIL/SKIPPED)
(not started)
