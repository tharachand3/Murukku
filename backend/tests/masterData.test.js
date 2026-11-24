import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { addMovement } from '../src/services/ledgerService.js';
import { db, resetDb, seedMinimal } from './helpers/db.js';

let fixture;
let salesmen;
let customers;
let owner;
let production;

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

beforeEach(async () => {
  await resetDb();
  fixture = await seedMinimal();
  salesmen = await Promise.all(['a', 'b'].map((suffix) => db.user.create({
    data: {
      name: `Salesman ${suffix.toUpperCase()}`,
      email: `salesman-${suffix}@test.invalid`,
      passwordHash: 'test-only',
      role: 'SALESMAN'
    }
  })));
  production = await db.user.create({
    data: {
      name: 'Master data production',
      email: 'master-production@test.invalid',
      passwordHash: 'test-only',
      role: 'PRODUCTION'
    }
  });
  owner = await db.user.create({
    data: {
      name: 'Master data owner',
      email: 'master-owner@test.invalid',
      passwordHash: 'test-only',
      role: 'OWNER'
    }
  });
  customers = await Promise.all([
    db.customer.create({
      data: {
        name: 'Retailer A',
        type: 'RETAILER',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        assignedSalesmanId: salesmen[0].id
      }
    }),
    db.customer.create({
      data: {
        name: 'Retailer B',
        type: 'RETAILER',
        stateCode: '29',
        stateName: 'Karnataka',
        assignedSalesmanId: salesmen[1].id
      }
    })
  ]);
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('master data endpoints', () => {
  it('grants reads to all roles while limiting salesman customers and writes', async () => {
    const roles = [
      fixture.users.admin,
      fixture.users.accountant,
      salesmen[0],
      production,
      owner
    ];
    for (const user of roles) {
      const responses = await Promise.all([
        request(app).get('/api/items').set(as(user)),
        request(app).get('/api/suppliers').set(as(user)),
        request(app).get('/api/settings').set(as(user)),
        request(app).get('/api/customers').set(as(user))
      ]);
      expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    }

    const salesmanCustomers = await request(app)
      .get('/api/customers')
      .set(as(salesmen[0]));
    expect(salesmanCustomers.body.map(({ name }) => name)).toEqual(['Retailer A']);

    const forbiddenWrites = await Promise.all([
      request(app).post('/api/items').set(as(salesmen[0])).send({}),
      request(app).post('/api/customers').set(as(salesmen[0])).send({}),
      request(app).post('/api/suppliers').set(as(salesmen[0])).send({}),
      request(app).put('/api/settings/VARIANCE_TOLERANCE_BP')
        .set(as(salesmen[0])).send({ value: 100 }),
      request(app).put(`/api/customers/${customers[0].id}/prices`)
        .set(as(salesmen[0])).send({ prices: [] }),
      request(app).get('/api/users').set(as(salesmen[0]))
    ]);
    expect(forbiddenWrites.map(({ status }) => status)).toEqual([
      403, 403, 403, 403, 403, 403
    ]);

    const unauthenticated = await request(app).get('/api/items');
    expect(unauthenticated.status).toBe(401);
  });

  it('creates items, rejects duplicates and mismatched units, and prevents deactivation with stock', async () => {
    const created = await request(app)
      .post('/api/items')
      .set(as(fixture.users.admin))
      .send({
        code: 'NEW-FLOUR',
        name: 'New flour',
        type: 'RAW',
        baseUnitId: fixture.units.g.id,
        displayUnitId: fixture.units.kg.id
      });
    expect(created.status).toBe(201);
    expect(created.body.gstRateBp).toBe(0);

    const duplicate = await request(app)
      .post('/api/items')
      .set(as(fixture.users.admin))
      .send({
        code: 'NEW-FLOUR',
        name: 'Duplicate flour',
        type: 'RAW',
        baseUnitId: fixture.units.g.id,
        displayUnitId: fixture.units.kg.id
      });
    expect(duplicate.status).toBe(409);

    const mismatchedUnits = await request(app)
      .post('/api/items')
      .set(as(fixture.users.admin))
      .send({
        code: 'BAD-UNIT',
        name: 'Bad unit item',
        type: 'RAW',
        baseUnitId: fixture.units.g.id,
        displayUnitId: fixture.units.packet.id
      });
    expect(mismatchedUnits.status).toBe(400);

    await addMovement(db, {
      itemId: created.body.id,
      qtyChange: 50,
      movementType: 'OPENING',
      sourceType: 'OPENING',
      sourceId: created.body.id,
      sourceRef: 'OPENING-NEW-FLOUR'
    });
    const blockedDeactivation = await request(app)
      .patch(`/api/items/${created.body.id}`)
      .set(as(fixture.users.admin))
      .send({ isActive: false });
    expect(blockedDeactivation.status).toBe(409);
    expect(await db.auditLog.count({ where: { entity: 'Item' } })).toBe(1);
  });

  it('validates customer state and GSTIN and only exposes assigned customers to salesmen', async () => {
    const invalidState = await request(app)
      .post('/api/customers')
      .set(as(fixture.users.admin))
      .send({ name: 'Invalid state', type: 'RETAILER', stateCode: '99' });
    expect(invalidState.status).toBe(400);

    const invalidGstin = await request(app)
      .post('/api/customers')
      .set(as(fixture.users.admin))
      .send({
        name: 'Invalid GSTIN',
        type: 'RETAILER',
        stateCode: '33',
        gstin: 'not-a-gstin'
      });
    expect(invalidGstin.status).toBe(400);

    const created = await request(app)
      .post('/api/customers')
      .set(as(fixture.users.admin))
      .send({
        name: 'GST customer',
        type: 'DISTRIBUTOR',
        stateCode: '33',
        gstin: '33ABCDE1234F1Z5'
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      gstin: '33ABCDE1234F1Z5',
      stateCode: '33',
      stateName: 'Tamil Nadu'
    });

    const assigned = await request(app)
      .get(`/api/customers/${customers[0].id}`)
      .set(as(salesmen[0]));
    const unassigned = await request(app)
      .get(`/api/customers/${customers[1].id}`)
      .set(as(salesmen[0]));
    expect(assigned.status).toBe(200);
    expect(unassigned.status).toBe(404);
  });

  it('upserts customer prices and lets a salesman read prices only for assigned customers', async () => {
    const path = `/api/customers/${customers[0].id}/prices`;
    const first = await request(app)
      .put(path)
      .set(as(fixture.users.admin))
      .send({
        prices: [{ itemId: fixture.items.finished.id, pricePaise: 5500 }]
      });
    expect(first.status).toBe(200);
    expect(first.body[0].pricePaise).toBe(5500);

    const second = await request(app)
      .put(path)
      .set(as(fixture.users.admin))
      .send({
        prices: [{ itemId: fixture.items.finished.id, pricePaise: 6000 }]
      });
    expect(second.status).toBe(200);
    expect(second.body[0].pricePaise).toBe(6000);
    expect(await db.auditLog.count({ where: { entity: 'CustomerPrice' } })).toBe(2);

    const assigned = await request(app).get(path).set(as(salesmen[0]));
    const unassigned = await request(app)
      .get(`/api/customers/${customers[1].id}/prices`)
      .set(as(salesmen[0]));
    expect(assigned.status).toBe(200);
    expect(assigned.body[0].pricePaise).toBe(6000);
    expect(unassigned.status).toBe(404);
  });

  it('supports supplier CRUD with authenticated reads and admin-only writes', async () => {
    const created = await request(app)
      .post('/api/suppliers')
      .set(as(fixture.users.admin))
      .send({ name: 'North Mill', stateCode: '29' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('North Mill');

    const updated = await request(app)
      .patch(`/api/suppliers/${created.body.id}`)
      .set(as(fixture.users.admin))
      .send({ phone: '5550100' });
    expect(updated.status).toBe(200);
    expect(updated.body.phone).toBe('5550100');

    const read = await request(app)
      .get(`/api/suppliers/${created.body.id}`)
      .set(as(fixture.users.accountant));
    expect(read.status).toBe(200);
    expect(await db.auditLog.count({ where: { entity: 'Supplier' } })).toBe(2);
  });

  it('validates settings and audits accepted changes', async () => {
    const invalidTolerance = await request(app)
      .put('/api/settings/VARIANCE_TOLERANCE_BP')
      .set(as(fixture.users.admin))
      .send({ value: 5001 });
    const fixedMonth = await request(app)
      .put('/api/settings/FY_START_MONTH')
      .set(as(fixture.users.admin))
      .send({ value: 5 });
    expect(invalidTolerance.status).toBe(400);
    expect(fixedMonth.status).toBe(400);

    const valid = await request(app)
      .put('/api/settings/VARIANCE_TOLERANCE_BP')
      .set(as(fixture.users.admin))
      .send({ value: 3000 });
    expect(valid.status).toBe(200);
    expect(valid.body).toMatchObject({
      key: 'VARIANCE_TOLERANCE_BP',
      value: '3000'
    });
    expect(await db.auditLog.count({ where: { entity: 'Setting' } })).toBe(1);
  });

  it('manages users without returning password hashes and blocks self-demotion', async () => {
    const created = await request(app)
      .post('/api/users')
      .set(as(fixture.users.admin))
      .send({
        name: 'New User',
        email: 'New.User@test.invalid',
        password: 'initial-secret',
        role: 'SALESMAN'
      });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('passwordHash');
    expect(created.body.email).toBe('new.user@test.invalid');

    const listed = await request(app)
      .get('/api/users')
      .set(as(fixture.users.admin));
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain('passwordHash');

    const updated = await request(app)
      .patch(`/api/users/${created.body.id}`)
      .set(as(fixture.users.admin))
      .send({ role: 'PRODUCTION' });
    expect(updated.status).toBe(200);
    expect(JSON.stringify(updated.body)).not.toContain('passwordHash');

    const reset = await request(app)
      .post(`/api/users/${created.body.id}/reset-password`)
      .set(as(fixture.users.admin))
      .send({ password: 'replacement-secret' });
    expect(reset.status).toBe(200);
    expect(JSON.stringify(reset.body)).not.toContain('passwordHash');

    const selfDemotion = await request(app)
      .patch(`/api/users/${fixture.users.admin.id}`)
      .set(as(fixture.users.admin))
      .send({ role: 'OWNER' });
    const selfDeactivation = await request(app)
      .patch(`/api/users/${fixture.users.admin.id}`)
      .set(as(fixture.users.admin))
      .send({ isActive: false });
    expect(selfDemotion.status).toBe(409);
    expect(selfDeactivation.status).toBe(409);
  });
});
