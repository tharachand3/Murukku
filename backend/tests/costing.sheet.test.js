import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { currentFinancialYear } from '../src/lib/fy.js';
import { apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { runSecondProductionRun } from './helpers/benchmarkExtras.js';
import { db, resetDb } from './helpers/db.js';

let ctx;

function auth(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function istDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  ctx = await runBenchmarkFull(app);
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('cost sheet and product costing APIs', () => {
  it('returns benchmark material, overhead, per-packet and margin details', async () => {
    const movementCount = await db.stockMovement.count();
    const response = await request(app)
      .get(`/api/costing/runs/${ctx.ids.runId}/sheet`)
      .set(auth(ctx.tokens.accountant));

    expect(response.status).toBe(200);
    expect(response.body.run).toMatchObject({
      id: ctx.ids.runId,
      runNo: `RUN/${ctx.FY}/0001`,
      status: 'COMPLETED',
      product: { id: ctx.ids.murukku, code: 'MURUKKU200' },
      plannedOutputQty: 200,
      goodQty: 188
    });
    const materials = Object.fromEntries(response.body.materials.map((line) => [line.code, line]));
    expect(materials.FLOUR).toMatchObject({
      plannedQty: '40',
      issuedQty: '40',
      scrapQty: '0',
      plannedCostPaise: 172500,
      actualCostPaise: 172500,
      costVariancePaise: 0
    });
    expect(materials.OIL).toMatchObject({
      plannedCostPaise: 140000,
      actualCostPaise: 147000,
      costVariancePaise: 7000
    });
    expect(materials.SPICE).toMatchObject({
      plannedCostPaise: 24000,
      actualCostPaise: 24000,
      costVariancePaise: 0
    });
    expect(materials.POUCH200).toMatchObject({
      plannedQty: '200',
      issuedQty: '194',
      scrapQty: '6',
      plannedCostPaise: 50000,
      actualCostPaise: 48500,
      costVariancePaise: -1500
    });
    expect(materials.CARTON).toMatchObject({
      plannedCostPaise: 15000,
      actualCostPaise: 13500,
      costVariancePaise: -1500
    });
    expect(response.body.materialTotals).toEqual({
      plannedCostPaise: 401500,
      actualCostPaise: 405500,
      costVariancePaise: 4000
    });
    expect(response.body.overheads).toMatchObject({
      totalPaise: 180000,
      rows: [
        { kind: 'LABOUR', amountPaise: 120000 },
        { kind: 'POWER_GAS', amountPaise: 60000 }
      ]
    });
    expect(response.body).toMatchObject({
      totalCostPaise: 585500,
      perPacket: {
        materialPaise: '2156.9149',
        overheadPaise: '957.4468',
        totalPaise: '3114.3617',
        display: 'Rs 31.14'
      },
      price: { sellingPricePaise: 5000, display: 'Rs 50.00' },
      margin: {
        perPacketPaise: '1885.6383',
        perPacketDisplay: 'Rs 18.86',
        bp: 3771,
        pctDisplay: '37.71%'
      }
    });
    expect(await db.stockMovement.count()).toBe(movementCount);
    expect((await db.productionRun.findUnique({
      where: { id: ctx.ids.runId },
      select: { materialCostPaise: true }
    })).materialCostPaise).toBe(405500);
  });

  it('returns ISSUED runs without per-packet cost or margin', async () => {
    const started = await apiPost(app, ctx.tokens.production, '/api/production/runs', {
      finishedItemId: ctx.ids.murukku,
      batchCount: '0.5'
    });
    expect(started.status).toBe(201);
    const issued = await request(app)
      .get(`/api/costing/runs/${started.body.id}/sheet`)
      .set(auth(ctx.tokens.owner));
    expect(issued.status).toBe(200);
    expect(issued.body.run.status).toBe('ISSUED');
    expect(issued.body.materials.length).toBeGreaterThan(0);
    expect(issued.body.perPacket).toBeNull();
    expect(issued.body.margin).toBeNull();
  });

  it('aggregates products by total cost over total good packets for the current FY', async () => {
    const first = await request(app)
      .get('/api/costing/products')
      .set(auth(ctx.tokens.accountant));
    expect(first.status).toBe(200);
    expect(first.body.period.from).toBe(istDate(new Date(`${currentFinancialYear().slice(0, 4)}-04-01T00:00:00.000Z`)));
    expect(first.body.products).toHaveLength(1);
    expect(first.body.products[0]).toMatchObject({
      itemId: ctx.ids.murukku,
      code: 'MURUKKU200',
      runCount: 1,
      goodQty: 188,
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      totalCostPaise: 585500,
      avgCostPerPacketPaise: '3114.3617',
      latestRun: {
        runNo: `RUN/${ctx.FY}/0001`,
        costPerPacketPaise: '3114.3617'
      },
      sellingPricePaise: 5000,
      margin: { bp: 3771, pctDisplay: '37.71%' }
    });

    const second = await runSecondProductionRun(app, ctx);
    const afterSecond = await request(app)
      .get('/api/costing/products')
      .set(auth(ctx.tokens.accountant));
    expect(afterSecond.status).toBe(200);
    expect(afterSecond.body.products).toHaveLength(1);
    expect(afterSecond.body.products[0]).toMatchObject({
      runCount: 2,
      goodQty: 288,
      materialCostPaise: 606250,
      overheadCostPaise: 180000,
      totalCostPaise: 786250,
      avgCostPerPacketPaise: '2730.0347'
    });
    const secondRun = await db.productionRun.findUnique({
      where: { id: second.runId },
      select: { runNo: true }
    });
    expect(afterSecond.body.products[0].latestRun.runNo).toBe(secondRun.runNo);
    expect(second.runId).toBeGreaterThan(ctx.ids.runId);
  });

  it('supports date, product, validation, not-found, and role filters', async () => {
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const outside = await request(app)
      .get(`/api/costing/products?from=${istDate(tomorrow)}&to=${istDate(tomorrow)}`)
      .set(auth(ctx.tokens.admin));
    expect(outside.status).toBe(200);
    expect(outside.body.products).toEqual([]);

    const filtered = await request(app)
      .get(`/api/costing/products?finishedItemId=${ctx.ids.murukku}`)
      .set(auth(ctx.tokens.owner));
    expect(filtered.status).toBe(200);
    expect(filtered.body.products).toHaveLength(1);

    const invalidQuery = await request(app)
      .get('/api/costing/products?unknown=true')
      .set(auth(ctx.tokens.admin));
    const productionDenied = await request(app)
      .get('/api/costing/products')
      .set(auth(ctx.tokens.production));
    const salesmanDenied = await request(app)
      .get('/api/costing/products')
      .set(auth(ctx.tokens.salesmanA));
    const anonymousDenied = await request(app).get('/api/costing/products');
    const badId = await request(app)
      .get('/api/costing/runs/abc/sheet')
      .set(auth(ctx.tokens.accountant));
    const missing = await request(app)
      .get('/api/costing/runs/2147483647/sheet')
      .set(auth(ctx.tokens.accountant));
    expect(invalidQuery.status).toBe(400);
    expect(productionDenied.status).toBe(403);
    expect(salesmanDenied.status).toBe(403);
    expect(anonymousDenied.status).toBe(401);
    expect(badId.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it('returns null margin when the finished item has no selling price', async () => {
    const previous = await db.item.findUnique({
      where: { id: ctx.ids.murukku },
      select: { sellingPricePaise: true }
    });
    await db.item.update({
      where: { id: ctx.ids.murukku },
      data: { sellingPricePaise: null }
    });
    try {
      const sheet = await request(app)
        .get(`/api/costing/runs/${ctx.ids.runId}/sheet`)
        .set(auth(ctx.tokens.accountant));
      const products = await request(app)
        .get('/api/costing/products')
        .set(auth(ctx.tokens.accountant));
      expect(sheet.status).toBe(200);
      expect(sheet.body.price).toBeNull();
      expect(sheet.body.margin).toBeNull();
      expect(products.status).toBe(200);
      expect(products.body.products[0].margin).toBeNull();
    } finally {
      await db.item.update({
        where: { id: ctx.ids.murukku },
        data: { sellingPricePaise: previous.sellingPricePaise }
      });
    }
  });

  it('returns completed zero-good runs without per-packet cost or margin', async () => {
    const started = await apiPost(app, ctx.tokens.production, '/api/production/runs', {
      finishedItemId: ctx.ids.murukku,
      batchCount: '0.5'
    });
    expect(started.status).toBe(201);
    const completed = await apiPost(
      app,
      ctx.tokens.production,
      `/api/production/runs/${started.body.id}/complete`,
      { actualGoodQty: 0, consumption: [] }
    );
    expect(completed.status).toBe(200);
    const zeroGood = await request(app)
      .get(`/api/costing/runs/${started.body.id}/sheet`)
      .set(auth(ctx.tokens.accountant));
    expect(zeroGood.status).toBe(200);
    expect(zeroGood.body.run).toMatchObject({ status: 'COMPLETED', goodQty: 0 });
    expect(zeroGood.body.perPacket).toBeNull();
    expect(zeroGood.body.margin).toBeNull();
  });
});
