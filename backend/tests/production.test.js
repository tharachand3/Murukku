import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { financialYearOf } from '../src/lib/fy.js';
import { prisma } from '../src/lib/prisma.js';
import { getBalance } from '../src/services/ledgerService.js';
import { db, resetDb, seedMinimal } from './helpers/db.js';

let fixture;
let items;
let bom;
let production;
let salesman;

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function as(user) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

function benchmarkIssues() {
  return [
    { itemId: items.flour.id, qty: '40', unit: 'kg' },
    { itemId: items.oil.id, qty: '10.5', unit: 'l' },
    { itemId: items.spice.id, qty: '1.2', unit: 'kg' }
  ];
}

function runCounterKey() {
  return `RUN:${financialYearOf(new Date())}`;
}

async function postRun(user, body = {}) {
  return request(app)
    .post('/api/production/runs')
    .set(as(user))
    .send({ finishedItemId: items.finished.id, ...body });
}

beforeEach(async () => {
  await resetDb();
  fixture = await seedMinimal();
  const [ml, litre] = await Promise.all([
    db.unit.create({
      data: { code: 'ml', name: 'millilitre', dimension: 'VOLUME', baseFactor: 1 }
    }),
    db.unit.create({
      data: { code: 'l', name: 'litre', dimension: 'VOLUME', baseFactor: 1000 }
    })
  ]);
  items = {
    flour: await db.item.update({
      where: { id: fixture.items.flour.id },
      data: { code: 'FLOUR', name: 'Flour' }
    }),
    oil: await db.item.create({
      data: {
        code: 'OIL',
        name: 'Oil',
        type: 'RAW',
        baseUnitId: ml.id,
        displayUnitId: litre.id
      }
    }),
    spice: await db.item.create({
      data: {
        code: 'SPICE',
        name: 'Salt and spice mix',
        type: 'RAW',
        baseUnitId: fixture.units.g.id,
        displayUnitId: fixture.units.kg.id
      }
    }),
    pouch: await db.item.create({
      data: {
        code: 'POUCH200',
        name: '200 g pouch',
        type: 'PACKAGING',
        baseUnitId: fixture.units.pcs.id,
        displayUnitId: fixture.units.pcs.id
      }
    }),
    carton: await db.item.create({
      data: {
        code: 'CARTON',
        name: 'Carton',
        type: 'PACKAGING',
        baseUnitId: fixture.units.pcs.id,
        displayUnitId: fixture.units.pcs.id
      }
    }),
    finished: await db.item.update({
      where: { id: fixture.items.finished.id },
      data: { code: 'MURUKKU200', name: 'Murukku 200 g' }
    })
  };
  production = await db.user.create({
    data: {
      name: 'Production user',
      email: 'production@test.invalid',
      passwordHash: 'test-only',
      role: 'PRODUCTION'
    }
  });
  salesman = await db.user.create({
    data: {
      name: 'Salesman user',
      email: 'salesman@test.invalid',
      passwordHash: 'test-only',
      role: 'SALESMAN'
    }
  });

  bom = await db.bom.create({
    data: {
      name: 'Murukku 200 g',
      finishedItemId: items.finished.id,
      version: 1,
      isActive: true,
      batchYieldQty: 200,
      lines: {
        create: [
          { itemId: items.flour.id, qtyPerBatch: 40000 },
          { itemId: items.oil.id, qtyPerBatch: 10000 },
          { itemId: items.spice.id, qtyPerBatch: 1200 },
          { itemId: items.pouch.id, qtyPerBatch: 200 },
          { itemId: items.carton.id, qtyPerBatch: 10 }
        ]
      }
    }
  });

  const openingDate = new Date('2026-04-01T00:00:00.000Z');
  for (const [itemId, qtyChange, ratePaisePerBase] of [
    [items.flour.id, 100000, '4.2'],
    [items.flour.id, 60000, '4.5'],
    [items.oil.id, 30000, '14'],
    [items.spice.id, 5000, '20'],
    [items.pouch.id, 500, '250'],
    [items.carton.id, 30, '1500'],
    [items.finished.id, 50, '3000']
  ]) {
    await db.stockMovement.create({
      data: {
        itemId,
        qtyChange,
        movementType: itemId === items.flour.id && ratePaisePerBase === '4.5'
          ? 'PURCHASE'
          : 'OPENING',
        sourceType: itemId === items.flour.id && ratePaisePerBase === '4.5'
          ? 'PURCHASE'
          : 'OPENING',
        sourceId: itemId,
        sourceRef: `TEST-OPENING-${itemId}-${ratePaisePerBase}`,
        ratePaisePerBase,
        movementDate: openingDate,
        createdById: fixture.users.admin.id
      }
    });
  }
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('production run start and material issue', () => {
  it('creates a numbered run, snapshots the plan and issues the requested quantities', async () => {
    const response = await postRun(production, { issues: benchmarkIssues() });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      runNo: `RUN/${financialYearOf(new Date(response.body.startedAt))}/0001`,
      status: 'ISSUED',
      batchCount: '1',
      plannedOutputQty: 200,
      toleranceBpUsed: 300,
      runningMaterialCostPaise: 343500,
      runningMaterialCostDisplay: '3,435.00'
    });
    expect(response.body.lines).toHaveLength(5);
    expect(response.body.lines.find((line) => line.itemId === items.flour.id)).toMatchObject({
      itemName: 'Flour',
      plannedQtyBase: 40000,
      plannedQtyDisplay: '40 kg',
      issuedQtyBase: 40000,
      issuedQtyDisplay: '40 kg',
      costPaise: 172500,
      ratePaisePerBase: '4.3125'
    });
    expect(response.body.lines.find((line) => line.itemId === items.pouch.id)).toMatchObject({
      plannedQtyBase: 200,
      issuedQtyBase: 0,
      issuedQtyDisplay: '0 pcs'
    });

    const movements = await db.stockMovement.findMany({
      where: { sourceType: 'PRODUCTION_RUN', sourceId: response.body.id },
      orderBy: { itemId: 'asc' }
    });
    expect(movements).toHaveLength(3);
    expect(movements.every((movement) =>
      movement.movementType === 'PRODUCTION_ISSUE' && movement.qtyChange < 0
    )).toBe(true);
    expect(await getBalance(db, items.flour.id)).toBe(120000);
    expect(await getBalance(db, items.oil.id)).toBe(19500);
    expect(await getBalance(db, items.spice.id)).toBe(3800);
    expect(await getBalance(db, items.pouch.id)).toBe(500);
    expect(await getBalance(db, items.carton.id)).toBe(30);
    expect(await getBalance(db, items.finished.id)).toBe(50);
    expect(await db.auditLog.count({
      where: { entity: 'ProductionRun', entityId: response.body.id, action: 'CREATE' }
    })).toBe(1);
  });

  it('issues every raw-material line at plan quantity when issues are omitted', async () => {
    const response = await postRun(production);

    expect(response.status).toBe(201);
    expect(response.body.lines.filter((line) => line.item.type === 'RAW').every((line) =>
      line.issuedQty === line.plannedQty
    )).toBe(true);
    expect(response.body.lines.filter((line) => line.item.type === 'PACKAGING').every((line) =>
      line.issuedQty === 0
    )).toBe(true);
    expect(await db.stockMovement.count({
      where: { movementType: 'PRODUCTION_ISSUE' }
    })).toBe(3);
  });

  it('rolls back the run, issue movements, audit and number when stock is insufficient', async () => {
    const response = await postRun(production, {
      issues: [{ itemId: items.flour.id, qty: '200', unit: 'kg' }]
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await db.productionRun.count()).toBe(0);
    expect(await db.productionRunLine.count()).toBe(0);
    expect(await db.stockMovement.count({ where: { movementType: 'PRODUCTION_ISSUE' } })).toBe(0);
    expect(await db.auditLog.count({ where: { entity: 'ProductionRun' } })).toBe(0);
    expect(await db.documentCounter.findUnique({
      where: { key: runCounterKey() }
    })).toBeNull();
  });

  it('rejects items outside the BOM without creating a run', async () => {
    const otherRaw = await db.item.create({
      data: {
        code: 'OTHER-RAW',
        name: 'Other raw material',
        type: 'RAW',
        baseUnitId: fixture.units.g.id,
        displayUnitId: fixture.units.kg.id
      }
    });
    const response = await postRun(production, {
      issues: [{ itemId: otherRaw.id, qty: '1', unit: 'kg' }]
    });

    expect(response.status).toBe(400);
    expect(await db.productionRun.count()).toBe(0);
    expect(await db.documentCounter.findUnique({
      where: { key: runCounterKey() }
    })).toBeNull();
  });

  it('forbids salesmen from starting production runs', async () => {
    const response = await postRun(salesman);
    expect(response.status).toBe(403);
    expect(await db.productionRun.count()).toBe(0);
  });
});
