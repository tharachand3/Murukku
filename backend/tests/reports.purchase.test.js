import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { currentFinancialYear, financialYearRange } from '../src/lib/fy.js';
import { formatIstDate } from '../src/lib/reportKit.js';
import { prisma } from '../src/lib/prisma.js';
import { apiGet, apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

const fy = currentFinancialYear();
const fyStart = formatIstDate(financialYearRange(fy).start);

let benchmark;

function section(response, key) {
  return response.body.sections.find((candidate) => candidate.key === key);
}

function shiftIstDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIstDate(date);
}

function atIstTime(dateText, time) {
  return new Date(`${dateText}T${time}+05:30`).toISOString();
}

async function createPurchase({ itemId, qty, unit, rate, purchaseDate }) {
  const response = await apiPost(app, benchmark.tokens.production, '/api/purchases', {
    supplierId: benchmark.ids.supplier,
    ...(purchaseDate ? { purchaseDate } : {}),
    lines: [{ itemId, qty, unit, ratePerUnitRupees: rate }]
  });
  expect(response.status).toBe(201);
  return response.body;
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('purchase register report', () => {
  it('reports the benchmark purchase and all-line supplier/item summaries', async () => {
    const report = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?from=${fyStart}&to=${formatIstDate(new Date())}`
    );
    expect(report.status).toBe(200);
    expect(section(report, 'lines').rows).toEqual([expect.objectContaining({
      purchaseNo: `PUR/${fy}/0001`,
      supplierName: 'Demo Flour Mills',
      supplierGstin: null,
      itemCode: 'FLOUR',
      itemName: 'Flour',
      type: 'RAW',
      qty: '60',
      unit: 'kg',
      ratePerUnit: '45',
      amountPaise: 270000
    })]);
    expect(section(report, 'lines').totals).toEqual({ amountPaise: 270000 });
    expect(section(report, 'by-supplier').rows).toEqual([{
      supplierName: 'Demo Flour Mills',
      supplierGstin: null,
      purchases: 1,
      lines: 1,
      amountPaise: 270000
    }]);
    expect(section(report, 'by-item').rows).toEqual([{
      itemCode: 'FLOUR',
      itemName: 'Flour',
      unit: 'kg',
      qty: '60',
      amountPaise: 270000,
      avgRatePerUnit: '45'
    }]);
  });

  it('aggregates filtered purchases independently of line pagination', async () => {
    await createPurchase({
      itemId: benchmark.ids.flour,
      qty: '10',
      unit: 'kg',
      rate: '46'
    });
    await createPurchase({
      itemId: benchmark.ids.pouch,
      qty: '100',
      unit: 'pcs',
      rate: '2.6'
    });

    const query = `from=${fyStart}&to=${formatIstDate(new Date())}`;
    const report = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?${query}`
    );
    expect(section(report, 'lines').totals).toEqual({ amountPaise: 342000 });
    expect(section(report, 'lines').rows).toHaveLength(3);
    expect(section(report, 'by-supplier').rows).toEqual([{
      supplierName: 'Demo Flour Mills',
      supplierGstin: null,
      purchases: 3,
      lines: 3,
      amountPaise: 342000
    }]);
    expect(section(report, 'by-item').rows).toEqual([
      {
        itemCode: 'FLOUR',
        itemName: 'Flour',
        unit: 'kg',
        qty: '70',
        amountPaise: 316000,
        avgRatePerUnit: '45.1429'
      },
      {
        itemCode: 'POUCH200',
        itemName: '200 g pouch',
        unit: 'pcs',
        qty: '100',
        amountPaise: 26000,
        avgRatePerUnit: '2.6'
      }
    ]);

    const packaging = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?${query}&type=PACKAGING`
    );
    expect(section(packaging, 'lines').rows).toHaveLength(1);
    expect(section(packaging, 'lines').rows[0]).toMatchObject({
      itemCode: 'POUCH200',
      qty: '100',
      ratePerUnit: '2.6',
      amountPaise: 26000
    });
    expect(section(packaging, 'lines').totals).toEqual({ amountPaise: 26000 });

    const flour = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?${query}&itemId=${benchmark.ids.flour}`
    );
    expect(section(flour, 'lines').rows).toHaveLength(2);
    expect(section(flour, 'lines').totals).toEqual({ amountPaise: 316000 });

    const supplier = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?${query}&supplierId=${benchmark.ids.supplier}`
    );
    expect(section(supplier, 'lines').totals).toEqual({ amountPaise: 342000 });

    const pageTwo = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?${query}&limit=1&page=2`
    );
    expect(section(pageTwo, 'lines').rows).toMatchObject([{
      purchaseNo: `PUR/${fy}/0002`,
      itemCode: 'FLOUR'
    }]);
    expect(section(pageTwo, 'lines').totals).toEqual({ amountPaise: 342000 });
  });

  it('uses inclusive IST purchase days and returns empty results with zero totals', async () => {
    const today = formatIstDate(new Date());
    const fortyDaysAgo = shiftIstDate(today, -40);
    const oldPurchase = await createPurchase({
      itemId: benchmark.ids.flour,
      qty: '1',
      unit: 'kg',
      rate: '45',
      purchaseDate: atIstTime(fortyDaysAgo, '12:00:00')
    });
    const priorMonth = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?from=${today.slice(0, 7)}-01&to=${today}`
    );
    expect(section(priorMonth, 'lines').rows.some(
      (row) => row.purchaseNo === oldPurchase.number
    )).toBe(false);
    const wider = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?from=${fyStart}&to=${today}`
    );
    expect(section(wider, 'lines').rows.some(
      (row) => row.purchaseNo === oldPurchase.number
    )).toBe(true);

    const boundaryDay = shiftIstDate(today, -1);
    const latePurchase = await createPurchase({
      itemId: benchmark.ids.flour,
      qty: '1',
      unit: 'kg',
      rate: '45',
      purchaseDate: atIstTime(boundaryDay, '23:30:00')
    });
    const earlyPurchase = await createPurchase({
      itemId: benchmark.ids.flour,
      qty: '1',
      unit: 'kg',
      rate: '45',
      purchaseDate: atIstTime(today, '00:30:00')
    });
    const boundary = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?from=${boundaryDay}&to=${boundaryDay}`
    );
    const boundaryRows = section(boundary, 'lines').rows;
    expect(boundaryRows.map((row) => row.purchaseNo)).toContain(latePurchase.number);
    expect(boundaryRows.map((row) => row.purchaseNo)).not.toContain(earlyPurchase.number);

    const emptyDate = shiftIstDate(fyStart, -1);
    const empty = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/purchase-register?from=${emptyDate}&to=${emptyDate}`
    );
    expect(section(empty, 'lines')).toMatchObject({
      rows: [],
      totals: { amountPaise: 0 }
    });
    expect(section(empty, 'by-supplier').rows).toEqual([]);
    expect(section(empty, 'by-item').rows).toEqual([]);
  });

  it('uses purchases:read roles and rejects unknown filters', async () => {
    for (const role of ['admin', 'accountant', 'production', 'owner']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/purchase-register'
      )).status).toBe(200);
    }
    expect((await apiGet(
      app,
      benchmark.tokens.salesmanA,
      '/api/reports/purchase-register'
    )).status).toBe(403);
    expect((await request(app).get('/api/reports/purchase-register')).status).toBe(401);
    expect((await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/purchase-register?unknown=true'
    )).status).toBe(400);
  });
});
