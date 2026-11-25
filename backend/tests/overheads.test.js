import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { db, resetDb } from './helpers/db.js';
import {
  apiGet,
  apiPost,
  loginAs,
  seedBenchmarkMasters
} from './helpers/benchmark.js';

let tokens;
let items;
let supplier;
let run;

async function postRun(issues) {
  return apiPost(app, tokens.production, '/api/production/runs', {
    finishedItemId: items.MURUKKU200.id,
    batchCount: '1',
    ...(issues ? { issues } : {
      issues: [
        { itemId: items.FLOUR.id, qty: '40', unit: 'kg' },
        { itemId: items.OIL.id, qty: '10.5', unit: 'l' },
        { itemId: items.SPICE.id, qty: '1.2', unit: 'kg' }
      ]
    })
  });
}

async function completeRun(runId, actualGoodQty = 188) {
  return apiPost(app, tokens.production, `/api/production/runs/${runId}/complete`, {
    actualGoodQty,
    consumption: actualGoodQty === 0
      ? []
      : [
          { itemId: items.POUCH200.id, qty: '188', unit: 'pcs', scrapQty: '6' },
          { itemId: items.CARTON.id, qty: '9', unit: 'pcs' }
        ]
  });
}

async function addOverhead(runId, body, token = tokens.production) {
  return apiPost(app, token, `/api/production/runs/${runId}/overheads`, body);
}

beforeEach(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  const [admin, production, accountant, owner, salesman] = await Promise.all([
    loginAs(app, 'admin@demo.com'),
    loginAs(app, 'production@demo.com'),
    loginAs(app, 'accountant@demo.com'),
    loginAs(app, 'owner@demo.com'),
    loginAs(app, 'salesman.a@demo.com')
  ]);
  tokens = { admin, production, accountant, owner, salesman };
  const [itemsResponse, suppliersResponse] = await Promise.all([
    apiGet(app, tokens.production, '/api/items'),
    apiGet(app, tokens.production, '/api/suppliers')
  ]);
  items = Object.fromEntries(itemsResponse.body.map((item) => [item.code, item]));
  supplier = suppliersResponse.body.find(({ name }) => name === 'Demo Flour Mills');

  const purchase = await apiPost(app, tokens.production, '/api/purchases', {
    supplierId: supplier.id,
    lines: [{
      itemId: items.FLOUR.id,
      qty: '60',
      unit: 'kg',
      ratePerUnitRupees: '45'
    }]
  });
  expect(purchase.status).toBe(201);
  const started = await postRun();
  expect(started.status).toBe(201);
  run = started.body;
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('production run overheads', () => {
  it('adds labour and power to the benchmark cost and exposes rows in both read APIs', async () => {
    const completed = await completeRun(run.id);
    expect(completed.status).toBe(200);
    const movementsBefore = await db.stockMovement.count();
    const flourBalanceBefore = await db.stockMovement.aggregate({
      where: { itemId: items.FLOUR.id },
      _sum: { qtyChange: true }
    });

    const labour = await addOverhead(run.id, {
      kind: 'LABOUR',
      amountPaise: 120000,
      note: 'Production labour'
    });
    const power = await addOverhead(run.id, {
      kind: 'POWER_GAS',
      amountPaise: 60000
    }, tokens.admin);

    expect(labour.status).toBe(201);
    expect(power.status).toBe(201);
    expect(power.body.cost).toMatchObject({
      runNo: run.runNo,
      status: 'COMPLETED',
      goodQty: 188,
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      totalCostPaise: 585500,
      costPerPacketPaise: '3114.3617',
      costPerPacketDisplay: 'Rs 31.14'
    });
    expect(power.body.overhead).toMatchObject({
      kind: 'POWER_GAS',
      kindLabel: 'Power / gas',
      amountPaise: 60000,
      amountDisplay: 'Rs 600.00'
    });

    const [listed, detail] = await Promise.all([
      request(app).get(`/api/production/runs/${run.id}/overheads`).set({
        Authorization: `Bearer ${tokens.accountant}`
      }),
      request(app).get(`/api/production/runs/${run.id}`).set({
        Authorization: `Bearer ${tokens.production}`
      })
    ]);
    expect(listed.status).toBe(200);
    expect(listed.body.overheads).toMatchObject({
      totalPaise: 180000,
      totalDisplay: 'Rs 1,800.00',
      rows: [
        { kind: 'LABOUR', kindLabel: 'Labour', amountDisplay: 'Rs 1,200.00' },
        { kind: 'POWER_GAS', kindLabel: 'Power / gas', amountDisplay: 'Rs 600.00' }
      ]
    });
    expect(listed.body.cost.costPerPacketPaise).toBe('3114.3617');
    expect(detail.status).toBe(200);
    expect(detail.body.overheads).toHaveLength(2);
    expect(detail.body.materialCostPaise).toBe(405500);
    expect(await db.stockMovement.count()).toBe(movementsBefore);
    expect((await db.stockMovement.aggregate({
      where: { itemId: items.FLOUR.id },
      _sum: { qtyChange: true }
    }))._sum.qtyChange).toBe(flourBalanceBefore._sum.qtyChange);

    const auditRows = await db.auditLog.findMany({
      where: { entityId: run.id, entity: 'ProductionRun', action: 'UPDATE' },
      orderBy: { id: 'asc' }
    });
    expect(auditRows).toHaveLength(3);
    expect(auditRows[1].before).toMatchObject({ overheadCostPaise: 0 });
    expect(auditRows[1].after).toMatchObject({ overheadCostPaise: 120000 });
    expect(await db.auditLog.count({
      where: { entity: 'ProductionOverhead', action: 'CREATE' }
    })).toBe(2);
  });

  it('keeps issued-run unit cost null until completion, then recalculates it', async () => {
    const added = await addOverhead(run.id, {
      kind: 'LABOUR',
      amountPaise: 120000
    });
    expect(added.status).toBe(201);
    expect(added.body.cost.costPerPacketPaise).toBeNull();
    expect(added.body.cost.overheadCostPaise).toBe(120000);

    const completed = await completeRun(run.id);
    expect(completed.status).toBe(200);
    const details = await apiGet(app, tokens.production, `/api/production/runs/${run.id}/overheads`);
    expect(details.body.cost).toMatchObject({
      materialCostPaise: 405500,
      overheadCostPaise: 120000,
      totalCostPaise: 525500,
      costPerPacketPaise: '2795.2128',
      costPerPacketDisplay: 'Rs 27.95'
    });
  });

  it('snapshots material-only packet cost at completion when no overhead was entered', async () => {
    const completed = await completeRun(run.id);
    expect(completed.status).toBe(200);
    const snapshot = await apiGet(app, tokens.production, `/api/production/runs/${run.id}/overheads`);

    expect(snapshot.body.cost).toMatchObject({
      materialCostPaise: 405500,
      overheadCostPaise: 0,
      totalCostPaise: 405500,
      costPerPacketPaise: '2156.9149',
      costPerPacketDisplay: 'Rs 21.57'
    });
  });

  it('recomputes cost after deleting an overhead without changing materials or stock', async () => {
    await completeRun(run.id);
    await addOverhead(run.id, { kind: 'LABOUR', amountPaise: 120000 });
    const power = await addOverhead(run.id, { kind: 'POWER_GAS', amountPaise: 60000 });
    const movementsBefore = await db.stockMovement.count();
    const response = await request(app)
      .delete(`/api/production/runs/${run.id}/overheads/${power.body.overhead.id}`)
      .set({ Authorization: `Bearer ${tokens.admin}` });

    expect(response.status).toBe(200);
    expect(response.body.cost).toMatchObject({
      materialCostPaise: 405500,
      overheadCostPaise: 120000,
      totalCostPaise: 525500,
      costPerPacketPaise: '2795.2128'
    });
    expect((await db.productionRun.findUnique({
      where: { id: run.id },
      select: { materialCostPaise: true }
    })).materialCostPaise).toBe(405500);
    expect(await db.stockMovement.count()).toBe(movementsBefore);
    expect(await db.auditLog.count({
      where: { entity: 'ProductionOverhead', action: 'DELETE' }
    })).toBe(1);
  });

  it('rejects cancelled runs and overhead ids that are missing or belong to another run', async () => {
    const first = await addOverhead(run.id, { kind: 'LABOUR', amountPaise: 120000 });
    const otherStarted = await postRun([]);
    expect(otherStarted.status).toBe(201);
    const other = await addOverhead(otherStarted.body.id, {
      kind: 'OTHER',
      amountPaise: 500
    });

    const foreign = await request(app)
      .delete(`/api/production/runs/${otherStarted.body.id}/overheads/${first.body.overhead.id}`)
      .set({ Authorization: `Bearer ${tokens.production}` });
    const missing = await request(app)
      .delete(`/api/production/runs/${run.id}/overheads/2147483647`)
      .set({ Authorization: `Bearer ${tokens.production}` });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);

    const cancelled = await apiPost(app, tokens.production, `/api/production/runs/${run.id}/cancel`, {
      reason: 'Test cancellation'
    });
    expect(cancelled.status).toBe(200);
    const denied = await addOverhead(run.id, { kind: 'LABOUR', amountPaise: 100 });
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('RUN_CANCELLED');
    expect(other.status).toBe(201);
  });

  it('leaves cost per packet null for a completed run with no good output', async () => {
    const completed = await completeRun(run.id, 0);
    expect(completed.status).toBe(200);
    const added = await addOverhead(run.id, { kind: 'OTHER', amountPaise: 1000 });
    expect(added.status).toBe(201);
    expect(added.body.cost.costPerPacketPaise).toBeNull();
    expect(added.body.cost.costPerPacketDisplay).toBeNull();
  });

  it('validates overhead fields and enforces the production read/write roles', async () => {
    const invalidBodies = [
      { kind: 'RENT', amountPaise: 10 },
      { kind: 'LABOUR', amountPaise: 0 },
      { kind: 'LABOUR', amountPaise: -5 },
      { kind: 'LABOUR', amountPaise: 1.5 },
      { kind: 'LABOUR', amountPaise: 1000000001 },
      { kind: 'LABOUR', amountPaise: 10, extra: true },
      { kind: 'LABOUR', amountPaise: 10, note: 'x'.repeat(201) }
    ];
    for (const body of invalidBodies) {
      const invalid = await addOverhead(run.id, body);
      expect(invalid.status, JSON.stringify(body)).toBe(400);
    }

    const productionCreate = await addOverhead(run.id, {
      kind: 'LABOUR',
      amountPaise: 100
    });
    const adminCreate = await addOverhead(run.id, {
      kind: 'OTHER',
      amountPaise: 100
    }, tokens.admin);
    expect(productionCreate.status).toBe(201);
    expect(adminCreate.status).toBe(201);

    const route = `/api/production/runs/${run.id}/overheads`;
    for (const role of ['accountant', 'owner', 'production', 'admin']) {
      const response = await request(app).get(route).set({
        Authorization: `Bearer ${tokens[role]}`
      });
      expect(response.status).toBe(200);
    }
    const salesmanRead = await request(app).get(route).set({
      Authorization: `Bearer ${tokens.salesman}`
    });
    const anonymousRead = await request(app).get(route);
    const accountantWrite = await addOverhead(run.id, {
      kind: 'OTHER',
      amountPaise: 100
    }, tokens.accountant);
    const ownerWrite = await addOverhead(run.id, {
      kind: 'OTHER',
      amountPaise: 100
    }, tokens.owner);
    const accountantDelete = await request(app)
      .delete(`/api/production/runs/${run.id}/overheads/${productionCreate.body.overhead.id}`)
      .set({ Authorization: `Bearer ${tokens.accountant}` });
    const ownerDelete = await request(app)
      .delete(`/api/production/runs/${run.id}/overheads/${productionCreate.body.overhead.id}`)
      .set({ Authorization: `Bearer ${tokens.owner}` });
    const productionDelete = await request(app)
      .delete(`/api/production/runs/${run.id}/overheads/${productionCreate.body.overhead.id}`)
      .set({ Authorization: `Bearer ${tokens.production}` });
    const adminDelete = await request(app)
      .delete(`/api/production/runs/${run.id}/overheads/${adminCreate.body.overhead.id}`)
      .set({ Authorization: `Bearer ${tokens.admin}` });
    const anonymousWrite = await request(app)
      .post(`/api/production/runs/${run.id}/overheads`)
      .send({ kind: 'LABOUR', amountPaise: 100 });
    expect(salesmanRead.status).toBe(403);
    expect(anonymousRead.status).toBe(401);
    expect(accountantWrite.status).toBe(403);
    expect(ownerWrite.status).toBe(403);
    expect(accountantDelete.status).toBe(403);
    expect(ownerDelete.status).toBe(403);
    expect(productionDelete.status).toBe(200);
    expect(adminDelete.status).toBe(200);
    expect(anonymousWrite.status).toBe(401);
  });
});
