# Browser benchmark checklist

Use the demo seed in a disposable development database, then start the backend and
frontend. Password for each seeded account is `Demo@123`. Use the role named at each
step; the app navigates to the registered screen paths below.

1. **Purchase (PRODUCTION):** Open `/purchases/new`. Select `Demo Flour Mills`, add
   FLOUR, enter quantity `60`, unit `kg`, rate `45`, then select **Save purchase**.
   The saved purchase is Rs 2,700.00; stock becomes 160 kg.
2. **Issue (PRODUCTION):** Open `/production/new`, choose Murukku 200 g, enter `1`
   batch, and click **Preview plan**. Keep flour 40 kg and spice 1.2 kg; change oil
   to 10.5 l. Click **Start run and issue materials**. Balances: flour 120 kg, oil
   19.5 l, spice 3.8 kg.
3. **Complete production (PRODUCTION):** Open the new run at
   `/production/runs/:id`. Under **Complete run**, enter good output `188`, pouch
   consumption `188`, pouch scrap `6`, and cartons `9`; click **Complete production
   run**. Expected stock: pouches 306, cartons 21, finished goods 238. Variances:
   yield -6.00%, oil +5.00%, cartons -10.00% flagged; pouches -3.00% not flagged.
4. **Retailer order (SALESMAN A):** Open `/new-order`, select Retailer A and Murukku
   200 g, quantity `150`, then **Submit order**. The order taxable amount is
   Rs 7,500.00.
5. **Invoice and dispatch (ADMIN):** Open `/orders`, open the submitted Retailer A
   order, click **Approve**, then **Confirm approval**. Click **Create GST invoice**
   and confirm **Create invoice**. The invoice is Rs 7,875.00: Rs 7,500.00 taxable,
   Rs 187.50 CGST, Rs 187.50 SGST. In invoice detail click **Dispatch**, then
   **Save dispatch**. Finished stock becomes 88 packets.
6. **Shortage (SALESMAN B, then ADMIN):** As salesman B, open `/new-order`, select
   Distributor B, add 120 Murukku 200 g packets, and **Submit order**. As admin,
   open `/shortages` (or the order detail) and confirm **Short by 32 packets**;
   the order remains submitted. There is no invoice-preview button in the current
   screen. The API integration test verifies the full-order preview of Rs 6,000.00
   + Rs 300.00 IGST = Rs 6,300.00.
7. **Payment (ADMIN):** Open the Retailer A invoice detail, click **Record payment**,
   enter amount `4000`, choose `UPI`, reference `UPI123456`, and click **Save
   payment**. On `/receivables`, Retailer A outstanding is Rs 3,875.00.
8. **Run overheads (PRODUCTION):** Open `/production`, open the completed run, add
   `LABOUR` Rs 1,200 with **Add overhead**, then `POWER_GAS` Rs 600. The run cost
   is Rs 5,855.00 total and Rs 31.14 per good packet.
9. **Reports (ACCOUNTANT):** Open `/reports`; open each report card and inspect its
   default period. Verify Sales Register (Rs 7,875.00), GST Summary (Rs 7,500.00
   taxable and Rs 187.50 each CGST/SGST), Receivables Ageing (Rs 3,875.00),
   Stock Summary (flour 120 kg; finished 88), Purchase Register (Rs 2,700.00),
   Production Report (yield -6.00%), Product Costing (Rs 31.14), and Sales by
   Customer (Retailer A, 150 packets, Rs 7,500.00 taxable). Also open Sales by
   Product and Stock Ledger. Download CSV, Excel, and PDF; for multi-section
   reports select each entry in **CSV section** before downloading CSV.
