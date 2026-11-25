# PROGRESS.md - live project memory (UPDATE AFTER EVERY STEP)
Last updated: 2026-11-25 by Copilot

## Next Step
Step 18 - Production run: completion, output and scrap

## How to run (keep accurate)
- Install dependencies: `npm --prefix backend install`; start/stop PostgreSQL on port 5433 with `npm run db:up` / `npm run db:down`.
- Create `oda_test` once: `docker compose exec -T db createdb -U oda oda_test`. From `backend/`, set `$env:DATABASE_URL = 'postgresql://oda:oda@localhost:5433/oda_test?schema=public'`, run `npx prisma migrate deploy`, then `Remove-Item Env:DATABASE_URL`; Vitest refuses non-test databases.
- Run backend tests from `backend/`: `npm test`. Build the frontend with `npm --prefix frontend run build`.
- Start API/UI in separate terminals: `npm run dev:backend` and `npm run dev:frontend`.
- Prisma commands from `backend/`: `npx prisma format`, `npx prisma validate`, `npx prisma migrate dev`, `npx prisma migrate status`.
- Seed with `npm run seed`; reset/reseed (destructive; production is refused) with `npm run seed:reset`; print ledger balances with `npm run balances`.
- Run benchmarks after reset: `npm run bench:check -- --stage=opening`; available stages: `after-purchase`, `after-issue`, `after-run`, `after-dispatch`, `final`.
- Purchase receipts use PRODUCTION/ADMIN and decimal-string qty/rates; check with `npm run bench:check -- --stage=after-purchase`. Adjustments use ADMIN/PRODUCTION with positive qty and IN/OUT direction.
- Numbering tests: `npm test -- tests/lib/fy.test.js tests/numberingService.test.js`. Call `nextNumber(tx, 'INV', date)` inside the document transaction to avoid burning numbers on rollback.
- Demo password is `Demo@123` for `admin@demo.com`, `production@demo.com`, `salesman.a@demo.com`, `salesman.b@demo.com`, `accountant@demo.com`, and `owner@demo.com`. Login at `POST /api/auth/login` and use the token as `Authorization: Bearer <token>`.
- Master data reads require authentication; writes are ADMIN-only. SALESMAN customer reads are assignment-scoped. BOM reads allow ADMIN/PRODUCTION/ACCOUNTANT/OWNER; writes allow ADMIN/PRODUCTION.
- BOM planning: `GET /api/boms/:id/plan` with exactly one mode, `?batches=2.5`, `?targetOutput=300`, or `?itemId=1&qty=20&unit=kg`; max 100 batches.
- Start a run with `POST /api/production/runs` (PRODUCTION/ADMIN), providing exactly one of `bomId` or `finishedItemId`; the latter selects the active BOM. Optional `issues` use decimal-string quantities and units.
- `GET /api/audit` requires ADMIN/ACCOUNTANT/OWNER; supports entity/user/date filters and pagination (limit max 100).
- Check `src/lib` for `parseFloat`/`toFixed` with `rg -n "parseFloat|toFixed" src/lib` (expect no matches).
- Append-only trigger check: `docker compose exec -it db psql -U oda -d oda`, then `UPDATE "StockMovement" SET "qtyChange" = 1;` (must fail).
- Copy `backend/.env.example` to `backend/.env` and set a private JWT secret before use.

## Step checklist (tick when DONE and VERIFIED)
### Phase 1 - Foundation
01-08 [x]: scaffold/health; identity and master-data schema; BOM/production/ledger schema; sales schema; money/GST/units/variance; benchmark seed; auth/RBAC; validation/errors/audit.
### Phase 2 - Stock ledger and purchases
09-14 [x]: ledger service; stock APIs/benchmark checker; FY numbering; purchases; adjustments; master-data APIs.
### Phase 3 - BOM and production (highest weight)
15-16 [x]: BOM CRUD/versioning/cloning; planned-consumption calculator.
17 [x] production start/issues; 18 [ ] completion/output/scrap; 19 [ ] variance/tolerance; 20 [ ] run list/detail/cancel; 21 [ ] benchmark steps 1-3.
### Phase 4 - Sales loop
22-33 [ ] price resolution; orders; order roles/status; availability; approval; GST; invoicing; dispatch; payments; credit notes; shortage flow; benchmark steps 4-7.
### Phase 5 - Costing
34-36 [ ] weighted average; overhead allocation; packet cost/margin.
### Phase 6 - Reports and PDF
37-45 [ ] sales/customer/product/GST/stock/purchase/production/receivables reports; exports; invoice PDF.
### Phase 7 - Frontend
46-56 [ ] router/auth/role layouts; login; salesman orders/customers; admin orders/invoices; production/stock/reports pages; dashboard/alerts.
### Phase 8 - Ship
57-60 [ ] full benchmark/fixes; deployment; README/design note; demo/interview/final audit.

## Log (newest first, max 5 lines per step, condense old entries when file > 250 lines)
- Step 17 (2026-11-25): Added atomic run creation, plan snapshots, raw-material ledger issues, average-rate material costs, audit, and `POST /api/production/runs`; added five API cases and the after-issue benchmark. Files: production service/route, app mount, production tests, benchmark checker, and this log. `npm test` passes (89); reset + purchase + run + after-issue benchmark passes (10 checks). Decision: `issuedQty` is total stock-out (consumed plus scrap); defer packaging to completion by default.
- Step 16 (2026-11-24): Added pure Decimal-based batch, target-output, and issued-material BOM planning with half-up integer base quantities, plus a role-gated plan endpoint for all three exclusive query modes. Pure and API tests pass; full `npm test` passes (84). Assumption: plan responses serialize batchCount as a decimal string to preserve precision.
- Step 15 (2026-11-24): Added role-gated BOM list/detail/create/update/clone APIs, unit-to-base conversion, single-active versioning, and audit writes; used BOM edits create a new version. Added coverage for seeded recipe display, invalid types, history, cloning, and role denial. `npm test` passes (78); live production login showed the expected 200-yield recipe quantities.
- Step 14 (2026-11-24): Added audited master-data CRUD and role policies; key files `masterDataService.js`, `settingsService.js`, `userService.js`, master-data routes, and `tests/masterData.test.js`.
- Step 13 (2026-11-24): Added numbered stock adjustments and transactional ledger/audit APIs; key files `adjustmentService.js`, `routes/stock.js`, adjustment migration, and `tests/adjustment.test.js`.
- Step 12 (2026-11-24): Added purchase receipts, weighted-average costing, and benchmark checks; key files `purchaseService.js`, `costingService.js`, `routes/purchases.js`, and `tests/purchase.test.js`.
- Step 11 (2026-11-24): Added Asia/Kolkata FY helpers and atomic document counters; key files `lib/fy.js`, `numberingService.js`, and numbering/FY tests.
- Step 10 (2026-11-24): Added stock read APIs and staged benchmark checker; key files `routes/stock.js`, `stockService.js`, `scripts/benchmark-check.js`, and `tests/stock.test.js`.
- Step 09 (2026-11-24): Added transaction-safe append-only stock ledger, DB trigger, and isolated test DB helpers; key files `ledgerService.js`, trigger migration, `tests/helpers/db.js`, and ledger tests.
- Step 08 (2026-11-24): Added validation, shared errors, async handling, audit helper, and audit API; key files `lib/errors.js`, `lib/audit.js`, middleware, and `routes/audit.js`.
- Step 07 (2026-11-24): Added JWT authentication and role/capability middleware; key files `authService.js`, `middleware/auth.js`, `routes/auth.js`, permissions, and `tests/auth.test.js`.
- Step 06 (2026-11-24): Added benchmark seeding and database maintenance tools; key files `prisma/seed.js`, `scripts/reset-db.js`, and `scripts/print-balances.js`.
- Step 05 (2026-11-24): Added money, GST, unit, and variance helpers with tests; key files `src/lib/{money,gst,units,variance}.js` and `tests/lib/`.
- Step 04 (2026-11-24): Added order/sales schema and migration; key files `prisma/schema.prisma`, migration `20261124103152_sales_loop`, and `docs/DATA_MODEL.md`.
- Step 03 (2026-11-24): Added BOM, purchase, production, ledger, and audit schema; key files `prisma/schema.prisma`, migration `20261124102201_ledger_bom_production`, and `docs/DATA_MODEL.md`.
- Step 02 (2026-11-24): Added identity/master-data schema and initial migration; key files `prisma/schema.prisma`, initial migration, and `docs/DATA_MODEL.md`.
- Step 01 (2026-11-24): Scaffolded Node/Express/Prisma API, React/Vite UI, and Docker Postgres; key files root/backend/frontend manifests, `docker-compose.yml`, and health test.

## File map (path - purpose)
- Root: `AGENTS.md`, `package.json`, `.gitignore`, `docker-compose.yml` - project rules, scripts, ignores, and Postgres.
- `docs/`: AI context, progress, step prompts, and Mermaid data model.
- `backend/prisma/`: schema, migrations (including append-only trigger and stock adjustments), and idempotent benchmark seed.
- `backend/scripts/`: guarded reset/reseed, balance output, and staged benchmark checker.
- `backend/src/config/`, `middleware/`: role/capability matrix, auth, validation, and centralized error handling.
- `backend/src/lib/`: Decimal money/GST/units/variance/BOM math, FY, states, errors, audit, and async helpers.
- `backend/src/routes/`: health, auth, audit, stock/adjustments, purchases, BOMs, production, items, customers/prices, suppliers, settings, and users.
- `backend/src/services/`: auth, append-only ledger, stock availability, adjustment, purchase/costing, BOM, production-run start, master data, settings, and user logic.
- `backend/tests/`: API/unit suites; `helpers/db.js` and setup guard test operations to `oda_test`.
- `frontend/`: Vite/React UI, Tailwind, API client, and `/api` proxy.

## API endpoints (METHOD path - roles - purpose)
- `/api/health`: `GET /` public. `/api/auth`: `POST /login` public; `GET /me` any authenticated user.
- `/api/audit`: `GET /` ADMIN/ACCOUNTANT/OWNER; newest-first filtered/paginated rows with user name.
- `/api/stock`: `GET /summary?type=`, `/ledger?itemId=&from=&to=`, `/items/:id/balance` ADMIN/PRODUCTION/ACCOUNTANT/OWNER; `GET /finished-availability` also SALESMAN; `POST /adjustments` ADMIN/PRODUCTION; `GET /adjustments` stock-read roles.
- `/api/purchases`: `POST /` PRODUCTION/ADMIN; `GET /?page=&limit=&from=&to=&supplierId=` and `GET /:id` PRODUCTION/ADMIN/ACCOUNTANT/OWNER. Receipts write ledger and audit atomically.
- `/api/items`: `GET /?type=&active=`, `GET /:id` authenticated; `POST /`, `PATCH /:id` ADMIN.
- `/api/customers`: `GET /?type=&active=`, `GET /:id`, `GET /:id/prices` authenticated (salesmen assigned customers only); `POST /`, `PATCH /:id`, `PUT /:id/prices` ADMIN.
- `/api/suppliers`: `GET /?active=`, `GET /:id` authenticated; `POST /`, `PATCH /:id` ADMIN. `/api/settings`: `GET /` authenticated; `PUT /:key` ADMIN.
- `/api/users`: `GET /`, `POST /`, `PATCH /:id`, `POST /:id/reset-password` ADMIN; responses omit password hashes.
- `/api/boms`: `GET /?finishedItemId=&active=`, `GET /:id`, `GET /:id/plan` ADMIN/PRODUCTION/ACCOUNTANT/OWNER; `POST /`, `PUT /:id`, `POST /:id/clone` ADMIN/PRODUCTION. Plan accepts exactly one of `?batches=`, `?targetOutput=`, or `?itemId=&qty=&unit=`.
- `/api/production`: `POST /runs` PRODUCTION/ADMIN; starts a numbered run, snapshots every BOM line, issues requested (or default raw) materials through the stock ledger, and records the material-cost snapshot and audit event.
- Test-only: `GET /api/_whoami`, `/api/_admin-only`, `/api/_approve-only`.
- Stock availability subtracts outstanding approved/invoiced reservations; purchase cost averages use Decimal rates; adjustment quantities are positive magnitudes with IN/OUT direction, and adjustment history uses `createdAt`.

## Decisions (deviations from AI_CONTEXT.md and why)
- DB host port is 5433 because the Windows PostgreSQL service occupies 5432
- No round-off line; GST is computed per invoice line and then summed.
- Authentication reloads the account and role for every request, so deactivation, deletion, and role changes take effect without waiting for token expiry.
- Failed-login audits store the attempted email but never the password; unknown-email attempts have a null userId. Audit list `from`/`to` bounds are inclusive and `limit` is capped at 100.
- Opening stock movements use their item id as `sourceId` because the model has no separate opening-document record.
- Financial-year ranges use an inclusive IST-midnight start and exclusive next-year IST-midnight end.
- BOM cloning supports pack-size variants in one call: retain raw-material lines and replace packaging items for a new finished SKU; the source BOM remains unchanged.
- Planned consumption rounds fractional batch counts to four decimals and each resulting output/material quantity to the nearest integer using half-up rounding.
- A run line's `issuedQty` records total quantity leaving stock for the run (consumed plus scrap); step 17 starts raw-material issues, while packaging can be issued at completion.

## Assumptions (copy into README at the end)
- Project source and project guidance live at the Git repository root.
- `sumInvoice(lines)` expects each line to provide `taxablePaise`, `gstRateBp`, and `interState`.
- Opening finished goods are valued at Rs 30/packet (3000 paise), as the brief provides no cost.
- `seed:reset` preserves Prisma's `_prisma_migrations` table while truncating application tables.
- Purchase request quantities and rupee rates are decimal strings, keeping input conversion independent of binary floating-point.
- Customer price PUT accepts `{ prices: [...] }` and upserts only the submitted item prices.
- BOM PUT preserves existing notes when omitted; clone copies source notes. Clone line overrides apply only to items present after the requested replacements.
- Plan endpoint requires exactly one mode; issued quantities are interpreted in the selected BOM item's dimension and converted to base units.

## Known issues / TODO
- `npm install` reported 13 backend and 4 frontend dependency audit findings; review before deployment.
- No refresh-token or logout endpoint yet; access tokens expire after 12 hours, and deactivated or deleted accounts are rejected on each request.
- No Step 05-specific known issues.
- Prisma 6 warns that the requested `package.json#prisma` seed configuration is deprecated in Prisma 7.
- The append-only trigger blocks row UPDATE/DELETE; explicit reset helpers use TRUNCATE only on a dedicated/reset database. Tests require the migrated `oda_test` database.
- Benchmark stock snapshots are checked at the selected stage; later stages and not-yet-reached document checks print SKIPPED.
- Document counters roll back with failed writes when `nextNumber` receives the transaction client; each document service must preserve that transaction boundary.
- Purchases currently support create and read only; edit, cancellation, and purchase-return workflows are not implemented.
- Adjustments have no editable effective date; history filtering uses the recorded `createdAt`, and corrections always append rather than update or delete.
- Master data has no hard-delete endpoints; item deactivation is rejected while ledger balance is nonzero.
- BOMs have no delete endpoint; production-run history stays attached to its original recipe version.
- Production runs can be started and raw materials issued; completion/output/scrap, variance, and run history/cancellation remain Steps 18-20.
- Planned batch counts are capped at 100; fractional ingredient results are rounded to integer base units as required for stock quantities.
- Explicit `bomId` can start a run from that BOM version; `finishedItemId` resolves the active BOM.
- Test DB reset timeout raised for slow Windows/Docker.

## Benchmark status (stage: PASS/FAIL/SKIPPED)
opening PASS (6 checks; later-stage checks skipped)
after-purchase PASS (4 checks; later-stage checks skipped)
after-issue PASS (10 checks; later-stage checks skipped)
