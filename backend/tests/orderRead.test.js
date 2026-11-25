import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app.js';
import { config } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { db, resetDb } from './helpers/db.js';
import { seedBenchmarkMasters } from './helpers/benchmark.js';

let users;
let customers;
let headers;
let orderIds;
let orderNumbers;

function tokenHeaders(user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
  return { Authorization: `Bearer ${token}` };
}

function getOrders(token, query = {}) {
  const call = request(app).get('/api/orders').query(query);
  if (token) call.set('Authorization', token);
  return call;
}

function createOrder(token, clientRef, customerId, qty) {
  return request(app)
    .post('/api/orders')
    .set('Authorization', token)
    .send({
      clientRef,
      customerId,
      lines: [{ itemId: customers.finishedItemId, qty }]
    });
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  const [admin, salesmanA, salesmanB, accountant, retailerA, distributorB, finished] =
    await Promise.all([
      db.user.findUnique({ where: { email: 'admin@demo.com' } }),
      db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
      db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
      db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
      db.customer.findFirst({ where: { name: 'Retailer A' } }),
      db.customer.findFirst({ where: { name: 'Distributor B' } }),
      db.item.findUnique({ where: { code: 'MURUKKU200' } })
    ]);
  users = { admin, salesmanA, salesmanB, accountant };
  customers = {
    retailerA,
    distributorB,
    retailerC: await db.customer.create({
      data: {
        name: 'Retailer C',
        type: 'RETAILER',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        assignedSalesmanId: salesmanA.id
      }
    }),
    finishedItemId: finished.id
  };
  headers = {
    admin: tokenHeaders(admin).Authorization,
    salesmanA: tokenHeaders(salesmanA).Authorization,
    salesmanB: tokenHeaders(salesmanB).Authorization,
    accountant: tokenHeaders(accountant).Authorization
  };

  const first = await createOrder(
    headers.salesmanA,
    'read-a-retailer-0001',
    retailerA.id,
    2
  );
  const approved = await createOrder(
    headers.salesmanA,
    'read-a-retailerc-0001',
    customers.retailerC.id,
    3
  );
  const rejected = await createOrder(
    headers.salesmanA,
    'read-a-rejected-0001',
    retailerA.id,
    9
  );
  const cancelled = await createOrder(
    headers.salesmanA,
    'read-a-cancelled-001',
    customers.retailerC.id,
    10
  );
  const salesmanBOrder = await createOrder(
    headers.salesmanB,
    'read-b-distrib-0001',
    distributorB.id,
    7
  );
  for (const response of [first, approved, rejected, cancelled, salesmanBOrder]) {
    expect(response.status).toBe(201);
  }
  orderIds = {
    first: first.body.order.id,
    approved: approved.body.order.id,
    rejected: rejected.body.order.id,
    cancelled: cancelled.body.order.id,
    salesmanB: salesmanBOrder.body.order.id
  };
  orderNumbers = {
    first: first.body.order.orderNo
  };

  await db.order.update({
    where: { id: orderIds.first },
    data: { createdAt: new Date('2026-11-25T18:00:00.000Z') }
  });
  await db.order.update({
    where: { id: orderIds.approved },
    data: { status: 'APPROVED', createdAt: new Date('2026-11-24T18:00:00.000Z') }
  });
  await db.orderLine.updateMany({
    where: { orderId: orderIds.approved },
    data: { approvedQty: 4, approvedPricePaise: 6000 }
  });
  await db.order.update({
    where: { id: orderIds.rejected },
    data: { status: 'REJECTED', createdAt: new Date('2026-11-25T10:00:00.000Z') }
  });
  await db.order.update({
    where: { id: orderIds.cancelled },
    data: { status: 'CANCELLED', createdAt: new Date('2026-11-25T12:00:00.000Z') }
  });
  await db.order.update({
    where: { id: orderIds.salesmanB },
    data: { createdAt: new Date('2026-11-25T19:00:00.000Z') }
  });
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('order read APIs', () => {
  it('scopes salesman lists to their own orders and lets admins see all salesmen', async () => {
    const salesman = await getOrders(headers.salesmanA);
    expect(salesman.status).toBe(200);
    expect(salesman.body.total).toBe(4);
    expect(salesman.body.items.map(({ id }) => id)).not.toContain(orderIds.salesmanB);
    expect(salesman.body.items.every(({ id }) =>
      [orderIds.first, orderIds.approved, orderIds.rejected, orderIds.cancelled].includes(id)
    )).toBe(true);
    expect(salesman.body.items.map(({ id }) => id)).toEqual([
      orderIds.first,
      orderIds.cancelled,
      orderIds.rejected,
      orderIds.approved
    ]);
    expect(salesman.body.items.every((item) =>
      !Object.hasOwn(item, 'salesmanName')
    )).toBe(true);

    const ignoredSalesmanFilter = await getOrders(headers.salesmanA, {
      salesmanId: users.salesmanB.id
    });
    expect(ignoredSalesmanFilter.body.total).toBe(4);

    const admin = await getOrders(headers.admin);
    expect(admin.status).toBe(200);
    expect(admin.body.total).toBe(5);
    expect(admin.body.items.map(({ id }) => id)).toContain(orderIds.salesmanB);
    expect(admin.body.items.every(({ salesmanName }) => typeof salesmanName === 'string'))
      .toBe(true);
  });

  it('applies status, customer, salesman, IST date, order number, and pagination filters', async () => {
    const approved = await getOrders(headers.admin, { status: 'APPROVED' });
    expect(approved.body.items.map(({ id }) => id)).toEqual([orderIds.approved]);
    expect(approved.body.items[0].statusLabel).toBe('Approved');
    expect(approved.body.items[0]).toMatchObject({
      totalQty: 4,
      taxableTotalPaise: 24000,
      display: '240.00'
    });

    const retailerAOrders = await getOrders(headers.admin, {
      customerId: customers.retailerA.id
    });
    expect(retailerAOrders.body.items.map(({ id }) => id).sort())
      .toEqual([orderIds.first, orderIds.rejected].sort());

    const salesmanBOrders = await getOrders(headers.admin, {
      salesmanId: users.salesmanB.id
    });
    expect(salesmanBOrders.body.items.map(({ id }) => id)).toEqual([orderIds.salesmanB]);

    const istDay = await getOrders(headers.admin, {
      from: '2026-11-25',
      to: '2026-11-25'
    });
    expect(istDay.body.items.map(({ id }) => id).sort())
      .toEqual([orderIds.first, orderIds.rejected, orderIds.cancelled].sort());

    const byOrderNo = await getOrders(headers.admin, {
      q: orderNumbers.first.toLowerCase()
    });
    expect(byOrderNo.body.items.map(({ id }) => id)).toEqual([orderIds.first]);

    const pageOne = await getOrders(headers.salesmanA, { page: 1, limit: 2 });
    const pageTwo = await getOrders(headers.salesmanA, { page: 2, limit: 2 });
    expect(pageOne.body).toMatchObject({ page: 1, limit: 2, total: 4 });
    expect(pageTwo.body).toMatchObject({ page: 2, limit: 2, total: 4 });
    expect(pageOne.body.items).toHaveLength(2);
    expect(pageTwo.body.items).toHaveLength(2);
    expect(pageOne.body.items.map(({ id }) => id))
      .not.toEqual(pageTwo.body.items.map(({ id }) => id));

    const invalidDate = await getOrders(headers.admin, { from: '2026-02-29' });
    expect(invalidDate.status).toBe(400);
  });

  it('hides another salesman order and returns detail with effective values and audit timeline', async () => {
    const forbiddenDetail = await request(app)
      .get(`/api/orders/${orderIds.salesmanB}`)
      .set('Authorization', headers.salesmanA);
    expect(forbiddenDetail.status).toBe(404);

    const detail = await request(app)
      .get(`/api/orders/${orderIds.approved}`)
      .set('Authorization', headers.salesmanA);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      status: 'APPROVED',
      statusLabel: 'Approved',
      customer: { name: 'Retailer C' },
      salesman: { id: users.salesmanA.id },
      invoice: null,
      dispatches: [],
      taxableTotalPaise: 24000,
      lines: [{
        qty: 3,
        qtyDisplay: '3 packet',
        pricePaise: 5000,
        approvedQty: 4,
        approvedQtyDisplay: '4 packet',
        approvedPricePaise: 6000,
        effectiveQty: 4,
        effectivePricePaise: 6000,
        lineTotalPaise: 24000
      }]
    });
    expect(detail.body.timeline).toEqual([
      expect.objectContaining({
        action: 'CREATE',
        by: users.salesmanA.name
      })
    ]);
  });

  it('aggregates effective customer sales and excludes rejected and cancelled orders', async () => {
    const response = await request(app)
      .get('/api/orders/my/customer-sales')
      .set('Authorization', headers.salesmanA);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items).toMatchObject([
      {
        customerId: customers.retailerC.id,
        customerName: 'Retailer C',
        orders: 1,
        totalQty: 4,
        taxableValuePaise: 24000,
        display: '240.00'
      },
      {
        customerId: customers.retailerA.id,
        customerName: 'Retailer A',
        orders: 1,
        totalQty: 2,
        taxableValuePaise: 10000,
        display: '100.00'
      }
    ]);
    expect(response.body.items[0].lastOrderAt).toBe('2026-11-24T18:00:00.000Z');
    expect(response.body.items[1].lastOrderAt).toBe('2026-11-25T18:00:00.000Z');
    expect(response.body.totals).toMatchObject({
      orders: 2,
      totalQty: 6,
      taxableValuePaise: 34000,
      display: '340.00'
    });

    const istDayResponse = await request(app)
      .get('/api/orders/my/customer-sales')
      .query({ from: '2026-11-25', to: '2026-11-25' })
      .set('Authorization', headers.salesmanA);
    expect(istDayResponse.body.items).toMatchObject([{
      customerId: customers.retailerA.id,
      orders: 1,
      taxableValuePaise: 10000
    }]);
  });

  it('allows accountant list reads, denies writes and salesman-only aggregation to admins', async () => {
    const accountList = await getOrders(headers.accountant);
    expect(accountList.status).toBe(200);
    expect(accountList.body.total).toBe(5);

    const deniedCreate = await request(app)
      .post('/api/orders')
      .set('Authorization', headers.accountant)
      .send({
        customerId: customers.retailerA.id,
        lines: [{ itemId: customers.finishedItemId, qty: 1 }]
      });
    expect(deniedCreate.status).toBe(403);

    const deniedSales = await request(app)
      .get('/api/orders/my/customer-sales')
      .set('Authorization', headers.admin);
    expect(deniedSales.status).toBe(403);
  });

  it('requires authentication for order reads', async () => {
    expect((await getOrders(null)).status).toBe(401);
    expect((await request(app).get('/api/orders/my/customer-sales')).status).toBe(401);
    expect((await request(app).get(`/api/orders/${orderIds.first}`)).status).toBe(401);
  });
});
