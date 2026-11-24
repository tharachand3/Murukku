import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
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

function standardLines() {
  return [
    { itemId: items.flour.id, qty: '40', unit: 'kg' },
    { itemId: items.oil.id, qty: '10', unit: 'l' },
    { itemId: items.spice.id, qty: '1.2', unit: 'kg' },
    { itemId: items.pouch.id, qty: '200', unit: 'pcs' },
    { itemId: items.carton.id, qty: '10', unit: 'pcs' }
  ];
}

beforeEach(async () => {
  await resetDb();
  fixture = await seedMinimal();
  const ml = await db.unit.create({
    data: { code: 'ml', name: 'millilitre', dimension: 'VOLUME', baseFactor: 1 }
  });
  const l = await db.unit.create({
    data: { code: 'l', name: 'litre', dimension: 'VOLUME', baseFactor: 1000 }
  });
  await db.item.update({
    where: { id: fixture.items.flour.id },
    data: { name: 'Flour', code: 'FLOUR' }
  });
  items = {
    flour: fixture.items.flour,
    oil: await db.item.create({
      data: {
        code: 'OIL',
        name: 'Oil',
        type: 'RAW',
        baseUnitId: ml.id,
        displayUnitId: l.id
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
    finished: await db.item.create({
      data: {
        code: 'MURUKKU200',
        name: 'Murukku 200 g',
        type: 'FINISHED',
        baseUnitId: fixture.units.packet.id,
        displayUnitId: fixture.units.packet.id
      }
    })
  };
  production = await db.user.create({
    data: {
      name: 'BOM Production',
      email: 'bom-production@test.invalid',
      passwordHash: 'test-only',
      role: 'PRODUCTION'
    }
  });
  salesman = await db.user.create({
    data: {
      name: 'BOM Salesman',
      email: 'bom-salesman@test.invalid',
      passwordHash: 'test-only',
      role: 'SALESMAN'
    }
  });
  bom = await db.bom.create({
    data: {
      name: 'Murukku 200 g - standard batch',
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
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('BOM endpoints', () => {
  it('returns recipe lines in base quantities and display units', async () => {
    const list = await request(app)
      .get(`/api/boms?finishedItemId=${items.finished.id}&active=true`)
      .set(as(production));
    const detail = await request(app)
      .get(`/api/boms/${bom.id}`)
      .set(as(production));

    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(detail.body).toMatchObject({
      id: bom.id,
      batchYieldQty: 200,
      finishedItem: { name: 'Murukku 200 g' }
    });
    expect(Object.fromEntries(
      detail.body.lines.map((line) => [line.item.code, line.qtyPerBatchDisplay])
    )).toEqual({
      CARTON: '10 pcs',
      FLOUR: '40 kg',
      OIL: '10 l',
      POUCH200: '200 pcs',
      SPICE: '1.2 kg'
    });
    expect(detail.body.lines.find((line) => line.item.code === 'FLOUR')).toMatchObject({
      itemName: 'Flour',
      qtyPerBatch: 40000
    });
  });

  it('plans BOM consumption from batches, target output, or an issued quantity', async () => {
    const basePath = `/api/boms/${bom.id}/plan`;
    const [byBatch, byTarget, byIssue, noMode, conflictingModes] = await Promise.all([
      request(app).get(`${basePath}?batches=1`).set(as(production)),
      request(app).get(`${basePath}?targetOutput=300`).set(as(production)),
      request(app)
        .get(`${basePath}?itemId=${items.flour.id}&qty=20&unit=kg`)
        .set(as(production)),
      request(app).get(basePath).set(as(production)),
      request(app).get(`${basePath}?batches=1&targetOutput=300`).set(as(production))
    ]);

    expect(byBatch.status).toBe(200);
    expect(byBatch.body).toMatchObject({
      batchCount: '1',
      plannedOutputQty: 200
    });
    expect(Object.fromEntries(
      byBatch.body.lines.map((line) => [line.itemName, line.plannedQty])
    )).toEqual({
      Carton: 10,
      Flour: 40000,
      Oil: 10000,
      '200 g pouch': 200,
      'Salt and spice mix': 1200
    });

    expect(byTarget.status).toBe(200);
    expect(byTarget.body).toMatchObject({
      batchCount: '1.5',
      plannedOutputQty: 300
    });

    expect(byIssue.status).toBe(200);
    expect(byIssue.body).toMatchObject({
      batchCount: '0.5',
      plannedOutputQty: 100,
      lines: expect.arrayContaining([
        expect.objectContaining({
          itemId: items.flour.id,
          itemName: 'Flour',
          plannedQty: 20000,
          plannedQtyDisplay: '20 kg'
        })
      ])
    });
    expect(noMode.status).toBe(400);
    expect(conflictingModes.status).toBe(400);
  });

  it('rejects finished goods as recipes and components', async () => {
    const body = {
      name: 'Invalid BOM',
      finishedItemId: items.finished.id,
      batchYieldQty: 200,
      lines: [{ itemId: items.flour.id, qty: '40', unit: 'kg' }]
    };
    const invalidFinishedItem = await request(app)
      .post('/api/boms')
      .set(as(fixture.users.admin))
      .send({ ...body, finishedItemId: items.flour.id });
    const invalidComponent = await request(app)
      .post('/api/boms')
      .set(as(fixture.users.admin))
      .send({
        ...body,
        lines: [{ itemId: items.finished.id, qty: '1', unit: 'packet' }]
      });
    const invalidUnit = await request(app)
      .post('/api/boms')
      .set(as(fixture.users.admin))
      .send({
        ...body,
        lines: [{ itemId: items.flour.id, qty: '1', unit: 'l' }]
      });

    expect(invalidFinishedItem.status).toBe(400);
    expect(invalidComponent.status).toBe(400);
    expect(invalidUnit.status).toBe(400);
  });

  it('edits an unused BOM in place and audits the update', async () => {
    const response = await request(app)
      .put(`/api/boms/${bom.id}`)
      .set(as(fixture.users.admin))
      .send({
        name: 'Murukku 200 g - revised',
        batchYieldQty: 220,
        lines: [
          { itemId: items.flour.id, qty: '41', unit: 'kg' },
          ...standardLines().slice(1)
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: bom.id,
      version: 1,
      name: 'Murukku 200 g - revised',
      batchYieldQty: 220,
      isActive: true
    });
    expect(response.body.lines.find((line) => line.itemId === items.flour.id)).toMatchObject({
      qtyPerBatch: 41000,
      qtyPerBatchDisplay: '41 kg'
    });
    expect(await db.bom.count({ where: { finishedItemId: items.finished.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entity: 'Bom', action: 'UPDATE' } })).toBe(1);
  });

  it('creates a new version instead of mutating a BOM used by a production run', async () => {
    const run = await db.productionRun.create({
      data: {
        runNo: 'RUN/BOM-TEST/0001',
        bomId: bom.id,
        finishedItemId: items.finished.id,
        status: 'ISSUED',
        plannedOutputQty: 200,
        toleranceBpUsed: 300,
        startedAt: new Date(),
        startedById: fixture.users.admin.id
      }
    });
    const response = await request(app)
      .put(`/api/boms/${bom.id}`)
      .set(as(fixture.users.admin))
      .send({
        name: 'Murukku 200 g - v2',
        batchYieldQty: 210,
        lines: standardLines()
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      version: 2,
      isActive: true,
      name: 'Murukku 200 g - v2',
      batchYieldQty: 210
    });
    expect(response.body.id).not.toBe(bom.id);
    const previous = await db.bom.findUnique({ where: { id: bom.id } });
    expect(previous.isActive).toBe(false);
    expect((await db.productionRun.findUnique({ where: { id: run.id } })).bomId).toBe(bom.id);
    expect(await db.auditLog.count({ where: { entity: 'Bom' } })).toBe(2);
    expect(await db.auditLog.count({
      where: { entity: 'Bom', userId: fixture.users.admin.id }
    })).toBe(2);
  });

  it('clones a recipe for a new pack size, swapping packaging while retaining raw lines', async () => {
    const pouch500 = await db.item.create({
      data: {
        code: 'POUCH500',
        name: '500 g pouch',
        type: 'PACKAGING',
        baseUnitId: fixture.units.pcs.id,
        displayUnitId: fixture.units.pcs.id
      }
    });
    const finished500 = await db.item.create({
      data: {
        code: 'MURUKKU500',
        name: 'Murukku 500 g',
        type: 'FINISHED',
        baseUnitId: fixture.units.packet.id,
        displayUnitId: fixture.units.packet.id
      }
    });
    const response = await request(app)
      .post(`/api/boms/${bom.id}/clone`)
      .set(as(production))
      .send({
        finishedItemId: finished500.id,
        name: 'Murukku 500 g - standard batch',
        replaceItems: [{
          fromItemId: items.pouch.id,
          toItemId: pouch500.id,
          qty: '200',
          unit: 'pcs'
        }]
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      version: 1,
      isActive: true,
      finishedItemId: finished500.id,
      batchYieldQty: 200
    });
    const clonedLines = new Map(
      response.body.lines.map((line) => [line.itemId, line.qtyPerBatch])
    );
    expect(clonedLines.get(items.flour.id)).toBe(40000);
    expect(clonedLines.get(items.oil.id)).toBe(10000);
    expect(clonedLines.get(items.spice.id)).toBe(1200);
    expect(clonedLines.has(items.pouch.id)).toBe(false);
    expect(clonedLines.get(pouch500.id)).toBe(200);
    expect(await db.auditLog.count({ where: { entity: 'Bom', action: 'CREATE' } })).toBe(1);
  });

  it('increments the version and leaves only the new recipe active on create', async () => {
    const response = await request(app)
      .post('/api/boms')
      .set(as(production))
      .send({
        name: 'Murukku 200 g - second recipe',
        finishedItemId: items.finished.id,
        batchYieldQty: 200,
        lines: standardLines()
      });

    expect(response.status).toBe(201);
    expect(response.body.version).toBe(2);
    expect(await db.bom.count({
      where: { finishedItemId: items.finished.id, isActive: true }
    })).toBe(1);
    expect((await db.bom.findUnique({ where: { id: bom.id } })).isActive).toBe(false);
  });

  it('forbids salesmen from reading or writing BOMs', async () => {
    const read = await request(app)
      .get('/api/boms')
      .set(as(salesman));
    const write = await request(app)
      .post('/api/boms')
      .set(as(salesman))
      .send({});

    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
  });
});
