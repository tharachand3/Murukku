# PROMPTS.md - copy one prompt at a time into your AI tool

## Helper prompts

### RESUME prompt - use when you switch AI account, or lose track
```
Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md. Do NOT change any code.
Then:
1. Tell me in 10 lines or fewer: what is built, what is the Next Step, and any Known issues.
2. Run the test suite and the benchmark checker (npm run bench:check if it exists) and report
   real results.
3. If PROGRESS.md disagrees with the real code (a ticked step is missing, a file is absent),
   list the mismatches and propose the smallest fix. Wait for my go-ahead before fixing.
```

### REPAIR prompt - use when a step fails twice
```
Step <NN> is not working. Read AGENTS.md, docs/AI_CONTEXT.md, docs/PROGRESS.md.
Symptom: <paste the exact error or wrong output>
Command I ran: <command>
1. Reproduce the failure yourself by running the command.
2. Find the ROOT CAUSE (explain in 3 lines). Do not guess, do not rewrite unrelated files.
3. Make the smallest fix, add or adjust a test that would have caught it, re-run everything.
4. Add a line under Known issues / Decisions in docs/PROGRESS.md and commit
   "fix step <NN>: <what>".
```

### EXPLAIN prompt - run after every phase (the interview asks you to explain and change code live)
```
Read AGENTS.md, docs/AI_CONTEXT.md, docs/PROGRESS.md. I must explain this code in an
interview and change it live. For the files created or changed in steps <A> to <B>:
1. For each file: purpose in one line, the 2-3 most important functions, and WHY it is designed
   that way.
2. Draw the data flow of the main feature as a numbered list (request -> route -> service ->
   ledger/db -> response).
3. Give me a 6-line memory trick (a mnemonic or story) to remember the flow.
4. Ask me 8 likely interview questions about this code, with short model answers, and 2
   "change it live" tasks (like: add a 500 g pack sharing the same BOM) with the exact files I
   would touch.
Do not modify code.
```

### CHAT-ONLY wrapper - for AI tools that cannot read your repo (plain web chat)
```
You are my senior engineer. I cannot give you repo access, so I paste the project memory.
[PASTE docs/AI_CONTEXT.md]
[PASTE docs/PROGRESS.md]
[PASTE the files you need to touch, listed in the File map: e.g. prisma/schema.prisma]
Now do this step: [PASTE the step prompt, you may delete its START/END blocks].
Rules: output COMPLETE files (path as a heading, then the full code) - no snippets, no
"rest unchanged". At the end output the exact new content of docs/PROGRESS.md (full file) so I
can save it, and the commit message to use.
```

## Step prompts 01-10

### PROMPT 01 - Monorepo scaffold, Docker Postgres, health check
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 01 - Monorepo scaffold, Docker Postgres, health check.

ROOT (do not touch docs/ or AGENTS.md):
- package.json (private) scripts: dev:backend = "npm --prefix backend run dev", dev:frontend =
  "npm --prefix frontend run dev", db:up = "docker compose up -d db", db:down =
  "docker compose down", test = "npm --prefix backend test".
- .gitignore: node_modules, .env, dist, coverage, *.log, .DS_Store, backend/uploads.
- docker-compose.yml with ONE service now: db (image postgres:16-alpine, POSTGRES_USER=oda,
  POSTGRES_PASSWORD=oda, POSTGRES_DB=oda, ports 5432:5432, named volume pgdata, healthcheck
  with pg_isready). Comment: backend and frontend services are added in step 58.

BACKEND (backend/): Node 20, ES modules ("type":"module"), plain JavaScript.
- Dependencies: express, cors, dotenv, zod, decimal.js, @prisma/client.
  Dev: prisma, vitest, supertest, nodemon.
- Scripts: dev (nodemon src/server.js), start, test (vitest run), test:watch,
  prisma:migrate (prisma migrate dev), prisma:generate, seed (node prisma/seed.js).
- Folders with .gitkeep: src/{config,routes,services,middleware,lib}, prisma, tests, scripts.
- src/config/env.js: load dotenv, validate with zod: DATABASE_URL, JWT_SECRET (min 16 chars),
  PORT (default 4000), CORS_ORIGIN (default http://localhost:5173), TZ (default
  Asia/Kolkata). Export a frozen config object. Exit with a clear message when invalid.
- src/lib/prisma.js: ONE exported PrismaClient.
- src/app.js: builds and exports the express app (json limit 1mb, cors, tiny request logger,
  routes under /api, 404 handler returning {error:{code:"NOT_FOUND",message}}). No listen().
- src/server.js: imports app, listens on config.PORT, graceful shutdown ($disconnect).
- src/routes/health.js: GET /api/health -> {ok:true, db:true|false, time:<ISO>} using
  prisma.$queryRaw SELECT 1; if the query throws return db:false with HTTP 200.
- prisma/schema.prisma: ONLY generator + datasource (postgresql, env DATABASE_URL).
- .env.example: DATABASE_URL="postgresql://oda:oda@localhost:5432/oda?schema=public",
  JWT_SECRET="change-me-to-a-long-random-string", PORT=4000,
  CORS_ORIGIN="http://localhost:5173". Also create the real backend/.env (gitignored).
- tests/health.test.js (supertest): GET /api/health -> 200 and body.ok === true.

FRONTEND (frontend/): Vite + React (JavaScript) + Tailwind CSS v3.4 (with postcss and
autoprefixer, NOT v4) + react-router-dom + axios.
- Dev server port 5173 with proxy /api -> http://localhost:4000.
- src/lib/api.js: axios instance, baseURL "/api".
- src/App.jsx: centered card "Order-to-Audit System" showing "API: connected" (green) or
  "API: down" (red) from GET /api/health.

Do NOT add Prisma models, auth, or any feature yet.

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 01: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- docker compose up -d db
- cd backend && npm i && npx prisma generate && npm run dev
- curl localhost:4000/api/health  (expect ok:true, db:true)
- cd frontend && npm i && npm run dev -> open localhost:5173 (green 'API: connected')
- cd backend && npm test (1 passing)

### PROMPT 02 - Prisma schema A: users, units, items, customers, suppliers, settings
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 02 - Prisma schema part 1: identity and master data.

Edit backend/prisma/schema.prisma. Add ONLY the enums and models below (later steps add the
rest). Int autoincrement ids. Add createdAt/updatedAt where listed. Add @@index on foreign
keys used for lookups. Give explicit relation names where two relations point to the same
model. Comment every non-obvious field.

enum Role { SALESMAN ADMIN PRODUCTION ACCOUNTANT OWNER }
enum ItemType { RAW PACKAGING FINISHED }
enum UnitDimension { MASS VOLUME COUNT }
enum CustomerType { RETAILER DISTRIBUTOR }

model User: id, name, email (unique), passwordHash, role Role, isActive Boolean default true,
  createdAt, updatedAt.
model Unit: id, code (unique: g, kg, ml, l, pcs, packet), name, dimension UnitDimension,
  baseFactor Int (how many BASE units one of this unit equals: g=1, kg=1000, ml=1, l=1000,
  pcs=1, packet=1).
model Item: id, code (unique), name, type ItemType, baseUnitId -> Unit (g, ml, pcs or packet),
  displayUnitId -> Unit (what humans see: kg, l, pcs, packet), hsnCode String?, gstRateBp Int
  default 0 (basis points: 5% = 500), packsPerCarton Int? (finished goods only, 20 for
  Murukku 200 g), sellingPricePaise Int? (default list price), reorderLevelBase Int?,
  isActive Boolean default true, createdAt, updatedAt.
model Customer: id, name, type CustomerType, gstin String?, stateCode String (GST state code,
  "33" Tamil Nadu, "29" Karnataka), stateName String, address String?, phone String?,
  assignedSalesmanId Int? -> User, isActive Boolean default true, createdAt, updatedAt.
model Supplier: id, name, gstin String?, stateCode String?, phone String?, address String?,
  isActive Boolean default true, createdAt.
model CustomerPrice: id, customerId -> Customer, itemId -> Item, pricePaise Int,
  @@unique([customerId, itemId]).
model Setting: key String @id, value String, updatedAt. (Keys used later: COMPANY_NAME,
  COMPANY_GSTIN, COMPANY_STATE_CODE, COMPANY_ADDRESS, VARIANCE_TOLERANCE_BP, FY_START_MONTH.)

Then run: npx prisma format ; npx prisma validate ; npx prisma migrate dev --name init_masters.
Create docs/DATA_MODEL.md with a Mermaid erDiagram of these models and 5 lines explaining
"money is integer paise, quantities are integer base units, why". This file grows in steps 3
and 4 and becomes the design note.
No seed data, no APIs in this step.

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 02: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- cd backend && npx prisma validate
- npx prisma migrate status  (all applied)
- npx prisma studio  -> tables exist and are empty
- docs/DATA_MODEL.md exists with the diagram

### PROMPT 03 - Prisma schema B: BOM, purchases, production runs, stock ledger, audit log
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 03 - Prisma schema part 2: BOM, purchasing, production, stock ledger, audit log.

Append to backend/prisma/schema.prisma. Keep part-1 models untouched except for the required
back-relation fields. Money = Int paise. Quantities = Int in the item's BASE unit. Rates per
base unit = Decimal @db.Decimal(18,6) paise per base unit (example: flour Rs 45/kg = 4500
paise per 1000 g = 4.5 paise/g).

enum MovementType { OPENING PURCHASE PRODUCTION_ISSUE PRODUCTION_OUTPUT PRODUCTION_SCRAP
  DISPATCH SALES_RETURN ADJUSTMENT }
enum SourceType { OPENING PURCHASE PRODUCTION_RUN INVOICE DISPATCH CREDIT_NOTE ADJUSTMENT }
enum RunStatus { ISSUED COMPLETED CANCELLED }
enum OverheadKind { LABOUR POWER_GAS OTHER }

model Bom: id, name, finishedItemId -> Item, version Int default 1, isActive Boolean default
  true, batchYieldQty Int (finished packets per ONE batch: 200), notes String?, createdAt,
  updatedAt. @@unique([finishedItemId, version]).
model BomLine: id, bomId -> Bom (onDelete Cascade), itemId -> Item, qtyPerBatch Int (base
  units per batch). @@unique([bomId, itemId]).

model Purchase: id, number String @unique, supplierId -> Supplier, purchaseDate DateTime,
  supplierInvoiceNo String?, totalPaise Int, notes String?, createdById -> User, createdAt.
model PurchaseLine: id, purchaseId -> Purchase (Cascade), itemId -> Item, qty Int,
  ratePaisePerBase Decimal(18,6), amountPaise Int, batchNo String?, expiryDate DateTime?.

model ProductionRun: id, runNo String @unique, bomId -> Bom, finishedItemId -> Item, status
  RunStatus, batchCount Decimal(10,4) default 1, plannedOutputQty Int, actualGoodQty Int?,
  rejectedFinishedQty Int default 0, yieldVarianceBp Int?, yieldFlagged Boolean default
  false, toleranceBpUsed Int, materialCostPaise Int?, overheadCostPaise Int?,
  costPerPacketPaise Decimal(14,4)?, batchNo String?, startedAt DateTime, completedAt
  DateTime?, startedById -> User, completedById -> User?, notes String?.
model ProductionRunLine: id, runId -> ProductionRun (Cascade), itemId -> Item, plannedQty Int,
  issuedQty Int, scrapQty Int default 0 (part of issuedQty that was damaged or wasted, e.g. 6
  pouches), varianceBp Int?, flagged Boolean default false, ratePaisePerBase Decimal(18,6),
  costPaise Int. @@unique([runId, itemId]).
model ProductionOverhead: id, runId -> ProductionRun (Cascade), kind OverheadKind, amountPaise
  Int, note String?.

model StockMovement (APPEND-ONLY LEDGER): id, itemId -> Item, movementType MovementType,
  qtyChange Int (signed: + in, - out, never 0), ratePaisePerBase Decimal(18,6)?, valuePaise
  Int?, sourceType SourceType, sourceId Int?, sourceRef String? (human number such as
  RUN/2026-27/0001), batchNo String?, expiryDate DateTime?, movementDate DateTime, note
  String?, createdById Int? -> User, createdAt DateTime default now().
  Indexes: [itemId, movementDate] and [sourceType, sourceId].
model AuditLog: id, userId Int? -> User, action String (CREATE, UPDATE, CANCEL, APPROVE,
  REJECT, LOGIN ...), entity String, entityId Int?, before Json?, after Json?, createdAt
  DateTime default now(). Index [entity, entityId].

Then: prisma format, validate, migrate dev --name ledger_bom_production.
Append these models to docs/DATA_MODEL.md (Mermaid) plus a 6-line plain-English explanation:
"stock = sum of ledger rows; production run writes ISSUE rows (raw down) and OUTPUT row
(finished up)". No seed, no APIs.

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 03: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- npx prisma validate
- npx prisma migrate status
- prisma studio shows StockMovement, Bom, ProductionRun, AuditLog

### PROMPT 04 - Prisma schema C: orders, invoices, dispatch, payments, credit notes, counters
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 04 - Prisma schema part 3: sales loop.

Append to backend/prisma/schema.prisma (keep all earlier models; add back-relations).
Money = Int paise.

enum OrderStatus { SUBMITTED APPROVED REJECTED INVOICED DISPATCHED CANCELLED }
enum InvoiceStatus { POSTED CANCELLED }
enum PaymentMode { CASH UPI BANK CHEQUE }

model Order: id, orderNo String @unique, clientRef String? @unique (idempotency key made by the
  mobile app so an offline order sent twice never duplicates), customerId -> Customer,
  salesmanId -> User, status OrderStatus default SUBMITTED, notes String?, rejectReason
  String?, createdAt, approvedById -> User?, approvedAt DateTime?, updatedAt.
model OrderLine: id, orderId -> Order (Cascade), itemId -> Item, qty Int (packets asked),
  pricePaise Int (unit price at order time), approvedQty Int?, approvedPricePaise Int?.
model Invoice: id, invoiceNo String @unique, financialYear String ("2026-27"), orderId Int?
  @unique -> Order, customerId -> Customer, issueDate DateTime, placeOfSupplyStateCode
  String, isInterState Boolean, taxableValuePaise Int, cgstPaise Int default 0, sgstPaise Int
  default 0, igstPaise Int default 0, totalPaise Int, status InvoiceStatus default POSTED,
  cancelledAt DateTime?, cancelReason String?, createdById -> User, createdAt.
model InvoiceLine: id, invoiceId -> Invoice (Cascade), itemId -> Item, description String,
  hsnCode String?, qty Int, ratePaise Int, taxableValuePaise Int, gstRateBp Int, cgstPaise
  Int, sgstPaise Int, igstPaise Int, totalPaise Int.
model Dispatch: id, dispatchNo String @unique, invoiceId -> Invoice, dispatchDate DateTime,
  vehicleNo String?, notes String?, createdById -> User.
model DispatchLine: id, dispatchId -> Dispatch (Cascade), itemId -> Item, qty Int.
model Payment: id, receiptNo String @unique, customerId -> Customer, invoiceId Int? ->
  Invoice, amountPaise Int, mode PaymentMode, reference String?, paymentDate DateTime, notes
  String?, createdById -> User, createdAt.
model CreditNote: id, noteNo String @unique, invoiceId -> Invoice, reason String,
  taxableValuePaise Int, cgstPaise Int, sgstPaise Int, igstPaise Int, totalPaise Int,
  createdById -> User, createdAt. (Full cancellation only in v1.)
model DocumentCounter: key String @id (example "INV:2026-27"), lastNumber Int default 0.

Add to docs/DATA_MODEL.md: the Mermaid for these models, and two short design notes:
(a) invoice lines SNAPSHOT rate, HSN and GST rate, so later master changes never alter a
posted invoice; (b) cancelling = credit note, never delete.
Record in PROGRESS Decisions: no round-off line; GST computed per line then summed.
Run prisma format, validate, migrate dev --name sales_loop. No APIs, no seeds.

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 04: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- npx prisma validate
- npx prisma migrate status
- DATA_MODEL.md now shows all models

### PROMPT 05 - Money, GST, units and variance libraries + unit tests
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 05 - Core libraries: money, GST, units, variance (pure functions) + unit tests.

Create dependency-light modules in backend/src/lib/ using decimal.js. ZERO floats for money.
No database access in these files. Named exports only.

1) money.js
- rupeesToPaise(input): string|number like "42.5" -> integer paise (Decimal, ROUND_HALF_UP).
  Throw on NaN or negative.
- paiseToRupeesString(paise) -> "7,875.00" (Indian grouping 1,23,456.00 is a bonus; test it
  if you add it).
- mulRateQty(ratePaisePerBase /*Decimal|string*/, qtyBase /*int*/) -> integer paise, ROUND_HALF_UP.
- allocate(totalPaise, weights[]) -> integer parts that sum EXACTLY to the total (largest
  remainder method).

2) gst.js
- calcLineGst({ taxablePaise, gstRateBp, interState }) -> { cgstPaise, sgstPaise, igstPaise,
  taxPaise, totalPaise }. taxPaise = round_half_up(taxablePaise * gstRateBp / 10000).
  Intra-state: cgst = floor(tax/2), sgst = tax - cgst. Inter-state: igst = tax.
- isInterState(sellerStateCode, placeOfSupplyStateCode) -> boolean.
- sumInvoice(lines) -> totals object.

3) units.js
- UNITS = { g:{dimension:'MASS',factor:1}, kg:{'MASS',1000}, ml:{'VOLUME',1}, l:{'VOLUME',1000},
  pcs:{'COUNT',1}, packet:{'COUNT',1} }.
- toBase(qty /*string|number|Decimal*/, unitCode) -> integer base units; throw a clear error
  if the result is not an integer (example 0.0005 kg).
- fromBase(baseQty, unitCode) -> Decimal; formatQty(baseQty, unitCode) -> "10.5 l".
- convert(qty, fromUnit, toUnit) only within the same dimension, else throw.
- packetsToCartons(packets, packsPerCarton) -> { cartons, loosePackets } (238,20 -> 11 + 18).

4) variance.js
- varianceBp(planned, actual) = round_half_away_from_zero((actual - planned) * 10000 /
  planned); planned 0 -> throw.
- isFlagged(bp, toleranceBp) = Math.abs(bp) > toleranceBp (STRICTLY greater; exactly 3.00% is
  NOT flagged).
- describeVariance(planned, actual, toleranceBp) -> { plannedQty, actualQty, diffQty, bp,
  pct:'-6.00', flagged }.

Write vitest tests in backend/tests/lib/*.test.js covering AT LEAST:
Rs 42.5 -> 4250 paise | 150 x 5000 paise = 750000 | GST 5% on 750000 -> cgst 18750, sgst
18750, total 787500 | inter-state 5% on 600000 -> igst 30000 | odd split (tax 3 paise -> cgst
1, sgst 2) | allocate(1000,[1,1,1]) sums to 1000 | toBase(10.5,'l') = 10500 |
toBase(1.2,'kg') = 1200 | toBase(0.0005,'kg') throws | packetsToCartons(238,20) |
varianceBp(200,188) = -600 | varianceBp(10000,10500) = 500 | varianceBp(200,194) = -300 and
NOT flagged at tolerance 300 | varianceBp(10,9) = -1000 flagged.

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 05: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- cd backend && npm test  (all lib tests pass)
- grep -rn "parseFloat\|toFixed" src/lib  (must be empty for money paths)

### PROMPT 06 - Seed script with the section 5 benchmark master data
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 06 - Seed script: exact section 5 master data + opening stock.

Create backend/prisma/seed.js (ES module, @prisma/client, install bcryptjs). It must be
IDEMPOTENT (upsert / only-if-absent). Wire "prisma": {"seed": "node prisma/seed.js"} in
package.json. Add scripts/reset-db.js (TRUNCATE all tables RESTART IDENTITY CASCADE, then run
seed; refuse if NODE_ENV=production) as npm script "seed:reset".

Seed in this order:
1. Units: g(1) kg(1000) ml(1) l(1000) pcs(1) packet(1) with dimensions.
2. Settings: COMPANY_NAME="Sri Murugan Snacks (Demo)", COMPANY_GSTIN="33ABCDE1234F1Z5",
   COMPANY_STATE_CODE="33", COMPANY_ADDRESS="Demo Industrial Estate, Tiruchirappalli,
   Tamil Nadu 620015", VARIANCE_TOLERANCE_BP="300", FY_START_MONTH="4".
3. Items (base / display unit): FLOUR raw g/kg | OIL raw ml/l | SPICE "Salt and spice mix"
   raw g/kg | POUCH200 "200 g pouch" packaging pcs/pcs | CARTON "Carton (holds 20 packets)"
   packaging pcs/pcs | MURUKKU200 "Murukku 200 g" finished packet/packet, hsnCode
   "21069099" (assumption), gstRateBp 500, packsPerCarton 20, sellingPricePaise 5000.
4. Supplier: "Demo Flour Mills" (state 33).
5. Customers: "Retailer A" RETAILER gstin "33AAAAA0000A1Z5" state 33 Tamil Nadu (assigned
   to salesman.a); "Distributor B" DISTRIBUTOR gstin "29BBBBB1111B1Z5" state 29 Karnataka
   (assigned to salesman.b).
6. Users, password "Demo@123" for all (bcrypt cost 10): admin@demo.com ADMIN,
   production@demo.com PRODUCTION, salesman.a@demo.com SALESMAN, salesman.b@demo.com
   SALESMAN, accountant@demo.com ACCOUNTANT, owner@demo.com OWNER.
7. BOM "Murukku 200 g - standard batch": finished MURUKKU200, batchYieldQty 200, lines in
   BASE units: FLOUR 40000, OIL 10000, SPICE 1200, POUCH200 200, CARTON 10.
8. Opening stock as OPENING StockMovement rows (sourceType OPENING, sourceRef "OPENING",
   dated 1 April of the current financial year) - never by writing a balance:
   FLOUR 100000 g @ 4.2 paise/g | OIL 30000 ml @ 14 paise/ml | SPICE 5000 g @ 20 paise/g |
   POUCH200 500 @ 250 paise | CARTON 30 @ 1500 paise | MURUKKU200 50 @ 3000 paise
   (ASSUMPTION: opening finished goods valued at Rs 30/packet; log it in PROGRESS
   Assumptions). Insert an item's opening row only if it has none.
   (Rate x qty must produce valuePaise using lib/money.js mulRateQty.)

Create scripts/print-balances.js (npm script "balances") printing every item's balance
(SUM of qtyChange) in display units. Expected: flour 100 kg, oil 30 l, spice 5 kg, pouch 500,
carton 30, murukku 50.

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 06: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- npm run seed:reset && npm run balances
- run seed twice -> no duplicates, no errors
- npx prisma studio -> 6 users, 6 items, 1 BOM with 5 lines, 6 OPENING movements

### PROMPT 07 - Login, JWT and role middleware
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 07 - Authentication and role-based access.

Install jsonwebtoken (bcryptjs already present). Create a minimal src/lib/errors.js AppError
class now (step 08 extends it).

- src/config/permissions.js: export ROLES and a CAPABILITY MATRIX (commented) mapping capability
  -> allowed roles:
  orders:create [SALESMAN] | orders:read:own [SALESMAN] | orders:read:all [ADMIN, OWNER,
  ACCOUNTANT] | orders:approve [ADMIN] | invoices:write [ADMIN] | invoices:read [ADMIN,
  ACCOUNTANT, OWNER] | dispatch:write [ADMIN] | payments:write [ADMIN] | purchases:write
  [PRODUCTION, ADMIN] | production:write [PRODUCTION, ADMIN] | production:read [PRODUCTION,
  ADMIN, ACCOUNTANT, OWNER] | stock:read [ADMIN, PRODUCTION, ACCOUNTANT, OWNER] |
  masters:write [ADMIN] | reports:read [ADMIN, ACCOUNTANT, OWNER] | audit:read [ADMIN,
  ACCOUNTANT, OWNER] | dashboard:read [OWNER, ADMIN].
- src/services/authService.js: login(email, password) verifies bcrypt + isActive and returns
  { token, user:{id,name,email,role} }. JWT payload {sub:id, role}, expires 12h, signed with
  config.JWT_SECRET. Use the SAME error text "Invalid email or password" for unknown email and
  wrong password.
- src/middleware/auth.js: authenticate (Bearer token -> req.user, reload the user from the DB,
  reject if inactive), requireRole(...roles), requireCapability(name).
- src/routes/auth.js: POST /api/auth/login (zod validated), GET /api/auth/me.
- Mount in app.js. Add protected GET /api/_whoami (any authenticated user) for tests only.
- Tests (supertest): correct login 200 + token | wrong password 401 | no token 401 | SALESMAN
  token on an ADMIN-only route 403 | inactive user 401 | token for a deleted/unknown user 401.
- Add the demo-logins table to PROGRESS.md under "How to run".

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 07: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- npm run seed:reset
- curl -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@demo.com","password":"Demo@123"}'
- curl localhost:4000/api/auth/me -H 'Authorization: Bearer <token>'
- npm test

### PROMPT 08 - Validation, error handling and audit-log helper
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 08 - Validation, central error handling, audit-log helper.

1. src/lib/errors.js: class AppError(status, code, message, details?) plus helpers badRequest,
   unauthorized, forbidden, notFound, conflict, unprocessable. Codes are UPPER_SNAKE
   (VALIDATION_ERROR, INSUFFICIENT_STOCK, ...).
2. src/middleware/validate.js: validate({ body, query, params }) using zod; on failure throw
   AppError(400,'VALIDATION_ERROR','Invalid request', issues formatted as [{path,message}]);
   replace req.body/query with the parsed data.
3. src/middleware/errorHandler.js (mounted LAST) returns {error:{code,message,details?}};
   Prisma P2002 -> 409 DUPLICATE, P2025 -> 404 NOT_FOUND; unknown errors -> 500 INTERNAL (log the
   stack, never send it). src/lib/asyncHandler.js wraps async route handlers.
4. src/lib/audit.js: writeAudit(db, { userId, action, entity, entityId, before, after }).
   db is a Prisma client OR a transaction client, so the audit row commits in the SAME
   transaction as the change (put this in a comment). Serialize Decimal/Date safely.
5. Call writeAudit for LOGIN success and failure in authService.
6. GET /api/audit?entity=&entityId=&userId=&from=&to=&page=1&limit=50 (capability audit:read),
   newest first, include the user's name.
7. Refactor health and auth routes to use the new helpers. Behaviour stays identical.
8. Tests: validation error shape | unknown route 404 shape | unique violation -> 409 | audit
   row written on login | audit endpoint 403 for SALESMAN.

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 08: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- npm test
- curl localhost:4000/api/nothing  -> {error:{code:'NOT_FOUND'...}}
- login then GET /api/audit with the admin token shows the LOGIN row

### PROMPT 09 - Ledger service (addMovement, balances, running ledger) + tests
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 09 - Ledger service: the heart of the system.

Create backend/src/services/ledgerService.js. EVERY stock change in the whole project goes
through it. No other file may create, update or delete StockMovement rows. All functions take
a Prisma client OR transaction client "db" as first argument.

- addMovement(db, { itemId, qtyChange, movementType, sourceType, sourceId, sourceRef,
  ratePaisePerBase, batchNo, expiryDate, movementDate = new Date(), userId, note,
  allowNegative = false }):
  * qtyChange must be a non-zero integer; item must exist and be active;
  * for outflows (qtyChange < 0): first lock the item row with
    db.$queryRaw SELECT id FROM "Item" WHERE id = ${itemId} FOR UPDATE, then compute the
    balance; if balance + qtyChange < 0 and !allowNegative throw AppError(422,
    'INSUFFICIENT_STOCK', message, {itemId, itemName, available, requested, shortBy});
  * valuePaise = mulRateQty(rate, abs(qtyChange)) when a rate is given;
  * insert and return the movement.
- addMovements(db, array): sequential, stops on first error.
- getBalance(db, itemId, { asOf } = {}) -> integer (0 when no rows).
- getBalances(db, { type, itemIds } = {}) -> [{ itemId, code, name, type, baseUnit,
  displayUnit, balanceBase, balanceDisplay }].
- getLedger(db, { itemId, from, to }) -> { openingBalance (balance before 'from'), rows:[{id,
  date, movementType, sourceType, sourceId, sourceRef, qtyIn, qtyOut, balance, rate,
  valuePaise, batchNo, note, user}], closingBalance } ordered by movementDate, id, with a
  running balance.
- NO update or delete function exists. Corrections = a new ADJUSTMENT movement.

DB protection: run "npx prisma migrate dev --create-only --name ledger_append_only", add raw
SQL that creates a trigger on "StockMovement" raising an exception on UPDATE or DELETE, apply
it. Document in docs/DATA_MODEL.md.

Test setup: tests/helpers/db.js with resetDb() (TRUNCATE all, RESTART IDENTITY CASCADE) and
seedMinimal() (units, items, users). Use a SEPARATE database oda_test (DATABASE_URL_TEST in
.env and .env.example; give the exact createdb command in PROGRESS How-to-run); vitest setup
must REFUSE to run against the non-test database.
Tests: balance after OPENING + PURCHASE | outflow reduces | outflow beyond balance throws
INSUFFICIENT_STOCK with correct shortBy | allowNegative works | getLedger running balance with
from/to window | update/delete rejected by the trigger | concurrency: 5 parallel outflows of
30 against balance 100 (separate transactions) -> exactly 3 succeed, final balance 10.

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 09: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- createdb or psql command from PROGRESS, then npm test
- try in psql: UPDATE "StockMovement" SET "qtyChange" = 1;  -> must raise an error

### PROMPT 10 - Stock summary and ledger APIs + benchmark-check script
```
START OF SESSION (do this first, no exceptions):
1. Read AGENTS.md, docs/AI_CONTEXT.md and docs/PROGRESS.md completely.
2. If docs/PROGRESS.md already shows this step as done, STOP and tell me instead of redoing it.
3. If an earlier step this one depends on is not done, STOP and tell me which one.
4. Do ONLY this step. Small focused changes. Follow every rule in AI_CONTEXT.md.

STEP 10 - Stock APIs and the benchmark checker script.

1. src/routes/stock.js (capability stock:read):
   - GET /api/stock/summary?type=RAW|PACKAGING|FINISHED -> getBalances output with both the raw
     base number and a display string (example "100 kg").
   - GET /api/stock/ledger?itemId=&from=&to= -> getLedger output with display-unit strings.
   - GET /api/stock/items/:id/balance.
   - GET /api/stock/finished-availability (allowed for SALESMAN too and for stock:read roles):
     returns ONLY finished goods [{ itemId, name, availablePackets }] - salesmen must never see
     raw-material data.
2. Create backend/scripts/benchmark-check.js (npm script "bench:check"): connects to the DB,
   reads balances and key documents, prints a PASS/FAIL table, exit code 1 on any FAIL. Accept
   --stage=opening|after-purchase|after-run|after-dispatch|final. Keep the expected values in
   ONE table-driven object at the top, taken from docs/AI_CONTEXT.md section 8:
   opening: flour 100 kg, oil 30 l, spice 5 kg, pouch 500, carton 30, FG 50 |
   after-purchase: flour 160 kg | after-run: flour 120 kg, oil 19.5 l, spice 3.8 kg, pouch
   306, carton 21, FG 238 | after-dispatch: FG 88. Checks that cannot run yet print SKIPPED.
   Later steps extend this script, so keep it easy to extend (an array of {name, stage,
   expected, actualFn}).
3. Tests for the endpoints with role checks: SALESMAN may call finished-availability only;
   PRODUCTION may read summary; ACCOUNTANT may read ledger; no token -> 401.
4. In PROGRESS.md list the new endpoints and write "Benchmark status: opening PASS".

END OF STEP (do this last, no exceptions):
1. Run the verification commands for this step and fix failures. Never claim something works
   without running it.
2. Update docs/PROGRESS.md: tick this step, add a short Log entry (what you built, files
   changed, decisions/assumptions), refresh Next Step, How to run, File map, API endpoints
   and Known issues. Keep the file under 250 lines (condense old log entries).
3. git add -A && git commit -m "step 10: <short title>".
4. Reply with: summary, files changed, exact commands for me to verify, anything uncertain.
```

Verify:
- npm run seed:reset && npm run bench:check -- --stage=opening  (all PASS)
- login as salesman.a and GET /api/stock/summary -> 403; /finished-availability -> 200
- npm test
