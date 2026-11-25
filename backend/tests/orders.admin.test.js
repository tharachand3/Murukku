import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { getBalance } from '../src/services/ledgerService.js';
import { apiGet, apiPost, BENCH, loginAs, seedBenchmarkMasters } from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let users;
let items;
let customers;
let tokens;
let baselineMovementCount;
let nextClientRef = 1;
let createdOrderIds = [];

function apiPatch(token, path, body) {
  const call = request(app).patch(path);
  if (token) {
    call.set('Authorization', `Bearer ${token}`);
  }
  return call.send(body);
}

async function createOrder({ customer, salesman, token, qty }) {
  const response = await apiPost(app, token, '/api/orders', {
    clientRef: `step26-ref-${String(nextClientRef++).padStart(6, '0')}`,
    customerId: customer.id,
    lines: [{ itemId: items.finished.id, qty }]
  });
  expect(response.status).toBe(201);
  createdOrderIds.push(response.body.order.id);
  return {
    id: response.body.order.id,
    lineId: response.body.order.lines[0].lineId,
    orderNo: response.body.order.orderNo
  };
}

async function expectNoLedgerChanges() {
  expect(await db.stockMovement.count()).toBe(baselineMovementCount);
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();

  const [
    admin,
    owner,
    production,
    salesmanA,
    salesmanB,
    accountant,
    finished,
    pouch,
    carton,
    retailerA,
    distributorB
  ] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.user.findUnique({ where: { email: 'owner@demo.com' } }),
    db.user.findUnique({ where: { email: 'production@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
    db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
    db.item.findUnique({ where: { code: 'MURUKKU200' } }),
    db.item.findUnique({ where: { code: 'POUCH200' } }),
    db.item.findUnique({ where: { code: 'CARTON' } }),
    db.customer.findFirst({ where: { name: 'Retailer A' } }),
    db.customer.findFirst({ where: { name: 'Distributor B' } })
  ]);
  users = { admin, owner, production, salesmanA, salesmanB, accountant };
  items = { finished, pouch, carton };
  customers = { retailerA, distributorB };

  const [adminToken, ownerToken, productionToken, salesmanAToken, salesmanBToken, accountantToken] =
    await Promise.all([
      loginAs(app, admin.email),
      loginAs(app, owner.email),
      loginAs(app, production.email),
      loginAs(app, salesmanA.email),
      loginAs(app, salesmanB.email),
      loginAs(app, accountant.email)
    ]);
  tokens = {
    admin: adminToken,
    owner: ownerToken,
    production: productionToken,
    salesmanA: salesmanAToken,
    salesmanB: salesmanBToken,
    accountant: accountantToken
  };

  const started = await apiPost(app, tokens.production, '/api/production/runs', {
    finishedItemId: items.finished.id,
    batchCount: '1'
  });
  expect(started.status).toBe(201);
  const completed = await apiPost(
    app,
    tokens.production,
    `/api/production/runs/${started.body.id}/complete`,
    {
      actualGoodQty: 188,
      consumption: [
        { itemId: items.pouch.id, qty: '188', unit: 'pcs', scrapQty: '6' },
        { itemId: items.carton.id, qty: '9', unit: 'pcs' }
      ]
    }
  );
  expect(completed.status).toBe(200);
  expect(await getBalance(db, items.finished.id)).toBe(BENCH.afterRun.MURUKKU200);
  baselineMovementCount = await db.stockMovement.count();
});

afterEach(async () => {
  if (createdOrderIds.length > 0) {
    await db.order.updateMany({
      where: { id: { in: createdOrderIds }, status: 'APPROVED' },
      data: { status: 'CANCELLED' }
    });
  }
  createdOrderIds = [];
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('admin order changes', () => {
  it('approves covered quantities, rolls back a shortage, and permits partial approval', async () => {
    const retailerOrder = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 150
    });
    const distributorOrder = await createOrder({
      customer: customers.distributorB,
      salesman: users.salesmanB,
      token: tokens.salesmanB,
      qty: 120
    });

    const approvedRetailer = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${retailerOrder.id}/approve`,
      { note: 'Full quantity approved' }
    );
    expect(approvedRetailer.status).toBe(200);
    expect(approvedRetailer.body).toMatchObject({
      id: retailerOrder.id,
      status: 'APPROVED',
      lines: [{
        approvedQty: 150,
        approvedPricePaise: 5000,
        effectiveQty: 150,
        effectivePricePaise: 5000
      }]
    });
    expect(approvedRetailer.body.timeline).toContainEqual(
      expect.objectContaining({ action: 'APPROVE', note: 'Full quantity approved' })
    );
    expect(await db.order.findUnique({
      where: { id: retailerOrder.id },
      select: { approvedById: true, approvedAt: true }
    })).toMatchObject({
      approvedById: users.admin.id,
      approvedAt: expect.any(Date)
    });

    const shortage = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/approve`,
      {
        lines: [{
          lineId: distributorOrder.lineId,
          approvedQty: 120,
          approvedPricePaise: 4500
        }]
      }
    );
    expect(shortage.status).toBe(409);
    expect(shortage.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { totalShortPackets: 32, lines: [{ shortBy: 32 }] }
    });
    expect(await db.order.findUnique({
      where: { id: distributorOrder.id },
      include: { lines: true }
    })).toMatchObject({
      status: 'SUBMITTED',
      lines: [{ approvedQty: null, approvedPricePaise: null }]
    });
    expect(await db.auditLog.count({
      where: {
        entity: 'Order',
        entityId: distributorOrder.id,
        action: 'APPROVE'
      }
    })).toBe(0);

    const partial = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/approve`,
      {
        lines: [{
          lineId: distributorOrder.lineId,
          approvedQty: 88,
          approvedPricePaise: 4500
        }]
      }
    );
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({
      status: 'APPROVED',
      lines: [{
        approvedQty: 88,
        approvedPricePaise: 4500,
        effectiveQty: 88,
        effectivePricePaise: 4500
      }]
    });
    const repeated = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/approve`,
      {}
    );
    expect(repeated.status).toBe(409);
    expect(repeated.body.error).toMatchObject({
      code: 'INVALID_STATUS',
      details: { from: 'APPROVED', to: 'APPROVED' }
    });
    expect(await db.auditLog.count({
      where: {
        entity: 'Order',
        entityId: retailerOrder.id,
        action: 'APPROVE'
      }
    })).toBe(1);
    await expectNoLedgerChanges();
  });

  it('rejects approvals with no positive quantity without saving the snapshot', async () => {
    const order = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 10
    });
    const response = await apiPost(app, tokens.admin, `/api/orders/${order.id}/approve`, {
      lines: [{ lineId: order.lineId, approvedQty: 0 }]
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('NOTHING_TO_APPROVE');
    expect(await db.orderLine.findUnique({
      where: { id: order.lineId },
      select: { approvedQty: true, approvedPricePaise: true }
    })).toEqual({ approvedQty: null, approvedPricePaise: null });
    await expectNoLedgerChanges();
  });

  it('serializes five concurrent approvals of the same order', async () => {
    const order = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 60
    });
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(`/api/orders/${order.id}/approve`)
          .set('Authorization', `Bearer ${tokens.admin}`)
      )
    );

    expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 409)).toHaveLength(4);
    expect(responses.filter(({ body }) =>
      body.error?.code === 'INVALID_STATUS'
    )).toHaveLength(4);
    await expectNoLedgerChanges();
  });

  it('serializes different orders competing for the remaining stock', async () => {
    const reservedOrder = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 150
    });
    expect((await apiPost(
      app,
      tokens.admin,
      `/api/orders/${reservedOrder.id}/approve`,
      {}
    )).status).toBe(200);

    const orderA = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 60
    });
    const orderB = await createOrder({
      customer: customers.distributorB,
      salesman: users.salesmanB,
      token: tokens.salesmanB,
      qty: 60
    });
    const responses = await Promise.all([
      apiPost(app, tokens.admin, `/api/orders/${orderA.id}/approve`, {}),
      apiPost(app, tokens.admin, `/api/orders/${orderB.id}/approve`, {})
    ]);

    expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
    const shortage = responses.find(({ status }) => status === 409);
    expect(shortage.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { totalShortPackets: 32, lines: [{ shortBy: 32 }] }
    });
    await expectNoLedgerChanges();
  });

  it('edits submitted lines, rejects foreign line IDs, and locks edits after approval', async () => {
    const order = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 20
    });
    const otherOrder = await createOrder({
      customer: customers.distributorB,
      salesman: users.salesmanB,
      token: tokens.salesmanB,
      qty: 20
    });
    const edited = await apiPatch(tokens.admin, `/api/orders/${order.id}/lines`, {
      lines: [{
        lineId: order.lineId,
        approvedQty: 10,
        approvedPricePaise: 4700
      }],
      note: 'Adjusted for the customer'
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      status: 'SUBMITTED',
      lines: [{
        approvedQty: 10,
        approvedPricePaise: 4700,
        effectiveQty: 10,
        effectivePricePaise: 4700
      }],
      timeline: expect.arrayContaining([expect.objectContaining({
        action: 'UPDATE',
        note: 'Adjusted for the customer'
      })])
    });

    const foreignLine = await apiPatch(tokens.admin, `/api/orders/${order.id}/lines`, {
      lines: [{ lineId: otherOrder.lineId, approvedQty: 10 }]
    });
    expect(foreignLine.status).toBe(422);
    expect(foreignLine.body.error.code).toBe('LINE_NOT_IN_ORDER');

    const unknownKey = await apiPatch(tokens.admin, `/api/orders/${order.id}/lines`, {
      lines: [{ lineId: order.lineId }],
      status: 'APPROVED'
    });
    expect(unknownKey.status).toBe(400);

    expect((await apiPost(
      app,
      tokens.admin,
      `/api/orders/${order.id}/approve`,
      {}
    )).status).toBe(200);
    const lockedEdit = await apiPatch(tokens.admin, `/api/orders/${order.id}/lines`, {
      lines: [{ lineId: order.lineId, approvedQty: 9 }]
    });
    expect(lockedEdit.status).toBe(409);
    expect(lockedEdit.body.error).toMatchObject({
      code: 'INVALID_STATUS',
      details: { from: 'APPROVED', to: 'SUBMITTED' }
    });
    expect(await db.auditLog.count({
      where: { entity: 'Order', entityId: order.id, action: 'UPDATE' }
    })).toBe(1);
    await expectNoLedgerChanges();
  });

  it('rejects with a required reason and records the reason in the timeline', async () => {
    const order = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 10
    });
    const missingReason = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${order.id}/reject`,
      {}
    );
    expect(missingReason.status).toBe(400);

    const rejected = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${order.id}/reject`,
      { reason: 'Stock unavailable for this order' }
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Stock unavailable for this order',
      timeline: expect.arrayContaining([expect.objectContaining({
        action: 'REJECT',
        note: 'Stock unavailable for this order'
      })])
    });
    expect(await db.auditLog.count({
      where: { entity: 'Order', entityId: order.id, action: 'REJECT' }
    })).toBe(1);
    const rejectedAgain = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${order.id}/reject`,
      { reason: 'Try again' }
    );
    expect(rejectedAgain.status).toBe(409);
    expect(rejectedAgain.body.error.code).toBe('INVALID_STATUS');
    await expectNoLedgerChanges();
  });

  it('cancels approved orders, clears reservations, and blocks invoiced cancellation', async () => {
    const approvedOrder = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 150
    });
    const otherOrder = await createOrder({
      customer: customers.distributorB,
      salesman: users.salesmanB,
      token: tokens.salesmanB,
      qty: 120
    });
    expect((await apiPost(
      app,
      tokens.admin,
      `/api/orders/${approvedOrder.id}/approve`,
      {}
    )).status).toBe(200);
    const rejectApproved = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${approvedOrder.id}/reject`,
      { reason: 'Already approved' }
    );
    expect(rejectApproved.status).toBe(409);
    expect(rejectApproved.body.error.code).toBe('INVALID_STATUS');
    const reserved = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${otherOrder.id}/availability`
    );
    expect(reserved.body.lines[0].reservedByOthers).toBe(150);

    const cancelled = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${approvedOrder.id}/cancel`,
      { reason: 'Customer changed delivery date' }
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      timeline: expect.arrayContaining([expect.objectContaining({
        action: 'CANCEL',
        note: 'Customer changed delivery date'
      })])
    });
    const availableAfterCancel = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${otherOrder.id}/availability`
    );
    expect(availableAfterCancel.body.lines[0]).toMatchObject({
      reservedByOthers: 0,
      free: 238,
      shortBy: 0
    });
    expect(await db.auditLog.count({
      where: { entity: 'Order', entityId: approvedOrder.id, action: 'CANCEL' }
    })).toBe(1);

    const invoicedOrder = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 1
    });
    await db.order.update({
      where: { id: invoicedOrder.id },
      data: { status: 'INVOICED' }
    });
    const invoicedCancel = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${invoicedOrder.id}/cancel`,
      { reason: 'Too late to cancel' }
    );
    expect(invoicedCancel.status).toBe(409);
    expect(invoicedCancel.body.error).toMatchObject({
      code: 'INVALID_STATUS',
      details: { from: 'INVOICED', to: 'CANCELLED' }
    });
    await expectNoLedgerChanges();
  });

  it('denies all four actions to other roles and unauthenticated callers', async () => {
    const order = await createOrder({
      customer: customers.retailerA,
      salesman: users.salesmanA,
      token: tokens.salesmanA,
      qty: 1
    });
    const actions = [
      (token) => apiPatch(token, `/api/orders/${order.id}/lines`, {
        lines: [{ lineId: order.lineId, approvedQty: 1 }]
      }),
      (token) => apiPost(app, token, `/api/orders/${order.id}/approve`, {}),
      (token) => apiPost(app, token, `/api/orders/${order.id}/reject`, {
        reason: 'Not approved'
      }),
      (token) => apiPost(app, token, `/api/orders/${order.id}/cancel`, {
        reason: 'Cancelled'
      })
    ];

    for (const role of ['salesmanA', 'accountant', 'owner']) {
      for (const action of actions) {
        expect((await action(tokens[role])).status, role).toBe(403);
      }
    }
    for (const action of actions) {
      const response = await action(undefined);
      expect(response.status).toBe(401);
    }
    await expectNoLedgerChanges();
  });
});
