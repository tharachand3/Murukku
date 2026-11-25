import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { addMovement } from '../src/services/ledgerService.js';
import {
  costValue,
  getAverageRate,
  getAverageRateAsOf,
  getAverageRates,
  getCostBreakdown
} from '../src/services/costingService.js';
import {
  apiGet,
  apiPost,
  loginAs,
  seedBenchmarkMasters
} from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

const PURCHASE_DATE = '2026-11-25T12:00:00.000Z';

let users;
let items;
let supplier;
let tokens;
let purchase;

async function setupBenchmarkCost() {
  await resetDb();
  await seedBenchmarkMasters();
  const [admin, accountant, owner, salesman, production, supplierRecord] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
    db.user.findUnique({ where: { email: 'owner@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
    db.user.findUnique({ where: { email: 'production@demo.com' } }),
    db.supplier.findFirst({ where: { name: 'Demo Flour Mills' } })
  ]);
  users = { admin, accountant, owner, salesman, production };
  supplier = supplierRecord;
  const itemRows = await db.item.findMany({
    where: { code: { in: ['FLOUR', 'OIL', 'SPICE', 'POUCH200', 'CARTON', 'MURUKKU200'] } }
  });
  items = Object.fromEntries(itemRows.map((item) => [item.code, item]));
  const [adminToken, accountantToken, ownerToken, salesmanToken, productionToken] =
    await Promise.all([
      loginAs(app, admin.email),
      loginAs(app, accountant.email),
      loginAs(app, owner.email),
      loginAs(app, salesman.email),
      loginAs(app, production.email)
    ]);
  tokens = {
    admin: adminToken,
    accountant: accountantToken,
    owner: ownerToken,
    salesman: salesmanToken,
    production: productionToken
  };
  const purchaseResponse = await apiPost(app, tokens.production, '/api/purchases', {
    supplierId: supplier.id,
    purchaseDate: PURCHASE_DATE,
    supplierInvoiceNo: 'COST-TEST-001',
    lines: [{
      itemId: items.FLOUR.id,
      qty: '60',
      unit: 'kg',
      ratePerUnitRupees: '45'
    }]
  });
  expect(purchaseResponse.status).toBe(201);
  purchase = purchaseResponse.body;
}

beforeEach(async () => {
  await setupBenchmarkCost();
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('weighted average costing', () => {
  it('returns the flour rate, receipt breakdown, and estimated issue value', async () => {
    const average = await getAverageRateAsOf(db, items.FLOUR.id, new Date(PURCHASE_DATE));
    expect(average).toMatchObject({
      itemId: items.FLOUR.id,
      receiptQty: 160000,
      receiptValuePaise: 690000,
      receiptCount: 2
    });
    expect(average.ratePaisePerBase.toString()).toBe('4.3125');
    expect((await costValue(db, items.FLOUR.id, 40000, new Date(PURCHASE_DATE))).valuePaise)
      .toBe(172500);

    const detail = await apiGet(
      app,
      tokens.accountant,
      `/api/costing/items/${items.FLOUR.id}`
    );
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      ratePaisePerBase: '4.3125',
      receiptQty: 160000,
      receiptValuePaise: 690000,
      receiptCount: 2,
      rateDisplay: 'Rs 43.125 per kg',
      receipts: [
        {
          movementType: 'OPENING',
          sourceRef: 'OPENING',
          qty: 100000,
          ratePaisePerBase: '4.2',
          valuePaise: 420000
        },
        {
          movementType: 'PURCHASE',
          sourceRef: purchase.number,
          qty: 60000,
          ratePaisePerBase: '4.5',
          valuePaise: 270000
        }
      ]
    });
  });

  it('honours the inclusive as-of timestamp boundary', async () => {
    const before = await getAverageRateAsOf(
      db,
      items.FLOUR.id,
      new Date('2026-11-25T11:59:59.999Z')
    );
    const atPurchase = await getAverageRateAsOf(
      db,
      items.FLOUR.id,
      new Date(PURCHASE_DATE)
    );
    expect(before.ratePaisePerBase.toString()).toBe('4.2');
    expect(before.receiptQty).toBe(100000);
    expect(atPurchase.ratePaisePerBase.toString()).toBe('4.3125');

    const beforeApi = await apiGet(
      app,
      tokens.accountant,
      `/api/costing/items/${items.FLOUR.id}?asOf=2026-11-25T11%3A59%3A59.999Z`
    );
    expect(beforeApi.status).toBe(200);
    expect(beforeApi.body.ratePaisePerBase).toBe('4.2');
  });

  it('reports the seeded opening rates for raw and packaging items', async () => {
    const response = await apiGet(app, tokens.admin, '/api/costing/average-rates');
    expect(response.status).toBe(200);
    const rates = Object.fromEntries(response.body.items.map(({ item, ...rate }) => [
      item.code,
      rate
    ]));
    for (const [code, rate] of [
      ['OIL', '14'],
      ['SPICE', '20'],
      ['POUCH200', '250'],
      ['CARTON', '1500']
    ]) {
      expect(rates[code].ratePaisePerBase).toBe(rate);
      expect(rates[code].receiptCount).toBe(1);
    }
    expect(rates.MURUKKU200).toMatchObject({
      ratePaisePerBase: '3000',
      rateBasis: 'OPENING_ONLY'
    });
  });

  it('matches the established average-rate helper for all raw and packaging items', async () => {
    const rates = await getAverageRates(db, {
      asOf: new Date(PURCHASE_DATE)
    });
    for (const { item, ratePaisePerBase } of rates.items) {
      if (item.type === 'FINISHED') {
        continue;
      }
      const existing = await getAverageRate(db, item.id, { asOf: new Date(PURCHASE_DATE) });
      expect(ratePaisePerBase?.toString(), item.code).toBe(existing.toString());
    }
  });

  it('does not change receipt averages for production issues, scrap, or adjustments', async () => {
    const before = await getAverageRateAsOf(db, items.FLOUR.id, new Date());
    const started = await apiPost(app, tokens.production, '/api/production/runs', {
      finishedItemId: items.MURUKKU200.id,
      batchCount: '1',
      issues: [
        { itemId: items.FLOUR.id, qty: '40', unit: 'kg' },
        { itemId: items.OIL.id, qty: '10.5', unit: 'l' },
        { itemId: items.SPICE.id, qty: '1.2', unit: 'kg' }
      ]
    });
    expect(started.status).toBe(201);
    const completed = await apiPost(
      app,
      tokens.production,
      `/api/production/runs/${started.body.id}/complete`,
      {
        actualGoodQty: 188,
        consumption: [
          { itemId: items.POUCH200.id, qty: '188', unit: 'pcs', scrapQty: '6' },
          { itemId: items.CARTON.id, qty: '9', unit: 'pcs' }
        ]
      }
    );
    expect(completed.status).toBe(200);
    expect(completed.body.materialCostPaise).toBe(405500);

    await addMovement(db, {
      itemId: items.FLOUR.id,
      qtyChange: 10,
      movementType: 'ADJUSTMENT',
      sourceType: 'ADJUSTMENT',
      sourceId: 1,
      sourceRef: 'COST-TEST-ADJUSTMENT',
      ratePaisePerBase: '99',
      movementDate: new Date(),
      userId: users.admin.id
    });
    const after = await getAverageRateAsOf(db, items.FLOUR.id, new Date());
    expect(before.ratePaisePerBase.toString()).toBe('4.3125');
    expect(after.ratePaisePerBase.toString()).toBe('4.3125');
    expect(after.receiptQty).toBe(before.receiptQty);
  });

  it('includes priced sales returns and ignores returns without a rate', async () => {
    await addMovement(db, {
      itemId: items.FLOUR.id,
      qtyChange: 1000,
      movementType: 'SALES_RETURN',
      sourceType: 'CREDIT_NOTE',
      sourceId: 1,
      sourceRef: 'CN-COST-TEST-001',
      ratePaisePerBase: '5',
      movementDate: new Date('2026-11-25T13:00:00.000Z'),
      userId: users.admin.id
    });
    await addMovement(db, {
      itemId: items.FLOUR.id,
      qtyChange: 1000,
      movementType: 'SALES_RETURN',
      sourceType: 'CREDIT_NOTE',
      sourceId: 2,
      sourceRef: 'CN-COST-TEST-002',
      movementDate: new Date('2026-11-25T13:01:00.000Z'),
      userId: users.admin.id
    });
    const result = await getAverageRateAsOf(
      db,
      items.FLOUR.id,
      new Date('2026-11-25T14:00:00.000Z')
    );
    expect(result.receiptQty).toBe(161000);
    expect(result.receiptValuePaise).toBe(695000);
    expect(result.ratePaisePerBase.toString()).toBe('4.31677');
  });

  it('returns a null rate and raises NO_COST_RATE when there are no priced receipts', async () => {
    const noCostItem = await db.item.create({
      data: {
        code: 'NO-COST-ITEM',
        name: 'No cost item',
        type: 'RAW',
        baseUnitId: items.FLOUR.baseUnitId,
        displayUnitId: items.FLOUR.displayUnitId
      }
    });
    const average = await getAverageRateAsOf(db, noCostItem.id, new Date());
    expect(average).toMatchObject({
      ratePaisePerBase: null,
      receiptQty: 0,
      receiptValuePaise: 0,
      receiptCount: 0
    });
    await expect(costValue(db, noCostItem.id, 100, new Date())).rejects.toMatchObject({
      status: 422,
      code: 'NO_COST_RATE',
      details: { itemId: noCostItem.id }
    });
  });

  it('uses at most three grouped database queries for the rate list', async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: items.FLOUR.id,
      code: 'FLOUR',
      name: 'Flour',
      type: 'RAW',
      displayUnit: { code: 'kg', baseFactor: 1000 }
    }]);
    const groupBy = vi.fn().mockResolvedValue([]);
    const mockDb = {
      item: { findMany },
      stockMovement: { groupBy }
    };
    const result = await getAverageRates(mockDb, { type: 'RAW', asOf: new Date() });
    expect(result.items).toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls.length + groupBy.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('protects cost endpoints by role and rejects invalid as-of values', async () => {
    for (const role of ['admin', 'accountant', 'owner']) {
      const response = await apiGet(
        app,
        tokens[role],
        `/api/costing/items/${items.FLOUR.id}`
      );
      expect(response.status).toBe(200);
    }
    for (const role of ['salesman', 'production']) {
      expect((await apiGet(
        app,
        tokens[role],
        '/api/costing/average-rates'
      )).status).toBe(403);
    }
    expect((await request(app).get('/api/costing/average-rates')).status).toBe(401);
    expect((await apiGet(
      app,
      tokens.accountant,
      `/api/costing/items/${items.FLOUR.id}?asOf=not-a-date`
    )).status).toBe(400);
    expect((await apiGet(
      app,
      tokens.accountant,
      '/api/costing/average-rates?asOf=2026-02-31'
    )).status).toBe(400);
  });
});
