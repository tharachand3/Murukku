import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { financialYearOf } from '../src/lib/fy.js';
import { prisma } from '../src/lib/prisma.js';
import { addMovement, getBalance } from '../src/services/ledgerService.js';
import { applyRunVariance } from '../src/services/varianceService.js';
import { db, resetDb, seedMinimal } from './helpers/db.js';

let fixture;
let items;
let bom;
let production;
let salesman;
let supplier;

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

async function postPurchase(user = production) {
  return request(app)
    .post('/api/purchases')
    .set(as(user))
    .send({
      supplierId: supplier.id,
      lines: [{
        itemId: items.flour.id,
        qty: '60',
        unit: 'kg',
        ratePerUnitRupees: '45'
      }]
    });
}

async function completeRun(user, runId, body) {
  return request(app)
    .post(`/api/production/runs/${runId}/complete`)
    .set(as(user))
    .send(body);
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
  supplier = await db.supplier.create({
    data: { name: 'Production test supplier', stateCode: '33' }
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
        movementType: 'OPENING',
        sourceType: 'OPENING',
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
    const purchase = await postPurchase();
    expect(purchase.status).toBe(201);
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

describe('production run completion', () => {
  it('completes the full benchmark run with packaging consumption, damage and output', async () => {
    const purchase = await postPurchase();
    expect(purchase.status).toBe(201);
    await db.setting.upsert({
      where: { key: 'VARIANCE_TOLERANCE_BP' },
      update: { value: '300' },
      create: { key: 'VARIANCE_TOLERANCE_BP', value: '300' }
    });
    const started = await postRun(production, { issues: benchmarkIssues() });
    expect(started.status).toBe(201);

    const response = await completeRun(production, started.body.id, {
      actualGoodQty: 188,
      rejectedFinishedQty: 2,
      batchNo: 'BENCH-001',
      expiryDate: '2027-11-25T00:00:00.000Z',
      consumption: [
        { itemId: items.pouch.id, qty: '188', unit: 'pcs', scrapQty: '6' },
        { itemId: items.carton.id, qty: '9', unit: 'pcs' }
      ]
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      runNo: started.body.runNo,
      status: 'COMPLETED',
      actualGoodQty: 188,
      rejectedFinishedQty: 2,
      materialCostPaise: 405500,
      runningMaterialCostPaise: 405500,
      runningMaterialCostDisplay: '4,055.00',
      yieldVarianceBp: -600,
      yieldFlagged: true
    });
    expect(response.body.lines.find((line) => line.itemId === items.pouch.id)).toMatchObject({
      plannedQty: 200,
      issuedQty: 194,
      scrapQty: 6,
      costPaise: 48500
    });
    expect(response.body.lines.find((line) => line.itemId === items.carton.id)).toMatchObject({
      plannedQty: 10,
      issuedQty: 9,
      scrapQty: 0,
      costPaise: 13500
    });
    expect(response.body.ledgerRows).toHaveLength(4);
    expect(response.body.ledgerRows.find((row) =>
      row.movementType === 'PRODUCTION_OUTPUT'
    )).toMatchObject({
      itemId: items.finished.id,
      qtyChange: 188,
      ratePaisePerBase: null,
      batchNo: 'BENCH-001'
    });

    const movements = await db.stockMovement.findMany({
      where: { sourceType: 'PRODUCTION_RUN', sourceId: started.body.id },
      orderBy: { id: 'asc' }
    });
    expect(movements).toHaveLength(7);
    expect(movements.every((movement) => movement.sourceRef === started.body.runNo)).toBe(true);
    expect(movements.map((movement) => movement.movementType)).toEqual([
      'PRODUCTION_ISSUE',
      'PRODUCTION_ISSUE',
      'PRODUCTION_ISSUE',
      'PRODUCTION_ISSUE',
      'PRODUCTION_SCRAP',
      'PRODUCTION_ISSUE',
      'PRODUCTION_OUTPUT'
    ]);

    expect(await getBalance(db, items.flour.id)).toBe(120000);
    expect(await getBalance(db, items.oil.id)).toBe(19500);
    expect(await getBalance(db, items.spice.id)).toBe(3800);
    expect(await getBalance(db, items.pouch.id)).toBe(306);
    expect(await getBalance(db, items.carton.id)).toBe(21);
    expect(await getBalance(db, items.finished.id)).toBe(238);
    expect(await db.auditLog.count({
      where: { entity: 'ProductionRun', entityId: started.body.id, action: 'UPDATE' }
    })).toBe(1);
    await db.setting.update({
      where: { key: 'VARIANCE_TOLERANCE_BP' },
      data: { value: '1000' }
    });
    const recomputed = await prisma.$transaction((tx) =>
      applyRunVariance(tx, started.body.id)
    );
    expect(recomputed.yield.bp).toBe(-600);
    expect(recomputed.yield.flagged).toBe(true);
    const varianceResponse = await request(app)
      .get(`/api/production/runs/${started.body.id}/variance`)
      .set(as(production));
    expect(varianceResponse.status).toBe(200);
    expect(varianceResponse.body).toMatchObject({
      runId: started.body.id,
      runNo: started.body.runNo,
      toleranceBpUsed: 300,
      yield: {
        plannedOutputQty: 200,
        actualGoodQty: 188,
        diffQty: -12,
        bp: -600,
        pct: '-6.00',
        flagged: true
      }
    });
    const varianceByCode = new Map(varianceResponse.body.lines.map((line) => [
      line.itemName,
      { bp: line.bp, pct: line.pct, flagged: line.flagged }
    ]));
    expect(varianceByCode.get('Flour')).toEqual({ bp: 0, pct: '0.00', flagged: false });
    expect(varianceByCode.get('Oil')).toEqual({ bp: 500, pct: '5.00', flagged: true });
    expect(varianceByCode.get('Salt and spice mix')).toEqual({
      bp: 0,
      pct: '0.00',
      flagged: false
    });
    expect(varianceByCode.get('200 g pouch')).toEqual({
      bp: -300,
      pct: '-3.00',
      flagged: false
    });
    expect(varianceByCode.get('Carton')).toEqual({
      bp: -1000,
      pct: '-10.00',
      flagged: true
    });
    expect(varianceResponse.body.alerts).toEqual([
      'Yield 188 vs 200 expected (-6.00%) - flagged',
      'Carton used 9 pcs vs 10 pcs planned (-10.00%) - flagged',
      'Oil used 10.5 l vs 10 l planned (+5.00%) - flagged'
    ]);
    const runLines = await db.productionRunLine.findMany({ where: { runId: started.body.id } });
    expect(runLines.every((line) => line.varianceBp !== null)).toBe(true);
    expect((await db.productionRun.findUnique({
      where: { id: started.body.id }
    })).yieldVarianceBp).toBe(-600);
  });

  it('rejects completing a run twice with RUN_NOT_OPEN', async () => {
    const started = await postRun(production);
    const first = await completeRun(production, started.body.id, { actualGoodQty: 1 });
    const second = await completeRun(production, started.body.id, { actualGoodQty: 1 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('RUN_NOT_OPEN');
    expect(await db.stockMovement.count({
      where: { sourceType: 'PRODUCTION_RUN', sourceId: started.body.id }
    })).toBe(4);
  });

  it('rolls back output and consumption when packaging stock is insufficient', async () => {
    const started = await postRun(production);
    await addMovement(db, {
      itemId: items.pouch.id,
      qtyChange: -307,
      movementType: 'ADJUSTMENT',
      sourceType: 'ADJUSTMENT',
      sourceId: 1,
      sourceRef: 'TEST-LOW-POUCH-STOCK',
      movementDate: new Date(),
      userId: fixture.users.admin.id
    });

    const response = await completeRun(production, started.body.id, {
      actualGoodQty: 188,
      consumption: [
        { itemId: items.pouch.id, qty: '188', unit: 'pcs', scrapQty: '6' },
        { itemId: items.carton.id, qty: '9', unit: 'pcs' }
      ]
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
    const run = await db.productionRun.findUnique({ where: { id: started.body.id } });
    expect(run.status).toBe('ISSUED');
    expect(run.actualGoodQty).toBeNull();
    expect(await db.stockMovement.count({
      where: { sourceType: 'PRODUCTION_RUN', sourceId: started.body.id }
    })).toBe(3);
    expect(await getBalance(db, items.pouch.id)).toBe(193);
    expect(await getBalance(db, items.finished.id)).toBe(50);
  });

  it('rejects negative finished output', async () => {
    const started = await postRun(production);
    const response = await completeRun(production, started.body.id, { actualGoodQty: -1 });

    expect(response.status).toBe(400);
    expect(await db.productionRun.findUnique({
      where: { id: started.body.id },
      select: { status: true }
    })).toMatchObject({ status: 'ISSUED' });
  });

  it('rejects consumption items outside the BOM without changing the run', async () => {
    const started = await postRun(production);
    const outsideItem = await db.item.create({
      data: {
        code: 'OUTSIDE-COMPONENT',
        name: 'Outside component',
        type: 'RAW',
        baseUnitId: fixture.units.g.id,
        displayUnitId: fixture.units.kg.id
      }
    });
    const response = await completeRun(production, started.body.id, {
      actualGoodQty: 188,
      consumption: [{ itemId: outsideItem.id, qty: '1', unit: 'kg' }]
    });

    expect(response.status).toBe(400);
    expect(await db.productionRun.findUnique({
      where: { id: started.body.id },
      select: { status: true }
    })).toMatchObject({ status: 'ISSUED' });
  });

  it('returns no alerts for exact consumption and filters the variance list by flags', async () => {
    const flaggedRun = await postRun(production, { issues: benchmarkIssues() });
    const flaggedCompletion = await completeRun(production, flaggedRun.body.id, {
      actualGoodQty: 188,
      consumption: [
        { itemId: items.pouch.id, qty: '188', unit: 'pcs', scrapQty: '6' },
        { itemId: items.carton.id, qty: '9', unit: 'pcs' }
      ]
    });
    expect(flaggedCompletion.status).toBe(200);

    const exactRun = await postRun(production);
    const exactCompletion = await completeRun(production, exactRun.body.id, {
      actualGoodQty: 200,
      consumption: [
        { itemId: items.pouch.id, qty: '200', unit: 'pcs' },
        { itemId: items.carton.id, qty: '10', unit: 'pcs' }
      ]
    });
    expect(exactCompletion.status).toBe(200);
    const exactVariance = await request(app)
      .get(`/api/production/runs/${exactRun.body.id}/variance`)
      .set(as(production));
    expect(exactVariance.status).toBe(200);
    expect(exactVariance.body.alerts).toEqual([]);
    expect(exactVariance.body.yield.flagged).toBe(false);
    expect(exactVariance.body.lines.every((line) => !line.flagged)).toBe(true);

    await db.productionRun.update({
      where: { id: flaggedRun.body.id },
      data: { yieldVarianceBp: null, yieldFlagged: false }
    });
    await db.productionRunLine.updateMany({
      where: { runId: flaggedRun.body.id },
      data: { varianceBp: null, flagged: false }
    });
    const [allRuns, flaggedOnly, denied] = await Promise.all([
      request(app).get('/api/production/variance?page=1&limit=10').set(as(production)),
      request(app).get('/api/production/variance?flaggedOnly=true').set(as(production)),
      request(app).get('/api/production/variance').set(as(salesman))
    ]);
    expect(allRuns.status, JSON.stringify(allRuns.body)).toBe(200);
    expect(allRuns.body.total).toBe(2);
    expect(allRuns.body.items).toHaveLength(2);
    expect(allRuns.body.items.find((run) => run.runId === exactRun.body.id).alertCount).toBe(0);
    expect(flaggedOnly.status).toBe(200);
    expect(flaggedOnly.body.total).toBe(1);
    expect(flaggedOnly.body.items).toHaveLength(1);
    expect(flaggedOnly.body.items[0]).toMatchObject({
      runId: flaggedRun.body.id,
      runNo: flaggedRun.body.runNo,
      yieldFlagged: true,
      alertCount: 3
    });
    expect(denied.status).toBe(403);
  });
});
