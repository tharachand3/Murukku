# Benchmark proof

`actual` values are populated only by an executed `npm run bench:full -- --reset`.
The runner validates the public APIs, every catalog export format, the invoice PDF,
cost sheet, final stock ledger and final-state checks.

| Spec line | Expected | Proven by (test, script check, screen path) | Actual |
|---|---|---|---|
| Raw stock after issue | Flour 120 kg; oil 19.5 l; spice 3.8 kg | `benchmark.part1.test.js` step 2; `final FLOUR/OIL/SPICE balance`; `/stock` | Flour 120 kg; oil 19.5 l; spice 3.8 kg |
| Packaging and finished stock | Pouches 306; cartons 21; FG 238 after run, 88 after dispatch | `benchmark.part1.test.js` steps 2-3; final balance checks; `/stock` | Pouches 306; cartons 21; FG 238 after run, 88 after dispatch |
| Variance boundary and flags | Yield -6.00% and oil +5.00% flagged; cartons -10.00% flagged; pouches -3.00% not flagged | `benchmark.part1.test.js` step 3; final checker variance checks; `/production/runs/:id` | Yield -6.00%, oil +5.00%, cartons -10.00% flagged; pouches -3.00% not flagged |
| Retailer A GST invoice | INV/<FY>/0001; taxable 750000 paise; CGST/SGST 18750 each; total 787500 | `benchmark.part2.test.js` steps 5-6; invoice checker; `/invoices/:id` | INV/2026-27/0001; taxable 750000; CGST/SGST 18750 each; total 787500 paise |
| Distributor B shortage | 120 requested, 88 free, short by 32; order remains SUBMITTED | `benchmark.part2.test.js` step 6; shortage checker; `/shortages` | SUBMITTED; 120 requested, 88 free, short by 32 packets |
| Interstate tax proof | 600000 taxable + 30000 IGST = 630000 paise | `benchmark.part2.test.js` step 6 (`invoice-preview` API); `/orders/:id` shows availability, not an invoice-preview control | 600000 taxable + 30000 IGST = 630000 paise |
| Retailer A receivable | 400000 paid; 387500 paise outstanding in 0-30 days | `benchmark.part2.test.js` step 7; ageing report test; `/receivables` | 400000 paid; 387500 paise outstanding in 0-30 days |
| Flour weighted-average rate | Rs 6,900 / 160 kg = Rs 43.125/kg = 4.3125 paise/g | `benchmark.part1.test.js` step 1; `FLOUR weighted average rate`; `/purchases` and `/reports/purchase-register` | Rs 6,900 / 160 kg = Rs 43.125/kg = 4.3125 paise/g |
| Run cost and margin | Materials 405500 + overhead 180000 = 585500 paise; 3114.3617 paise/packet (Rs 31.14); margin 3771 bp | `costing.sheet.test.js` benchmark sheet test; cost-sheet checker; `/production/runs/:id` and `/reports/product-costing` | Materials 405500 + overhead 180000 = 585500; 3114.3617 paise/packet (Rs 31.14); margin 3771 bp |
| Sales register | One invoice; total 787500 paise | `benchmark.final.test.js` sales-register test; `sales-register` report check; `/reports/sales-register` | INV/2026-27/0001; one invoice; total 787500 paise |
| GST summary | Net taxable 750000; CGST 18750; SGST 18750; IGST 0 paise | `benchmark.final.test.js` GST-summary test; `gst-summary` report check; `/reports/gst-summary` | Net taxable 750000; CGST 18750; SGST 18750; IGST 0 paise |
| Receivables ageing | Retailer A outstanding 387500 paise in 0-30 days | `benchmark.final.test.js` receivables-ageing test; `receivables-ageing` report check; `/reports/receivables-ageing` | Retailer A outstanding 387500 paise in 0-30 days |
| Stock summary | Flour 120 kg; finished goods 88 packets | `benchmark.final.test.js` stock-summary test; `stock-summary` report check; `/reports/stock-summary` | Flour 120 kg; finished goods 88 packets |
| Purchase register | One purchase line for 270000 paise | `benchmark.final.test.js` purchase-register test; `purchase-register` report check; `/reports/purchase-register` | One purchase line for 270000 paise |
| Production report | One completed run; yield -600 bp flagged | `benchmark.final.test.js` production-report test; `production-report` report check; `/reports/production-report` | One completed run; yield -600 bp flagged |
| Customer-wise sales | Retailer A: 150 packets, 750000 paise taxable | `benchmark.final.test.js` customer-sales test; `sales-by-customer` report check; `/reports/sales-by-customer` | Retailer A: 150 packets; 750000 paise taxable |
| Catalog reports and exports | Every report and listed format passes; CSV exports cover returned sections | Step 9 accountant catalog/export checks; `/reports` | 10 reports PASS; sales-by-product 150 packets/787500 paise; stock ledger 15 movements/6 balances; product costing 3114.3617 paise/packet, margin 3771 bp; CSV/XLSX/PDF all PASS |

Cartons use 9 versus 10 planned, so -10.00% is strictly beyond the 3% tolerance and
is flagged. Pouches use 194 versus 200 planned, exactly -3.00%; flags require a
variance strictly greater than 3%, so pouches are not flagged.

The existing benchmark suites already cover raw/packaging balances and production
variances (`benchmark.part1.test.js`), invoice, shortage, IGST preview and payment
(`benchmark.part2.test.js`), and per-packet cost/margin (`costing.sheet.test.js`).
`benchmark.final.test.js` adds report-output and report-role proofs rather than
duplicating those assertions.
