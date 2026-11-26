import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { apiGet, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

let benchmark;

async function report(key) {
  const response = await apiGet(
    app,
    benchmark.tokens.accountant,
    `/api/reports/${key}`
  );
  expect(response.status, `${key} report status`).toBe(200);
  return response.body;
}

function section(result, key) {
  const value = result.sections.find((entry) => entry.key === key);
  expect(value, `section ${key}`).toBeDefined();
  return value;
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('final benchmark report outputs and access', () => {
  it('sales register totals 787500 paise for invoice INV/<FY>/0001', async () => {
    const result = await report('sales-register');
    const invoices = section(result, 'invoices').rows;
    const netSales = section(result, 'summary').rows.find(
      ({ label }) => label === 'Net sales (posted invoices)'
    );

    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoiceNo).toMatch(/^INV\/\d{4}-\d{2}\/0001$/);
    expect(invoices[0].totalPaise).toBe(787500);
    expect(netSales.totalPaise).toBe(787500);
  });

  it('GST summary has 750000 taxable and 18750 each CGST and SGST', async () => {
    const totals = section(await report('gst-summary'), 'gstr3b-outward').totals;

    expect(totals).toMatchObject({
      taxableValuePaise: 750000,
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 0
    });
  });

  it('receivables ageing puts 387500 paise in the 0-30 bucket', async () => {
    const customers = section(await report('receivables-ageing'), 'customers').rows;
    const retailer = customers.find(({ customerName }) => customerName === 'Retailer A');

    expect(retailer).toMatchObject({
      outstandingPaise: 387500,
      bucket0To30Paise: 387500
    });
  });

  it('stock summary reports flour 120 kg and finished goods 88 packets', async () => {
    const rows = section(await report('stock-summary'), 'items').rows;

    expect(rows.find(({ itemCode }) => itemCode === 'FLOUR')).toMatchObject({
      closingQty: '120',
      unit: 'kg'
    });
    expect(rows.find(({ itemCode }) => itemCode === 'MURUKKU200')).toMatchObject({
      closingQty: '88',
      unit: 'packet'
    });
  });

  it('purchase register reports one flour purchase for 270000 paise', async () => {
    const lines = section(await report('purchase-register'), 'lines').rows;

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      itemCode: 'FLOUR',
      amountPaise: 270000
    });
  });

  it('production report shows one completed run with yield -600 bp flagged', async () => {
    const runs = section(await report('production-report'), 'runs').rows;

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'COMPLETED',
      yieldVarianceBp: -600,
      yieldFlagged: 'YES'
    });
  });

  it('customer-wise sales reports Retailer A at 150 packets and 750000 paise', async () => {
    const customers = section(await report('sales-by-customer'), 'customers').rows;
    const retailer = customers.find(({ customerName }) => customerName === 'Retailer A');

    expect(retailer).toMatchObject({
      qty: 150,
      taxableValuePaise: 750000
    });
  });

  it('product sales reports 150 Murukku packets and 787500 paise including tax', async () => {
    const products = section(await report('sales-by-product'), 'products').rows;
    const murukku = products.find(({ itemCode }) => itemCode === 'MURUKKU200');

    expect(murukku).toMatchObject({
      qty: 150,
      taxableValuePaise: 750000,
      totalPaise: 787500
    });
  });

  it('stock ledger reports 15 movements and 88 finished packets', async () => {
    const result = await report('stock-ledger');
    const movements = section(result, 'movements').rows;
    const balances = section(result, 'balances').rows;

    expect(movements).toHaveLength(15);
    expect(balances).toHaveLength(6);
    expect(balances.find(({ itemCode }) => itemCode === 'MURUKKU200')?.closingQty).toBe('88');
  });

  it('product costing reports 3114.3617 paise per packet and 3771 bp margin', async () => {
    const products = section(await report('product-costing'), 'products').rows;
    const murukku = products.find(({ productCode }) => productCode === 'MURUKKU200');

    expect(murukku).toMatchObject({
      runs: 1,
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      avgCostPerPacketPaise: '3114.3617',
      marginPctBp: 3771
    });
  });

  it('all report data and export endpoints require an authorized role', async () => {
    const catalog = await apiGet(app, benchmark.tokens.accountant, '/api/reports');
    expect(catalog.status).toBe(200);
    expect(catalog.body.length).toBeGreaterThan(0);

    for (const { key } of catalog.body) {
      for (const path of [
        `/api/reports/${key}`,
        `/api/reports/${key}/export?format=csv`
      ]) {
        const [anonymous, salesman] = await Promise.all([
          request(app).get(path),
          apiGet(app, benchmark.tokens.salesmanA, path)
        ]);
        expect(anonymous.status, `${path} anonymous status`).toBe(401);
        expect(salesman.status, `${path} SALESMAN status`).toBe(403);
      }
    }
  });

  it('final checker validates stock-movement sourceType without an invalid enum null filter', () => {
    const checkerPath = fileURLToPath(
      new URL('../scripts/benchmark-check.js', import.meta.url)
    );
    const backendDirectory = fileURLToPath(new URL('..', import.meta.url));
    const result = spawnSync(process.execPath, [checkerPath, '--stage=final'], {
      cwd: backendDirectory,
      encoding: 'utf8',
      env: process.env
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('every stock movement has a sourceType');
    expect(result.stdout).toMatch(/PASS: \d+ \| FAIL: 0 \| INFO:/);
  });
});
