# PROGRESS.md - live project memory (UPDATE AFTER EVERY STEP)
Last updated: 2026-11-24 by Copilot

## Next Step
Step 14 - Master data CRUD APIs (items, customers, suppliers, settings, users)

## How to run (keep accurate)
- Install dependencies: `npm --prefix backend install` and `npm --prefix frontend install`.
- Start PostgreSQL on host port 5433: `npm run db:up`; stop it with `npm run db:down`.
- Create the separate test database once if it does not exist: `docker compose exec -T db createdb -U oda oda_test`.
- From `backend/`, apply migrations to `oda_test` before the first test run: set `$env:DATABASE_URL = 'postgresql://oda:oda@localhost:5433/oda_test?schema=public'`, run `npx prisma migrate deploy`, then `Remove-Item Env:DATABASE_URL`. `DATABASE_URL_TEST` is configured in `.env`; Vitest refuses any test URL other than `oda_test`.
- Start the API and UI in separate terminals: `npm run dev:backend` and `npm run dev:frontend`.
- From `backend/`, test backend and pure library units with `npm test`; Vitest resets only the isolated test database. Build frontend: `npm --prefix frontend run build`.
- Number generation tests run with `npm test -- tests/lib/fy.test.js tests/numberingService.test.js`. Call `nextNumber(tx, 'INV', invoiceDate)` inside the same Prisma transaction as the document write so rollback does not consume the number.
- Purchase receipts use `POST /api/purchases` with a PRODUCTION or ADMIN token; quantities and rates are entered as decimal strings in the chosen unit. After the benchmark receipt, run `npm run bench:check -- --stage=after-purchase`.
- Stock corrections use `POST /api/stock/adjustments` with an ADMIN or PRODUCTION token; `qty` is a positive decimal string and `direction` selects the signed movement. Read the paged list with `GET /api/stock/adjustments?itemId=&from=&to=&page=&limit=`.
- From `backend/`, load benchmark data with `npm run seed` (or `npx prisma db seed`); rerun safely with no duplicate records.
- From `backend/`, `npm run seed:reset` clears application tables and reseeds (destructive; refuses `NODE_ENV=production`); `npm run balances` prints ledger-derived stock in display units.
- From `backend/`, run `npm run bench:check -- --stage=opening` after `npm run seed:reset`; select `after-purchase`, `after-run`, `after-dispatch`, or `final` to check later benchmark checkpoints.
- Demo logins (password for every account: `Demo@123`):

  | Role | Email |
  | --- | --- |
  | ADMIN | `admin@demo.com` |
  | PRODUCTION | `production@demo.com` |
  | SALESMAN | `salesman.a@demo.com` |
  | SALESMAN | `salesman.b@demo.com` |
  | ACCOUNTANT | `accountant@demo.com` |
  | OWNER | `owner@demo.com` |
- Login with `POST /api/auth/login`, then send its token as `Authorization: Bearer <token>` to `GET /api/auth/me`.
- `GET /api/audit` requires ADMIN, ACCOUNTANT, or OWNER; supports entity/user/date filters and pagination (`limit` max 100).
- Check library source for float parsing/formatting: from `backend/`, run `rg -n "parseFloat|toFixed" src/lib` (expect no matches).
- Run Prisma commands from `backend/`: `npx prisma format`, `npx prisma validate`, `npx prisma migrate dev`, `npx prisma migrate status`.
- To check the append-only trigger, connect with `docker compose exec -it db psql -U oda -d oda` and run `UPDATE "StockMovement" SET "qtyChange" = 1;` (it must raise an error).
- Copy `backend/.env.example` to `backend/.env` and set a private JWT secret before use.

## Step checklist (tick when DONE and VERIFIED)
### Phase 1 - Foundation
[x] 01 Monorepo scaffold, Docker Postgres, health check
[x] 02 Prisma schema A: users, units, items, customers, suppliers, settings
[x] 03 Prisma schema B: BOM, purchases, production runs, stock ledger, audit log
[x] 04 Prisma schema C: orders, invoices, dispatch, payments, credit notes, counters
[x] 05 Money, GST, units and variance libraries + unit tests
[x] 06 Seed script with the section 5 benchmark master data
[x] 07 Login, JWT and role middleware
[x] 08 Validation, error handling and audit-log helper
### Phase 2 - Stock ledger and purchases
[x] 09 Ledger service (addMovement, balances, running ledger) + tests
[x] 10 Stock summary and ledger APIs + benchmark-check script
[x] 11 Document numbering service (financial-year counters)
[x] 12 Purchase API with supplier and per-unit rates
[x] 13 Stock adjustment API (reason + audit)
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
- Step 13 (2026-11-24): Added the numbered StockAdjustment model/migration and documented its source traceability. Added role-gated adjustment create/list routes; IN/OUT append ledger rows at weighted-average rates and audit before/after balances transactionally. `npm test` passes (64); Prisma migration status is up to date.
- Step 12 (2026-11-24): Added an atomic purchase API with unit/rate conversion, purchase-ledger entries and audit, plus exact weighted-average rates; added list/detail reads and extended the after-purchase benchmark checks. Verified `seed:reset`, production login/60 kg flour POST, and benchmark PASS (4 checks); `npm test` passes (59).
- Step 11 (2026-11-24): Added Asia/Kolkata financial-year helpers and an atomic `DocumentCounter` service; added FY boundary, independent/reset counters, >9999, rollback, and concurrency tests. `npm test` passes (52 tests); no routes or schema changes.
- Step 10 (2026-11-24): Added capability-protected stock summary, running ledger, per-item balance, and finished availability routes; salesmen receive finished goods only and availability subtracts outstanding reservations. Added staged benchmark checker. `npm test` passes (42); opening benchmark is PASS (6 checks); live salesman summary/availability returned 403/200.
- Step 09 (2026-11-24): Added transaction-safe ledger writes/balances/running ledger, item-row locking for outflows, and the append-only UPDATE/DELETE trigger. Routed seed openings through the service; added isolated `oda_test` reset/seed helpers and concurrency/trigger tests. `npm test` passes (37); repeated seed kept six openings.
- Step 08 (2026-11-24): Added Zod request validation, shared AppError helpers/error handler, async route wrapper, and transaction-compatible JSON-safe audit helper; audited successful/failed logins and added the capability-protected audit listing. Refactored auth/health routes. `npm test` passes (29); live 404, demo login, and audit lookup verified.
- Step 07 (2026-11-24): Added JWT login, active-user authentication, role/capability middleware and test-only auth endpoints; added `jsonwebtoken`. Added Supertest coverage for login, invalid credentials, missing/deactivated/deleted users, role and capability checks. `npm test` passes (23); live demo login and `/api/auth/me` returned ADMIN successfully.
- Step 06 (2026-11-24): Added `backend/prisma/seed.js`, `backend/scripts/reset-db.js`, and `backend/scripts/print-balances.js`; wired bcryptjs and npm/Prisma scripts. Verified balances, repeat seeding, password/assignment/BOM/opening values, production refusal, and expected record counts; `npm test` passes (16). Prisma 6 warns the requested seed config is deprecated for Prisma 7.
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
- `backend/` - Node ES-module API, Prisma client/schema/migrations, health/auth routes and middleware, pure money/GST/units/variance libraries, benchmark seed/reset/balance utilities, and tests.
- `backend/prisma/seed.js` - idempotent units, settings, master data, demo users, BOM, and opening ledger movements.
- `backend/scripts/` - production-guarded database reset/reseed and display-unit balance reporting.
- `backend/src/config/permissions.js` - centralized role list and capability matrix.
- `backend/src/services/authService.js`, `backend/src/middleware/auth.js`, `backend/src/routes/auth.js` - credential login, JWT issuance/verification, authorization checks, and auth endpoints.
- `backend/src/services/ledgerService.js` - the only application service that creates stock movements; provides locked outflows, balances, and running ledger rows.
- `backend/src/services/stockService.js`, `backend/src/routes/stock.js` - finished-goods availability and capability-protected stock APIs.
- `backend/src/services/adjustmentService.js`, `backend/src/routes/stock.js` - create auditable stock corrections as numbered ADJUSTMENT ledger entries and list them by item/date.
- `backend/src/services/costingService.js` - weighted-average paise-per-base-unit rates from dated priced receipts, without rounded ledger values.
- `backend/src/services/purchaseService.js`, `backend/src/routes/purchases.js` - transactionally create/list/read purchases, record receipts through the ledger service, and return display quantities/amounts.
- `backend/src/lib/fy.js` - Asia/Kolkata financial-year lookup and UTC IST-midnight range boundaries.
- `backend/src/services/numberingService.js` - `nextNumber(tx, 'INV', invoiceDate)` atomically increments the financial-year counter inside the caller's document transaction.
- `backend/scripts/benchmark-check.js` - table-driven PASS/FAIL/SKIPPED checks for benchmark stages; run with `npm run bench:check -- --stage=opening`.
- `backend/src/lib/errors.js`, `asyncHandler.js`, `audit.js`; `backend/src/middleware/validate.js`, `errorHandler.js` - shared errors, async route handling, validation, and transaction-aware audit writes.
- `backend/src/routes/audit.js` - capability-protected, filtered and paginated audit log listing.
- `backend/tests/helpers/db.js`, `tests/setup.js`, `vitest.config.js` - guarded `oda_test` database reset/seeding and Vitest isolation.
- `backend/tests/` - adjustment and purchase API/costing, stock API, ledger, numbering/FY, auth, audit, middleware/error, and pure library Vitest coverage.
- `backend/prisma/migrations/20261124115051_ledger_append_only/` - database trigger preventing stock-movement updates and deletes.
- `backend/prisma/migrations/20261124125050_stock_adjustment/` - numbered stock-adjustment source records and item/user relations.
- `frontend/` - Vite/React UI, Tailwind v3/PostCSS, API client, and `/api` proxy.
- `docs/` - project context, progress tracker, step prompts, and Mermaid data-model note, now including BOM/purchase/production/ledger/audit/sales entities and invoice/cancellation notes.

## API endpoints (METHOD path - roles - purpose)
- `GET /api/health` - public - API/database status and ISO timestamp; HTTP 200 if the database query fails.
- `POST /api/auth/login` - public - validate credentials and return a 12-hour JWT with the user summary.
- `GET /api/auth/me` - any authenticated user - return the current active user loaded from the database.
- `GET /api/audit` - ADMIN, ACCOUNTANT, OWNER - newest-first audit rows with optional entity, entityId, userId, from/to, page, and limit filters; includes user name.
- `GET /api/stock/summary?type=RAW|PACKAGING|FINISHED` - ADMIN, PRODUCTION, ACCOUNTANT, OWNER - balances in base integers and display strings.
- `GET /api/stock/ledger?itemId=&from=&to=` - ADMIN, PRODUCTION, ACCOUNTANT, OWNER - running movement ledger with base quantities and display strings.
- `GET /api/stock/items/:id/balance` - ADMIN, PRODUCTION, ACCOUNTANT, OWNER - one item's base and display balance.
- `GET /api/stock/finished-availability` - SALESMAN plus stock-read roles - finished goods only; subtracts quantities reserved by approved/invoiced orders.
- `POST /api/purchases` - PRODUCTION, ADMIN - create a supplier receipt; converts entered units/rates and writes PURCHASE ledger movements and a CREATE audit row atomically.
- `GET /api/purchases?page=&limit=&from=&to=&supplierId=` - PRODUCTION, ADMIN, ACCOUNTANT, OWNER - filtered, paginated purchase list with line display strings.
- `GET /api/purchases/:id` - PRODUCTION, ADMIN, ACCOUNTANT, OWNER - purchase detail and display strings.
- `POST /api/stock/adjustments` - ADMIN, PRODUCTION - append a reason-coded, numbered stock correction and audit its before/after balances.
- `GET /api/stock/adjustments?itemId=&from=&to=&page=&limit=` - ADMIN, PRODUCTION, ACCOUNTANT, OWNER - paginated adjustment history with display quantities.
- `GET /api/_whoami`, `GET /api/_admin-only`, `GET /api/_approve-only` - test environment only - exercise authentication, role, and capability gates.
- No endpoints added in Steps 03-04 (schema/documentation only).
- Step 05 adds pure functions only; no endpoints.
- Step 06 adds seed and maintenance scripts only; no endpoints.
- Step 09 adds the ledger service only; no endpoints.
- Finished availability subtracts outstanding approved/invoiced quantities, including partial dispatches, from the finished-goods ledger balance.
- Step 11 adds financial-year and number-generation helpers only; no API endpoints were added.
- Purchase amounts are computed from rates converted to paise per base unit and rounded at the line level; weighted averages use stored Decimal rates times quantities rather than rounded `valuePaise`.
- Adjustment quantity is entered as a positive magnitude; `direction` determines the signed base-unit `qtyChange`.
- The adjustment record's `createdAt` is its effective date; the corresponding ledger `movementDate` uses the same UTC instant.

## Decisions (deviations from AI_CONTEXT.md and why)
- DB host port is 5433 because the Windows PostgreSQL service occupies 5432
- No round-off line; GST is computed per invoice line and then summed.
- Authentication reloads the account and role for every request, so deactivation, deletion, and role changes take effect without waiting for token expiry.
- Failed-login audits store the attempted email but never the password; unknown-email attempts have a null userId. Audit list `from`/`to` bounds are inclusive and `limit` is capped at 100.
- Opening stock movements use their item id as `sourceId` because the model has no separate opening-document record.
- Financial-year ranges use an inclusive IST-midnight start and exclusive next-year IST-midnight end.

## Assumptions (copy into README at the end)
- Project source and project guidance live at the Git repository root.
- `sumInvoice(lines)` expects each line to provide `taxablePaise`, `gstRateBp`, and `interState`.
- Opening finished goods are valued at Rs 30/packet (3000 paise), as the brief provides no cost.
- `seed:reset` preserves Prisma's `_prisma_migrations` table while truncating application tables.
- Purchase request quantities and rupee rates are decimal strings, keeping input conversion independent of binary floating-point.

## Known issues / TODO
- `npm install` reported 13 backend and 4 frontend dependency audit findings; review before deployment.
- No refresh-token or logout endpoint yet; access tokens expire after 12 hours, and deactivated or deleted accounts are rejected on each request.
- No Step 05-specific known issues.
- Prisma 6 warns that the requested `package.json#prisma` seed configuration is deprecated in Prisma 7.
- The append-only trigger blocks row UPDATE/DELETE; explicit reset helpers use TRUNCATE only on a dedicated/reset database. Tests require the migrated `oda_test` database.
- Benchmark stock snapshots are checked at the selected stage; later stages and not-yet-reached document checks print SKIPPED.
- Numbering is gap-free only when `nextNumber` receives the transaction client and shares the document write's transaction; document routes are not implemented yet.
- Purchases currently support create and read only; edit, cancellation, and purchase-return workflows are not implemented.
- Adjustments have no editable effective date; history filtering uses the recorded `createdAt`, and corrections always append rather than update or delete.

## Benchmark status (stage: PASS/FAIL/SKIPPED)
opening PASS (6 checks; later-stage checks skipped)
after-purchase PASS (4 checks; later-stage checks skipped)
