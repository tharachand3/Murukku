import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { currentFinancialYear, financialYearRange } from '../src/lib/fy.js';
import { formatIstDate } from '../src/lib/reportKit.js';
import { prisma } from '../src/lib/prisma.js';
import { apiGet, apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

function getSection(response, key) {
  return response.body.sections.find((section) => section.key === key);
}

function rowForCode(rows, code) {
  return rows.find((row) => row.itemCode === code);
}

function shiftCalendarDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIstDate(date);
}

function wholeDaysSince(start, dateText) {
  return Math.floor(
    (Date.parse(`${dateText}T00:00:00+05:30`) - start.getTime()) / 86400000
  );
}

async function createZeroBalanceItem(context) {
  const [gram, kilogram] = await Promise.all([
    db.unit.findUnique({ where: { code: 'g' }, select: { id: true } }),
    db.unit.findUnique({ where: { code: 'kg' }, select: { id: true } })
  ]);
  const response = await apiPost(app, context.tokens.admin, '/api/items', {
    code: 'STEP40-ZERO',
    name: 'Step 40 zero-balance item',
    type: 'RAW',
    baseUnitId: gram.id,
    displayUnitId: kilogram.id,
    gstRateBp: 0
  });
  expect(response.status).toBe(201);
  return response.body.id;
}

let benchmark;
const fy = currentFinancialYear();
const fyRange = financialYearRange(fy);

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('stock summary and ledger reports', () => {
  it('reconciles all benchmark movements and values raw/packaging stock', async () => {
    const report = await apiGet(app, benchmark.tokens.accountant, '/api/reports/stock-summary');
    expect(report.status).toBe(200);
    const rows = getSection(report, 'items').rows;
    expect(rowForCode(rows, 'FLOUR')).toMatchObject({
      openingQty: '0',
      openingEntriesQty: '100',
      purchasesQty: '60',
      productionOutQty: '40',
      closingQty: '120',
      closingBaseQty: 120000,
      avgRatePerUnit: '43.125',
      closingValuePaise: 517500,
      reconciles: 'OK'
    });
    expect(rowForCode(rows, 'OIL')).toMatchObject({
      openingEntriesQty: '30',
      productionOutQty: '10.5',
      closingQty: '19.5',
      closingValuePaise: 273000,
      reconciles: 'OK'
    });
    expect(rowForCode(rows, 'SPICE')).toMatchObject({
      openingEntriesQty: '5',
      productionOutQty: '1.2',
      closingQty: '3.8',
      closingValuePaise: 76000,
      reconciles: 'OK'
    });
    expect(rowForCode(rows, 'POUCH200')).toMatchObject({
      openingEntriesQty: '500',
      productionOutQty: '188',
      scrapOutQty: '6',
      closingQty: '306',
      closingValuePaise: 76500,
      reconciles: 'OK'
    });
    expect(rowForCode(rows, 'CARTON')).toMatchObject({
      openingEntriesQty: '30',
      productionOutQty: '9',
      closingQty: '21',
      closingValuePaise: 31500,
      reconciles: 'OK'
    });
    expect(rowForCode(rows, 'MURUKKU200')).toMatchObject({
      openingEntriesQty: '50',
      productionInQty: '188',
      dispatchOutQty: '150',
      closingQty: '88',
      closingBaseQty: 88,
      avgRatePerUnit: null,
      closingValuePaise: null,
      reconciles: 'OK'
    });
    expect(getSection(report, 'items').totals).toEqual({
      closingValuePaise: 974_500
    });

    const stock = await apiGet(app, benchmark.tokens.accountant, '/api/stock/summary');
    const stockBalances = new Map(stock.body.map(({ code, balanceBase }) => [code, balanceBase]));
    for (const row of rows) {
      expect(row.closingBaseQty).toBe(stockBalances.get(row.itemCode));
    }
  });

  it('uses IST period openings, no-movement closing balances, and zero pre-opening stock', async () => {
    const today = formatIstDate(new Date());
    const yesterday = shiftCalendarDate(today, -1);
    const daysSinceFyStart = wholeDaysSince(fyRange.start, today);
    if (daysSinceFyStart > 2) {
      const todayReport = await apiGet(
        app,
        benchmark.tokens.accountant,
        `/api/reports/stock-summary?from=${today}&to=${today}&itemId=${benchmark.ids.flour}`
      );
      expect(getSection(todayReport, 'items').rows[0]).toMatchObject({
        openingQty: '100',
        openingEntriesQty: '0',
        purchasesQty: '60',
        closingQty: '120',
        reconciles: 'OK'
      });
      const yesterdayReport = await apiGet(
        app,
        benchmark.tokens.accountant,
        `/api/reports/stock-summary?from=${yesterday}&to=${yesterday}&itemId=${benchmark.ids.flour}`
      );
      expect(getSection(yesterdayReport, 'items').rows[0]).toMatchObject({
        openingQty: '100',
        openingEntriesQty: '0',
        purchasesQty: '0',
        closingQty: '100',
        reconciles: 'OK'
      });
    } // Opening rows are dated at FY start, so today/yesterday isolate period movements only beyond the first two days.

    const beforeOpening = formatIstDate(new Date(fyRange.start.getTime() - 1));
    const empty = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/stock-summary?from=${beforeOpening}&to=${beforeOpening}`
    );
    for (const row of getSection(empty, 'items').rows) {
      expect(row).toMatchObject({
        openingQty: '0',
        closingQty: '0',
        closingBaseQty: 0,
        reconciles: 'OK'
      });
    }
  });

  it('filters item types, hides empty items, validates queries, and checks stock roles', async () => {
    const raw = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/stock-summary?type=RAW'
    );
    expect(getSection(raw, 'items').rows).toHaveLength(3);

    await createZeroBalanceItem(benchmark);
    const allItems = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/stock-summary?type=RAW'
    );
    const hidden = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/stock-summary?type=RAW&hideEmpty=true'
    );
    expect(getSection(allItems, 'items').rows).toHaveLength(4);
    expect(rowForCode(getSection(allItems, 'items').rows, 'STEP40-ZERO'))
      .toMatchObject({ closingBaseQty: 0, reconciles: 'OK' });
    expect(getSection(hidden, 'items').rows).toHaveLength(3);

    expect((await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/stock-summary?unknown=true'
    )).status).toBe(400);

    for (const role of ['admin', 'accountant', 'production', 'owner']) {
      for (const key of ['stock-summary', 'stock-ledger']) {
        expect((await apiGet(
          app,
          benchmark.tokens[role],
          `/api/reports/${key}`
        )).status).toBe(200);
      }
    }
    for (const key of ['stock-summary', 'stock-ledger']) {
      expect((await apiGet(
        app,
        benchmark.tokens.salesmanA,
        `/api/reports/${key}`
      )).status).toBe(403);
      expect((await request(app).get(`/api/reports/${key}`)).status).toBe(401);
    }
    const catalog = await apiGet(app, benchmark.tokens.accountant, '/api/reports');
    expect(catalog.body.map(({ key }) => key)).toEqual(expect.arrayContaining([
      'stock-summary',
      'stock-ledger'
    ]));
  });

  it('shows item running balances, period openings, and pagination without resetting balances', async () => {
    const fyStart = formatIstDate(fyRange.start);
    const today = formatIstDate(new Date());
    const flour = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/stock-ledger?from=${fyStart}&to=${today}&itemId=${benchmark.ids.flour}`
    );
    expect(flour.status).toBe(200);
    const flourRows = getSection(flour, 'movements').rows;
    expect(flourRows).toHaveLength(3);
    expect(flourRows.map((row) => [
      row.movementType,
      row.qtyIn,
      row.qtyOut,
      row.balance
    ])).toEqual([
      ['OPENING', '100', '0', '100'],
      ['PURCHASE', '60', '0', '160'],
      ['PRODUCTION_ISSUE', '0', '40', '120']
    ]);
    expect(flourRows[1]).toMatchObject({
      sourceRef: `PUR/${fy}/0001`,
      ratePerUnit: '45'
    });
    expect(flourRows[2]).toMatchObject({
      sourceRef: `RUN/${fy}/0001`,
      ratePerUnit: '43.125',
      valuePaise: 172_500
    });
    expect(getSection(flour, 'balances').rows).toEqual([{
      itemCode: 'FLOUR',
      itemName: 'Flour',
      unit: 'kg',
      openingQty: '0',
      closingQty: '120'
    }]);

    const allItems = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/stock-ledger?from=${fyStart}&to=${today}`
    );
    const murukkuRows = getSection(allItems, 'movements').rows
      .filter((row) => row.itemCode === 'MURUKKU200');
    expect(murukkuRows.map((row) => [row.movementType, row.balance])).toEqual([
      ['OPENING', '50'],
      ['PRODUCTION_OUTPUT', '238'],
      ['DISPATCH', '88']
    ]);

    const todayOnly = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/stock-ledger?from=${today}&to=${today}&itemId=${benchmark.ids.flour}`
    );
    expect(getSection(todayOnly, 'balances').rows[0]).toMatchObject({
      openingQty: '100',
      closingQty: '120'
    });
    expect(getSection(todayOnly, 'movements').rows[0]).toMatchObject({
      movementType: 'PURCHASE',
      balance: '160'
    });

    const pageTwo = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/stock-ledger?from=${fyStart}&to=${today}&itemId=${benchmark.ids.flour}&limit=2&page=2`
    );
    expect(getSection(pageTwo, 'movements').rows).toMatchObject([
      { movementType: 'PRODUCTION_ISSUE', balance: '120' }
    ]);
    expect(getSection(pageTwo, 'movements').page).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
      pages: 2
    });
  });

  it('splits adjustment directions while preserving reconciliation', async () => {
    for (const [direction, suffix] of [['IN', 'in'], ['OUT', 'out']]) {
      const response = await apiPost(app, benchmark.tokens.admin, '/api/stock/adjustments', {
        itemId: benchmark.ids.flour,
        qty: '1',
        unit: 'kg',
        direction,
        reason: 'COUNT_CORRECTION',
        note: `Step 40 ${suffix} adjustment`
      });
      expect(response.status).toBe(201);
    }
    const report = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/stock-summary'
    );
    expect(rowForCode(getSection(report, 'items').rows, 'FLOUR')).toMatchObject({
      adjustmentsInQty: '1',
      adjustmentsOutQty: '1',
      closingQty: '120',
      reconciles: 'OK'
    });
  });
});
