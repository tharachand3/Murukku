# PROGRESS.md - live project memory (UPDATE AFTER EVERY STEP)
Last updated: (date) by (AI tool)

## Next Step
Step 01 - Monorepo scaffold, Docker Postgres, health check

## How to run (keep accurate)
(nothing runnable yet)

## Step checklist (tick when DONE and VERIFIED)
### Phase 1 - Foundation
[ ] 01 Monorepo scaffold, Docker Postgres, health check
[ ] 02 Prisma schema A: users, units, items, customers, suppliers, settings
[ ] 03 Prisma schema B: BOM, purchases, production runs, stock ledger, audit log
[ ] 04 Prisma schema C: orders, invoices, dispatch, payments, credit notes, counters
[ ] 05 Money, GST, units and variance libraries + unit tests
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
(empty)

## File map (path - purpose)
(empty)

## API endpoints (METHOD path - roles - purpose)
(empty)

## Decisions (deviations from AI_CONTEXT.md and why)
(empty)

## Assumptions (copy into README at the end)
(empty)

## Known issues / TODO
(none)

## Benchmark status (stage: PASS/FAIL/SKIPPED)
(not started)
