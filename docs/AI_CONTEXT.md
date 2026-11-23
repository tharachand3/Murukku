# AI_CONTEXT.md - stable project facts (source of truth)
Edit this file ONLY when a decision changes. Day-to-day progress goes in PROGRESS.md.

## 1. What we are building
A working prototype of an "Order-to-Audit" system for a small South Indian snack factory
(internship shortlisting task, Centre for Digital Infrastructure, NIT Tiruchirappalli).
Two loops that meet at FINISHED-GOODS STOCK:
- SALES: salesman order (mobile) -> admin verifies -> GST invoice (PDF) -> dispatch
  (stock down) -> payments / outstanding.
- PRODUCTION: purchase raw material -> issue to a production run against a BOM (recipe)
  -> actual output + scrap -> finished goods (stock up) -> variance + cost per packet.
Every transaction is entered ONCE at its source; stock, costing, reports derive from it.
No accounting software (Tally) needed. Evaluation: benchmark correctness 30%, production
+ inventory design 20%, sales flow 15%, data model + code quality + tests 15%, usability
10%, reports + docs 10%. A smaller system that passes the benchmark beats a bigger one
that does not.

## 2. Fixed stack (do not change)
Backend: Node 20, Express, JavaScript ES modules (NOT TypeScript), PostgreSQL 16, Prisma,
zod, decimal.js, vitest + supertest, jsonwebtoken + bcryptjs, pdfkit (invoice PDF),
json2csv/exceljs (exports, added when needed).
Frontend: React 18 + Vite + Tailwind CSS v3.4 + react-router-dom + axios (JavaScript).
Run: Docker Compose (db first, full stack at step 58).
Why (for README): PERN already known; SQL gives transactions, constraints and a trustworthy
ledger; Prisma gives a readable schema and migrations.

## 3. Repo layout
AGENTS.md  docs/{AI_CONTEXT.md,PROGRESS.md,DATA_MODEL.md}  docker-compose.yml  README.md
backend/{prisma, src/{config,routes,services,middleware,lib}, scripts, tests}
frontend/src/{pages,components,lib,context}

## 4. Hard rules (never break)
R1  Stock = SUM(StockMovement.qtyChange). NEVER store or overwrite a balance.
    StockMovement is append-only (DB trigger blocks update/delete). Fix errors with a
    new ADJUSTMENT movement.
R2  Every movement has sourceType + sourceId + sourceRef (traceability).
R3  Money = integer PAISE. Rates per base unit = Decimal(18,6) paise via decimal.js.
    No JS floats for money or quantity. Round half up, only at line level.
R4  Quantities = integers in BASE units (g, ml, pcs/packets). Convert only at the edge
    (API output / UI) with lib/units.js.
R5  Any multi-table write runs inside ONE prisma.$transaction. Stock changes go ONLY
    through services/ledgerService.js.
R6  Business logic lives in src/services. Routes are thin: auth, validate, call service,
    respond.
R7  Posted invoices are never deleted. Cancel = credit note + stock reversal if dispatched.
R8  Create/update/cancel of invoices, production runs, order approvals, payments and
    adjustments write an AuditLog row (user + time + before/after) in the same transaction.
R9  Every endpoint is authenticated + role-checked (config/permissions.js). Inputs
    validated with zod. Errors via AppError: {error:{code,message,details}}.
R10 Tests (vitest) for money, GST, units, variance, ledger, and the benchmark.
R11 Dates stored UTC, shown in IST (Asia/Kolkata). Financial year = April-March, "2026-27".
R12 Minimal dependencies, no paid services, no secrets in git.

## 5. Conventions
- Document numbers: PREFIX/FY/0001 e.g. INV/2026-27/0001. Prefixes: INV, PUR, RUN, ORD,
  DSP, RCT (receipt), CN. Generated from DocumentCounter inside the transaction.
- Display units: flour kg, oil l, spice kg, pouches/cartons pcs, finished packets.
  Carton (of packets) = item.packsPerCarton (Murukku 200 g: 20 packets).
- GST: gstRateBp in basis points (5% = 500). Same state as seller (TN = "33") -> CGST+SGST
  (half each, cgst = floor(tax/2), sgst = tax - cgst). Different state -> IGST.
  Tax per line = round_half_up(taxable * rateBp / 10000). No round-off line.
- Variance bp = round_half_away((actual - planned) * 10000 / planned).
  Flag only if abs(bp) > toleranceBp (default 300 = 3.00%, STRICTLY greater).
- Order status: SUBMITTED -> APPROVED | REJECTED -> INVOICED -> DISPATCHED
  (CANCELLED only before invoicing). Stock goes down at DISPATCH only.
- Availability for approval = FG balance - qty on APPROVED/INVOICED orders not yet
  dispatched (reserved).
- API: JSON, /api prefix, list endpoints take ?page&limit, dates ISO, quantities returned
  both as base integer and display string.
- Costing: weighted average = total value of priced receipts (OPENING, PURCHASE,
  SALES_RETURN) / their total qty, up to the issue date. Overheads (labour, power/gas) are
  charged fully to the run; cost per packet = (material + overhead) / good packets.

## 6. Roles (see backend/src/config/permissions.js)
SALESMAN: create/see OWN orders, customer-wise sales, finished-goods availability.
ADMIN: orders, approval, invoices, dispatch, payments, masters, users, read stock.
PRODUCTION: purchases (receipts), issues, production runs, stock, BOM read.
ACCOUNTANT: read-only reports, exports, ledger, audit log.
OWNER: dashboard + all reads.
Demo logins (password for all: Demo@123): admin@demo.com, production@demo.com,
salesman.a@demo.com, salesman.b@demo.com, accountant@demo.com, owner@demo.com.

## 7. Master data (BASE units in brackets)
BOM "Murukku 200 g", one batch = 200 packets:
 Flour 40 kg (40000 g) | Oil 10 l (10000 ml) | Salt+spice 1.2 kg (1200 g)
 200 g pouch 200 pcs | Carton 10 pcs (each carton holds 20 packets)
Rates: flour Rs 42/kg opening + Rs 45/kg new purchase; oil Rs 140/l; spice Rs 200/kg;
pouch Rs 2.50; carton Rs 15. Selling price Rs 50/packet before tax, GST 5%.
Opening stock: flour 100 kg, oil 30 l, spice 5 kg, pouches 500, cartons 30, finished 50.
Factory in Tamil Nadu (33). Retailer A = Tamil Nadu (33). Distributor B = Karnataka (29).

## 8. Benchmark scenario (must run end to end)
1 Purchase 60 kg flour @ Rs 45/kg.
2 Production run: issue flour 40 kg, oil 10.5 l (0.5 over), spice 1.2 kg.
3 Actual output 188 good packets, 6 pouches damaged, 9 cartons used.
4 Salesman A orders 150 packets for Retailer A (TN).
5 Admin approves, GST invoice (CGST+SGST), dispatch.
6 Salesman B orders 120 packets for Distributor B (KA): shortage flagged.
7 Payment Rs 4,000 from Retailer A.
8 Add labour Rs 1,200 + gas/power Rs 600 to the run: show cost per packet.
9 Generate all monthly reports.
EXPECTED: flour 120 kg | oil 19.5 l | pouches 306 (188 used + 6 damaged = 194 issued) |
spice 3.8 kg | cartons 21 | FG after run 238 | FG after dispatch 88 |
yield variance 188 vs 200 = -6% FLAGGED | oil variance +5% FLAGGED |
Retailer A invoice Rs 7,500 + 187.50 CGST + 187.50 SGST = Rs 7,875 | outstanding Rs 3,875 |
Distributor B: shortage 32 packets (120 - 88); IGST 5% applies if invoiced (Rs 6,000 +
Rs 300 IGST = Rs 6,300 for the full 120).
REFERENCE COST (weighted average; derived by us, state method in README):
 flour 160 kg value Rs 6,900 -> Rs 43.125/kg -> 40 kg = Rs 1,725
 oil 10.5 l x 140 = 1,470 | spice 1.2 kg x 200 = 240 | pouches 194 x 2.50 = 485
 cartons 9 x 15 = 135 -> materials Rs 4,055; overheads Rs 1,800; total Rs 5,855
 cost per good packet = 5,855 / 188 = Rs 31.14; margin vs Rs 50 = Rs 18.86 (37.7%).
Extra flags are legitimate and must be explained in README: cartons 9 vs 10 = -10%
(flagged); pouches 194 vs 200 = -3.00% (NOT flagged, not strictly greater than 3%).

## 9. Assumptions already made (add more in PROGRESS.md)
- HSN for Murukku = 21069099 (dummy but plausible); GST 5% as told by the brief.
- Opening finished goods valued at Rs 30/packet (brief gives no cost).
- Demo company: "Sri Murugan Snacks (Demo)", GSTIN 33ABCDE1234F1Z5. All data is invented.
- Full cancellation only (credit note for whole invoice) in v1; partial dispatch optional.
