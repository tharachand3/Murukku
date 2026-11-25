# PROGRESS.md - live project memory (UPDATE AFTER EVERY STEP)
Last updated: 2026-11-26 by Copilot

## Next Step
Step 32 - Shortage flow

## How to run (keep accurate)
- Install dependencies: `npm --prefix backend install`; start/stop PostgreSQL on port 5433 with `npm run db:up` / `npm run db:down`.
- Create `oda_test` once: `docker compose exec -T db createdb -U oda oda_test`. From `backend/`, set `$env:DATABASE_URL = 'postgresql://oda:oda@localhost:5433/oda_test?schema=public'`, run `npx prisma migrate deploy` and `npx prisma generate`, then `Remove-Item Env:DATABASE_URL`; Vitest refuses non-test databases. Step 28 migration `20261125173751_invoice_snapshot_immutable` is applied to `oda_test`.
- Run backend tests from `backend/`: `npm test`. Build the frontend with `npm --prefix frontend run build`.
- Payments verification: from `backend/`, run `npm test -- tests/outstanding.test.js tests/payments.test.js`.
- Credit-note verification: from `backend/`, run `npm test -- tests/creditNote.test.js`.
- Run the API benchmark from `backend/` after `npm run seed:reset` with the API running: `npm run bench:play` (optional `-- --upto=1|2|3`, `API_URL` overrides the default); then run `npm run bench:check -- --stage=after-run`.
- Order catalog: authenticated `GET /api/catalog/order-items?customerId=<id>` for SALESMAN/ADMIN; customer prices override defaults, and items without a positive price are omitted.
- Create an order with SALESMAN `POST /api/orders` using `{ clientRef?, customerId, notes?, lines: [{ itemId, qty }] }`; prices are resolved server-side, and retrying a supplied `clientRef` returns the existing order.
- Read orders with `GET /api/orders` (salesmen see only their own; ADMIN/OWNER/ACCOUNTANT see all) and `GET /api/orders/:id`; `GET /api/orders/my/customer-sales` is SALESMAN-only. `from`/`to` use inclusive IST calendar dates.
- Check stock before approval with `GET /api/orders/:id/availability` (ADMIN/OWNER). Approved/invoiced undispatched quantities are reserved; partial dispatch reduces both on-hand and reservation.
- Admin order changes require `orders:approve`: `PATCH /api/orders/:id/lines`, `POST /api/orders/:id/approve`, `POST /api/orders/:id/reject`, and `POST /api/orders/:id/cancel`. Approval freezes effective quantities/prices and requires enough unreserved stock; partial approval is allowed, and manual cancellation is limited to SUBMITTED/APPROVED.
- Preview GST with `GET /api/orders/:id/invoice-preview` (ADMIN/ACCOUNTANT/OWNER); only SUBMITTED/APPROVED orders are previewable. Tax is rounded per line and summed; preview does not create invoices or consume numbers.
- Create an invoice from an APPROVED order with `POST /api/invoices` (ADMIN); read/filter invoices with `GET /api/invoices` and `GET /api/invoices/:id` (ADMIN/ACCOUNTANT/OWNER). Posted invoices snapshot seller/buyer/order and line tax data; the database blocks invoice deletes, line edits, and changes to posted invoice fields.
- Dispatch an invoice with `POST /api/dispatches` (ADMIN), optionally providing partial `lines`; omitted lines dispatch all remaining quantities. Read dispatches with `GET /api/dispatches` and `GET /api/dispatches/:id` (ADMIN/ACCOUNTANT/OWNER), and check invoice quantities with `GET /api/invoices/:id/dispatch-status`.
- Payments: `POST /api/payments` (ADMIN) records an invoice-linked or unallocated payment; `GET /api/payments?customerId=&invoiceId=&mode=&from=&to=&page=&limit=`, `GET /api/payments/outstanding`, and `GET /api/payments/outstanding/:customerId` (ADMIN/ACCOUNTANT/OWNER). Date filters use inclusive IST days.
- Stock readers can use `GET /api/stock/finished-availability` for reservation/free totals; non-salesman responses include `reservedPackets` and `freePackets`, while salesman response fields stay backward-compatible.
- Start API/UI in separate terminals: `npm run dev:backend` and `npm run dev:frontend`.
- Prisma commands from `backend/`: `npx prisma format`, `npx prisma validate`, `npx prisma migrate dev`, `npx prisma migrate status`.
- Seed with `npm run seed`; reset/reseed (destructive; production is refused) with `npm run seed:reset`; print ledger balances with `npm run balances`.
- Run benchmarks from `backend/`: `npm run bench:check -- --stage=opening`; available stages: `after-purchase`, `after-issue`, `after-run`, `after-dispatch`, `final`.
- Purchase receipts use PRODUCTION/ADMIN and decimal-string qty/rates; check with `npm run bench:check -- --stage=after-purchase`. Adjustments use ADMIN/PRODUCTION with positive qty and IN/OUT direction.
- Numbering tests: `npm test -- tests/lib/fy.test.js tests/numberingService.test.js`. Call `nextNumber(tx, 'INV', date)` inside the document transaction to avoid burning numbers on rollback.
- Demo password is `Demo@123` for `admin@demo.com`, `production@demo.com`, `salesman.a@demo.com`, `salesman.b@demo.com`, `accountant@demo.com`, and `owner@demo.com`. Login at `POST /api/auth/login` and use the token as `Authorization: Bearer <token>`.
- Master data reads require authentication; writes are ADMIN-only. SALESMAN customer reads are assignment-scoped. BOM reads allow ADMIN/PRODUCTION/ACCOUNTANT/OWNER; writes allow ADMIN/PRODUCTION.
- BOM planning: `GET /api/boms/:id/plan` with exactly one mode, `?batches=2.5`, `?targetOutput=300`, or `?itemId=1&qty=20&unit=kg`; max 100 batches.
- Start a run with `POST /api/production/runs` (PRODUCTION/ADMIN), providing exactly one of `bomId` or `finishedItemId`; the latter selects the active BOM. Optional `issues` use decimal-string quantities and units.
- Complete an ISSUED run with `POST /api/production/runs/:id/complete` (PRODUCTION/ADMIN), supplying actual good/rejected output and optional consumed/scrapped BOM quantities.
- Read completed run variance with `GET /api/production/runs/:id/variance`; list completed runs and alert counts with `GET /api/production/variance?from=&to=&flaggedOnly=true&page=&limit=` (PRODUCTION/ADMIN/ACCOUNTANT/OWNER).
- Browse runs with `GET /api/production/runs?status=&from=&to=&finishedItemId=&page=&limit=` and `GET /api/production/runs/:id` (PRODUCTION/ADMIN/ACCOUNTANT/OWNER); update only `notes`/`batchNo` with `PATCH /api/production/runs/:id`, or cancel an ISSUED run with `POST /api/production/runs/:id/cancel` (PRODUCTION/ADMIN).
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
17-21 [x] production start/issues, completion/output/scrap, variance/tolerance, run history/edit/cancel, API benchmark steps 1-3.
### Phase 4 - Sales loop
22 [x] customer/default price resolution and salesman catalog; 23 [x] order creation with idempotent clientRef; 24 [x] role-scoped order lists/details, status timeline, and salesman customer sales; 25 [x] finished-goods availability, reservations, and shortage checks; 26 [x] admin order edit/approve/reject/cancel; 27 [x] per-line GST calculator and order invoice preview; 28 [x] immutable GST invoices; 29 [x] dispatch; 30 [x] payments and customer outstanding; 31 [x] invoice cancellation and credit notes; 32-33 [ ] shortage flow; benchmark steps 4-7.
### Phase 5 - Costing
34-36 [ ] weighted average; overhead allocation; packet cost/margin.
### Phase 6 - Reports and PDF
37-45 [ ] sales/customer/product/GST/stock/purchase/production/receivables reports; exports; invoice PDF.
### Phase 7 - Frontend
46-56 [ ] router/auth/role layouts; login; salesman orders/customers; admin orders/invoices; production/stock/reports pages; dashboard/alerts.
### Phase 8 - Ship
57-60 [ ] full benchmark/fixes; deployment; README/design note; demo/interview/final audit.

## Log (newest first, max 5 lines per step, condense old entries when file > 250 lines)
- Step 31 (2026-11-26): Added atomic full-invoice cancellation, mirrored credit notes, returned dispatched quantities through the stock ledger, preserved payment credit, and added credit-note reads and API/unit coverage. Files: credit-note service/route, additive invoice route/app changes, new tests, and this log. `npm test` passes (189; baseline 180). Decisions: order is cancelled and cannot be invoiced again; goods are assumed returned and saleable; Step 39 GST summaries must subtract credit notes.
- Step 30 (2026-11-26): Added integer outstanding helpers, transactional receipt creation with customer/invoice locks and audit, outstanding/payment reads, IST filtering, RBAC, and API/unit coverage. Files: payment/outstanding services and routes, app/permissions, new tests, and this log. `npm test` passes (180; baseline 169). Decisions: reject overpayment, subtract all customer payments from posted invoices, count payments linked to cancelled invoices as customer credit; payment reversal is deferred.
- Step 29 (2026-11-25): Added transactional full/partial dispatch, invoice and item locks, reservation guard, ledger movements, audit/order status updates, dispatch reads, and invoice dispatch status. Files: dispatch service/route, invoice route, app/permissions, new dispatch tests, and this log. `npm test` passes (169; baseline 161), including 8 new tests. Decisions: dispatch is the sales stock-out point; DISPATCH ledger rows carry no rate; an order becomes DISPATCHED only when its invoice is fully dispatched.
- Step 28 (2026-11-25): Added transactional invoice creation from approved orders, FY numbering, seller/buyer/order and line snapshots, immutable DB triggers, filtered list/detail APIs, and order timeline audit. Files: schema/migration, invoice service/route, app mount, new invoice tests, data model, and this log. `npm test` passes (161; baseline 152), including 9 new tests; migration deployed to `oda_test`. Decision: invoice and invoice-line records are immutable except one invoice cancellation update; invoice creation does not change stock.
- Step 27 (2026-11-25): Added pure integer invoice math, seller settings lookup, effective-order GST drafts, and the role-gated invoice preview. Files: invoice math/service, additive order route, new unit/integration tests, and this log. `npm test` passes (152; baseline 140), including 12 new tests. Decision: calculate and round tax per line, then sum tax components; no round-off line.
- Step 26 (2026-11-25): Added transactional admin edits, stock-checked approvals with row locks, rejection/cancellation, audit notes, and strict routes. Files: order status helper, order service/routes, new admin/unit tests, and this log. `npm test` passes (140; baseline 131), including all 9 new tests. Decision: approval has no force option; partial quantities fit available stock, and invoiced/dispatched cancellation remains for the credit-note flow.
- Step 25 (2026-11-25): Added pure shortage math, read-only order availability, reservation accounting for approved/invoiced undelivered quantities, and explicit stock reservation/free fields for stock readers. Files: availability/shortage services, order/stock routes, permissions, new tests, and this log. `npm test` passes (131; baseline 120); tests build benchmark FG stock at 238 through production APIs and verify partial-dispatch ledger/reservation changes. Decision: preserve the existing `availablePackets` value and exact SALESMAN response shape; the additive fields are included for non-SALESMAN stock readers.
- Step 24 (2026-11-25): Added role-scoped order list/detail and salesman customer-sales reads, status labels/timeline, and a pure IST day-range helper. Files: order service/routes, auth capability middleware, IST helper, new unit/API tests, and this log. `npm test` passes (120; baseline 107). Decision: `from` starts at IST midnight and `to` includes its full IST day via an exclusive next-day bound; customer sales exclude REJECTED and CANCELLED orders.
- Step 23 (2026-11-25): Added strict, server-priced order creation with merged lines, transactional numbering/audit, and clientRef idempotency including concurrent retries; added integer order math. Files: order service/math, route, app mount, new tests, and this log. `npm test` passes (107; baseline 105); live API verified create 201 then same-ref retry 200 with the same order ID. Decision: mobile clients generate a UUID clientRef and retain it until a server response; taxable totals are labeled `taxableTotalPaise` because they exclude GST.
- Step 22 (2026-11-25): Added positive-paise customer/default price resolution and the role-gated order catalog with assignment checks and live finished-stock balances. Files: pricing helper/service, catalog route, app/permissions, new pricing/catalog tests, and this log. `npm test` passes (105; baseline 103); live API verified Retailer A at Rs 50.00 and an unassigned Distributor B request at 404. Decision: customer prices override defaults only when positive; unpriced finished items are omitted.
- Step 21 (2026-11-25): Added a seeded HTTP integration benchmark for purchase, issue, completion, variance, cost, audit, traceability, role access, and stock reconciliation; added `bench:play` and four staged ledger-reconciliation checks. Files: benchmark helper/test/playback/checker, backend package script, and this log. `npm test` passes (103); live playback and `after-run` check pass (16 PASS, 0 FAIL), and replay on the non-fresh database refuses as expected. Decision: reused `prisma/seed.js`, then set test demo password hashes to bcrypt cost 4; existing Vitest file serialization needed no change. The raw append-only UPDATE guard remains covered by the ledger service test.
- Step 20 (2026-11-25): Added filtered/paginated run history, detail with ledger/audit trail, audited notes/batch edits, and transactional cancellation with positive ledger reversals. Files: production service/routes/tests and this log. `npm test` passes (100); `npm run bench:check -- --stage=after-run` passes (12 checks). Decision: date filters use `startedAt`; completed runs require stock adjustments for correction and cannot be cancelled.
- Step 19 (2026-11-25): Added snapshot-tolerance yield/material variance calculations, persisted flags during completion, run detail and paginated/filterable variance APIs, and final benchmark variance assertions with carton/pouch informational output. Files: variance service, production service/route/tests, benchmark checker, and this log. Targeted variance tests pass (14); full `npm test` and API benchmark verification pass. Decision: flags use the run's saved tolerance and strict `abs(bp) > tolerance`; extra carton/pouch flags must be explained in README.
- Step 18 (2026-11-25): Added locked transactional completion, packaging consumption/scrap issues, finished output, final material-cost snapshot, audit, and `POST /api/production/runs/:id/complete`. Added full benchmark completion and rollback/validation tests, plus a completed-output benchmark assertion. Files: production service/route, production tests, benchmark checker, and this log. `npm test` passes (94); reset + purchase + start + complete + `after-run` benchmark passes (12 checks). Variance remains unset for Step 19.
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
- `backend/prisma/`: schema, invoice snapshot/immutability migration, append-only ledger and stock-adjustment migrations, and idempotent benchmark seed.
- `backend/scripts/`: guarded reset/reseed, balance output, staged benchmark checker, and API-only benchmark playback.
- `backend/src/config/`, `middleware/`: role/capability matrix, auth, validation, and centralized error handling.
- `backend/src/lib/`: Decimal money/GST/invoice/units/variance/BOM/pricing/order/shortage/outstanding math, order transitions, IST date ranges, FY, states, errors, audit, and async helpers.
- `backend/src/routes/`: health, auth, audit, stock/adjustments/finished availability, purchases, BOMs, production, catalog, orders and invoice preview, invoice create/read/cancel and dispatch status, credit notes, dispatches, payments/outstanding, items, customers/prices, suppliers, settings, and users.
- `backend/src/services/`: auth, append-only ledger, stock/availability, adjustment, purchase/costing/pricing/order workflows, GST drafts, invoice/dispatch/credit-note/payment workflows, BOM, production-run start/completion/variance/history/cancellation, master data, settings, and user logic.
- `backend/tests/`: API/unit suites including benchmark, pricing, catalog, order workflows, GST previews/invoice math, invoice creation/immutability/cancellation, credit notes, dispatch, payment/outstanding, order transitions/math, shortage math, and IST date coverage; `helpers/db.js` and setup guard test operations to `oda_test`.
- `frontend/`: Vite/React UI, Tailwind, API client, and `/api` proxy.

## API endpoints (METHOD path - roles - purpose)
- `/api/health`: `GET /` public. `/api/auth`: `POST /login` public; `GET /me` any authenticated user.
- `/api/audit`: `GET /` ADMIN/ACCOUNTANT/OWNER; newest-first filtered/paginated rows with user name.
- `/api/stock`: `GET /summary?type=`, `/ledger?itemId=&from=&to=`, `/items/:id/balance` ADMIN/PRODUCTION/ACCOUNTANT/OWNER; `GET /finished-availability` also SALESMAN, with reserved/free fields for non-salesman roles; `POST /adjustments` ADMIN/PRODUCTION; `GET /adjustments` stock-read roles.
- `/api/purchases`: `POST /` PRODUCTION/ADMIN; `GET /?page=&limit=&from=&to=&supplierId=` and `GET /:id` PRODUCTION/ADMIN/ACCOUNTANT/OWNER. Receipts write ledger and audit atomically.
- `/api/catalog`: `GET /order-items?customerId=` SALESMAN/ADMIN; salesmen can only access assigned customers. Returns priced active finished goods and current packet balances.
- `/api/orders`: `POST /` SALESMAN creates SUBMITTED orders using server-resolved prices; `GET /?status=&customerId=&salesmanId=&from=&to=&q=&page=&limit=` and `GET /:id` SALESMAN/ADMIN/OWNER/ACCOUNTANT, with salesmen restricted to their own orders; `GET /my/customer-sales?from=&to=` SALESMAN-only; `GET /:id/availability` ADMIN/OWNER; `GET /:id/invoice-preview` ADMIN/ACCOUNTANT/OWNER; `PATCH /:id/lines`, `POST /:id/approve`, `POST /:id/reject`, and `POST /:id/cancel` ADMIN-only. Approval checks unreserved finished stock; preview calculates GST per line without writes.
- `/api/invoices`: `POST /` ADMIN creates an immutable FY-numbered invoice from an APPROVED order; `GET /?status=&customerId=&from=&to=&q=&page=&limit=` and `GET /:id` ADMIN/ACCOUNTANT/OWNER; `GET /:id/dispatch-status` returns invoiced, dispatched, and remaining quantities.
- `/api/dispatches`: `POST /` ADMIN creates a full or partial dispatch; `GET /?invoiceId=&customerId=&from=&to=&page=&limit=` and `GET /:id` ADMIN/ACCOUNTANT/OWNER. Dispatch writes negative DISPATCH ledger movements; orders transition to DISPATCHED only when all invoice quantities are sent.
- `/api/payments`: `POST /` ADMIN records linked or unallocated receipts; `GET /?customerId=&invoiceId=&mode=&from=&to=&page=&limit=`, `GET /outstanding`, and `GET /outstanding/:customerId` ADMIN/ACCOUNTANT/OWNER. Date filters use inclusive IST days.
- `/api/credit-notes`: `GET /?customerId=&from=&to=&page=&limit=` and `GET /:id` ADMIN/ACCOUNTANT/OWNER. `POST /api/invoices/:id/cancel` ADMIN creates a full credit note and reverses dispatched stock.
- `/api/items`: `GET /?type=&active=`, `GET /:id` authenticated; `POST /`, `PATCH /:id` ADMIN.
- `/api/customers`: `GET /?type=&active=`, `GET /:id`, `GET /:id/prices` authenticated (salesmen assigned customers only); `POST /`, `PATCH /:id`, `PUT /:id/prices` ADMIN.
- `/api/suppliers`: `GET /?active=`, `GET /:id` authenticated; `POST /`, `PATCH /:id` ADMIN. `/api/settings`: `GET /` authenticated; `PUT /:key` ADMIN.
- `/api/users`: `GET /`, `POST /`, `PATCH /:id`, `POST /:id/reset-password` ADMIN; responses omit password hashes.
- `/api/boms`: `GET /?finishedItemId=&active=`, `GET /:id`, `GET /:id/plan` ADMIN/PRODUCTION/ACCOUNTANT/OWNER; `POST /`, `PUT /:id`, `POST /:id/clone` ADMIN/PRODUCTION. Plan accepts exactly one of `?batches=`, `?targetOutput=`, or `?itemId=&qty=&unit=`.
- `/api/production`: `POST /runs`, `POST /runs/:id/complete`, `PATCH /runs/:id`, and `POST /runs/:id/cancel` PRODUCTION/ADMIN; `GET /runs?status=&from=&to=&finishedItemId=&page=&limit=`, `GET /runs/:id`, `GET /runs/:id/variance`, and `GET /variance?from=&to=&flaggedOnly=&page=&limit=` PRODUCTION/ADMIN/ACCOUNTANT/OWNER. Run detail includes lines, ledger rows, and audit history; only ISSUED runs can be cancelled.
- Test-only: `GET /api/_whoami`, `/api/_admin-only`, `/api/_approve-only`.
- Stock availability subtracts outstanding approved/invoiced reservations; purchase cost averages use Decimal rates; adjustment quantities are positive magnitudes with IN/OUT direction, and adjustment history uses `createdAt`.

## Decisions (deviations from AI_CONTEXT.md and why)
- DB host port is 5433 because the Windows PostgreSQL service occupies 5432
- No round-off line; GST is computed per invoice line and then summed.
- Invoice snapshots are stored in `Invoice.snapshot`; database triggers prevent invoice/line deletion and line updates. Invoice cancellation may change only status, cancelledAt, and cancelReason, and only once.
- Authentication reloads the account and role for every request, so deactivation, deletion, and role changes take effect without waiting for token expiry.
- Failed-login audits store the attempted email but never the password; unknown-email attempts have a null userId. Audit list `from`/`to` bounds are inclusive and `limit` is capped at 100.
- Opening stock movements use their item id as `sourceId` because the model has no separate opening-document record.
- Financial-year ranges use an inclusive IST-midnight start and exclusive next-year IST-midnight end.
- BOM cloning supports pack-size variants in one call: retain raw-material lines and replace packaging items for a new finished SKU; the source BOM remains unchanged.
- Planned consumption rounds fractional batch counts to four decimals and each resulting output/material quantity to the nearest integer using half-up rounding.
- A run line's `issuedQty` records total quantity leaving stock for the run (consumed plus scrap); step 17 starts raw-material issues, while packaging can be issued at completion.
- Variance flags compare total issued quantities (consumed plus scrap) with BOM plan using the run's saved tolerance; `abs(bp)` must be strictly greater than tolerance. Cartons -10.00% are flagged and pouches -3.00% are not flagged at 300 bp; these are extra flags to explain in README.
- Production run list `from`/`to` filters apply inclusively to `startedAt`; cancellation reverses issued outflows as positive `ADJUSTMENT` ledger rows and retains all run history.
- Benchmark playback uses the public API and the existing hyphenated `after-run` checker stage; test seeding reuses `prisma/seed.js` and downgrades demo password hashes to bcrypt cost 4 for speed.
- Customer-specific prices take precedence over default selling prices only when positive integer paise; catalog entries without a positive resolved price are omitted.
- Order requests use server-side price snapshots and integer packet quantities; repeated clientRef requests from the same salesman are the mobile offline-sync idempotency contract.
- Order list and customer-sales date filters are YYYY-MM-DD IST calendar days; `to` is inclusive and implemented as an exclusive next-day instant.
- Availability reservations count effective quantities on APPROVED/INVOICED orders less dispatched quantities per item; SUBMITTED, REJECTED, CANCELLED, and DISPATCHED orders do not reserve.
- `availablePackets` retains the established reservation-adjusted value; new `reservedPackets`/`freePackets` fields are limited to non-SALESMAN finished-stock responses to preserve the existing exact SALESMAN payload.
- Order approval blocks on shortage with no force flag; admins can approve a smaller quantity. Manual cancellation is only for SUBMITTED/APPROVED orders; INVOICED/DISPATCHED cancellation belongs to the credit-note flow.
- Invoice GST is calculated and rounded per line before tax components are summed; no round-off line is added.
- Finished-goods stock is reduced for sales only at dispatch through `ledgerService.addMovement`; DISPATCH ledger rows have no rate because production cost is stored on the run.
- Dispatch locks invoice and item rows and checks free stock after reservations for other approved/invoiced orders; invoice quantities are never modified.
- An order becomes DISPATCHED only after every line on its invoice has been dispatched; partial dispatch keeps it INVOICED.
- Customer outstanding is `max(0, posted invoice totals - all customer payments)`; the negative difference is reported as credit. Overpayments are rejected, and an unallocated payment reduces customer-wide outstanding but cannot be an advance beyond the amount owed.
- Payments linked to a subsequently cancelled invoice remain in customer-wide paid totals and are reported as unallocated credit. The v1 payment API has no edit, delete, or reversal operation.
- Full invoice cancellation creates one credit note, changes only invoice status/cancellation fields, cancels the linked order, and appends positive SALES_RETURN movements for goods assumed to be physically returned and saleable. The unique `Invoice.orderId` means the order cannot be re-invoiced; create a new order instead. Step 39 GST summaries must subtract credit notes.

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
- Order approval blocks on stock shortage with no force option.
- Payment edit, delete, and reversal are not available in v1; correction requires a future credit/adjustment workflow.
- Cancelling a dispatched invoice containing an inactive item currently fails with ledger `addMovement`'s 422 `UNPROCESSABLE_ENTITY` response (the item id is in `details`) and the transaction rolls back.
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
- Completed production runs cannot be cancelled; correct them with stock adjustments. Cancelled runs retain their plan, line quantities, and ledger history.
- Planned batch counts are capped at 100; fractional ingredient results are rounded to integer base units as required for stock quantities.
- Explicit `bomId` can start a run from that BOM version; `finishedItemId` resolves the active BOM.
- Test DB reset timeout raised for slow Windows/Docker.
- `bench:play` requires a fresh seed (100 kg flour and no production runs); rerunning it against a used benchmark database is intentionally refused.
- The salesman catalog intentionally omits active finished goods with no positive customer-specific or default price.
- Order retries are deduplicated only when the client supplies a valid `clientRef`.
- No Step 29-specific dispatch issues are known.
- Finished-stock availability retains its legacy `availablePackets` behavior; use the explicit `reservedPackets` and `freePackets` fields for those values in non-SALESMAN responses.

## Benchmark status (stage: PASS/FAIL/SKIPPED)
opening PASS; after-purchase PASS; after-issue PASS; after-run PASS (latest: 16 PASS, 0 FAIL, 24 SKIPPED; all four ledger-reconciliation stage assertions PASS)
variance PASS (yield -600 bp and oil +500 bp flagged; flour/spice 0 bp, pouches -300 bp not flagged, cartons -1000 bp flagged)
sales stages SKIPPED

## Day 1 checkpoint
Steps 01-21 done. Run `npm run bench:play` from `backend/` against a fresh seed, then `npm run bench:check -- --stage=after-run`.
Current PASS rows: purchase receipt (60 kg at Rs 45/kg), flour weighted-average rate (4.3125), purchases count (1), started runs count (1); after-run balances flour 120 kg, oil 19.5 l, spice 3.8 kg, pouches 306 pcs, cartons 21 pcs, finished goods 238 packets; completed run with 188 good packets and material cost 405500 paise.
